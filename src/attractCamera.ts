import { Quaternion, Vector3 } from "@babylonjs/core";
import { getActiveLevelCode, getActiveMap } from "./config";

// =============================================================================
// Attract / flyby camera director
// =============================================================================
//
// The five principles this is built around (keep these — they are the whole point):
//
//   1. HEAVY CAMERA. The camera is a physics body with real mass. It is moved by
//      accelerative forces through a drag field, never teleported or eased to a
//      pose. Both its POSITION and its ORIENTATION are integrated from forces /
//      torques. There is NO look-at anywhere: we never call setTarget. The head
//      has its own angular inertia, so it lags and settles like a heavy gimbal on
//      a crane — "more like a train than a kite". Aiming at a subject is done by a
//      gentle restoring TORQUE toward a desired facing, which the heavy head
//      resists, so the subject is framed with weight, not pinned weightlessly.
//
//   2. INTERESTING START. A shot is built around a point of interest (a flower
//      field, a clover patch). It begins already framing — or nearly framing — a
//      POI, not staring at bare grass.
//
//   3. THE SHOT BEGINS BEFORE THE SHOT BEGINS. Each shot's carrier is spawned
//      WARM_UP seconds before its cut and integrated every frame, and it is
//      initialised already in motion (initial velocity = the path's derivative).
//      So when the wipe reveals it, the camera is already gliding on its mark — no
//      "operator waking up" lurch.
//
//   4. THE SHOT. A small library of composed shot types (orbit/security pan,
//      top-down drone, birdlike grass swoop, low dolly-past, crane rise, high
//      establishing drift). Each one authors its start, warm-up, forces and
//      planned end TOGETHER so all of 1/2/3/5 are satisfied by construction.
//
//   5. THE SHOT ENDS AFTER THE SHOT ENDS. Paths are defined past their live
//      window (s < 0 warm-up and s > 1 follow-through) and there is never a hard
//      brake, so motion bleeds out gracefully. A hard ground floor guarantees the
//      camera never dips below the plane or clips the grass right as the next shot
//      is revealed.
//
// ROLL / horizon policy: yaw + pitch are always live. Roll is used sparingly and
// damped — a subtle bank into dynamic shots (the swoop), nothing more here. Bigger
// dutch angles are intentionally left for future special shots (e.g. following a
// swarm of bees / a moving POI) where the drama is earned; keep them rare and
// deliberate so the attract loop never looks tilted-for-no-reason.
// =============================================================================

export type AttractPose = { position: Vector3; rotation: Quaternion; fov: number };
export type AttractFrame = {
  primary: AttractPose;
  secondary: AttractPose;
  mask: number;
  direction: number;
  wipeMode: number;
  wipeSeed: number;
};

export type AttractDeps = {
  groundHeightAt: (x: number, z: number) => number;
};

// Timing. SEGMENT = one shot's slot; the wipe occupies its final TRANSITION.
const WARM_UP = 4.5; // seconds a carrier glides before its cut (principle 3)
const LIVE = 11; // seconds the shot is the on-screen primary
const TRANSITION = 6.75; // slowed 3x; shader shape stays unchanged in normal mode
const SEGMENT = LIVE + TRANSITION;

// ---- small math helpers ----------------------------------------------------
const TAU = Math.PI * 2;
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const clamp01 = (v: number) => clamp(v, 0, 1);
const lerp = (a: number, b: number, t: number) => a + ((b - a) * t);
const smootherstep01 = (v: number) => {
  const t = clamp01(v);
  return t * t * t * (t * ((t * 6) - 15) + 10);
};
const wrapAngle = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

// Deterministic per-segment randomness, so a carrier rebuilt for the same segment
// (e.g. promoted from "next" to "current") is identical.
const hashInt = (n: number) => {
  let x = n >>> 0;
  x ^= x >>> 16;
  x = Math.imul(x, 0x7feb352d);
  x ^= x >>> 15;
  x = Math.imul(x, 0x846ca68b);
  x ^= x >>> 16;
  return x >>> 0;
};
const mulberry32 = (seed: number) => {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};
const hashString = (s: string) => {
  let h = 2166136261;
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
};

// ---- spring integrators (force -> velocity -> value, with a force ramp) -----
// The force ramp (maxForce/response) keeps the *force itself* from changing
// instantly, which is what makes the motion read as massy rather than springy.
type SpringParams = { mass: number; drag: number; stiffness: number; maxForce: number; response: number };
type ScalarState = { value: number; vel: number; force: number };
type VectorState = { value: Vector3; vel: Vector3; force: Vector3 };

function scalarSpring(s: ScalarState, goal: number, dt: number, p: SpringParams, wrap: boolean) {
  const error = wrap ? wrapAngle(goal - s.value) : goal - s.value;
  const desired = clamp((error * p.stiffness) - (s.vel * p.drag), -p.maxForce, p.maxForce);
  const maxChange = (p.maxForce / p.response) * dt;
  s.force += clamp(desired - s.force, -maxChange, maxChange);
  s.vel += (s.force / p.mass) * dt;
  s.value += s.vel * dt;
}

function clampLength(v: Vector3, maxLength: number) {
  const len = v.length();
  if (len > maxLength && len > 1e-6) {
    v.scaleInPlace(maxLength / len);
  }
  return v;
}


// ---- orientation: integrated yaw/pitch/roll -> quaternion (NOT a look-at) ----
function facingToPoint(from: Vector3, to: Vector3) {
  const dir = to.subtract(from);
  const len = dir.length() || 1;
  dir.scaleInPlace(1 / len);
  return { yaw: Math.atan2(dir.x, dir.z), pitch: Math.asin(clamp(dir.y, -1, 1)) };
}

// The camera NEVER looks up: there is no skybox, so any upward aim is a screen of
// flat pale blue. Pitch is clamped to "a hair below the horizon" .. "straight
// down" everywhere it is used.
const PITCH_MAX = -0.05;
const PITCH_MIN = -1.5;

// Orientation is built straight from the integrated yaw/pitch/roll via an
// Euler->quaternion (RotationYawPitchRoll). This is CONTINUOUS in its inputs.
//
// We do NOT reconstruct orientation from a forward + up vector (FromLookDirection):
// that degenerates when the aim nears vertical (forward parallel to up) and flips
// 180 degrees in a single frame — that was the violent one-frame "snap". A heavy
// camera must never snap, so orientation is never derived from a look vector.
function orientation(yaw: number, pitch: number, roll: number, out: Quaternion) {
  const p = clamp(pitch, PITCH_MIN, PITCH_MAX);
  // forward = (sin yaw cos p, sin p, cos yaw cos p) is produced by (yaw, -p, roll).
  Quaternion.RotationYawPitchRollToRef(yaw, -p, roll, out);
}

// ---- points of interest + map bounds ---------------------------------------
type Poi = { point: Vector3; radius: number };
type Bounds = { center: Vector3; radius: number; xMin: number; xMax: number; zMin: number; zMax: number };

// ---- shot definitions ------------------------------------------------------
type ShotContext = {
  bounds: Bounds;
  ground: (x: number, z: number) => number;
};
type Facing = { yaw: number; pitch: number; roll: number };
type Shot = {
  positionGoal: (t: number) => Vector3;
  facingGoal: (t: number, pos: Vector3, vel: Vector3) => Facing;
  fovGoal: (t: number) => number;
  pos: SpringParams;
  yaw: SpringParams;
  pitch: SpringParams;
  roll: SpringParams;
  minClear: number; // hard floor above the ground (principle 5)
};

// Normalised shot progress: 0 at the cut-in, 1 at the cut-out; <0 warm-up, >1 bleed.
const progressOf = (t: number) => (t - WARM_UP) / LIVE;

// Spring presets. High mass + modest stiffness = heavy and smooth.
const POS_HEAVY: SpringParams = { mass: 6.5, drag: 4.4, stiffness: 6.5, maxForce: 26, response: 0.6 };
const POS_GLIDE: SpringParams = { mass: 5, drag: 3.8, stiffness: 7.5, maxForce: 34, response: 0.5 };
// Aim springs are deliberately heavy/slow so the head rotation rate stays low —
// the attract loop must never feel like it spins or whips around.
const AIM_HEAVY: SpringParams = { mass: 5.5, drag: 5.6, stiffness: 4, maxForce: 11, response: 0.55 };
const AIM_SOFT: SpringParams = { mass: 7, drag: 6, stiffness: 3, maxForce: 8, response: 0.65 };
const ROLL_PARAMS: SpringParams = { mass: 8, drag: 6.5, stiffness: 3.2, maxForce: 5, response: 0.7 };
const FOV_PARAMS: SpringParams = { mass: 3, drag: 4, stiffness: 5, maxForce: 4, response: 0.6 };

function makeGround(ctx: ShotContext, gx: number, gz: number, height: number) {
  // Keep the camera within a tight margin of the point-of-interest bounds, so it
  // never drifts out toward the lawn edge. (bounds hug the flowers, not the yard.)
  const x = clamp(gx, ctx.bounds.xMin - 1.5, ctx.bounds.xMax + 1.5);
  const z = clamp(gz, ctx.bounds.zMin - 1.5, ctx.bounds.zMax + 1.5);
  return new Vector3(x, ctx.ground(x, z) + height, z);
}

// 1) Orbit / security pan: slow partial orbit framing the POI. Heavy aim so the
//    framing lags with weight. Calm, the "establishing" workhorse.
function shotOrbit(_poi: Poi, ctx: ShotContext, rng: () => number): Shot {
  // Orbit the whole flower CLUSTER (bounds centre), not a corner POI — so the
  // camera circles through the middle and never swings out toward the lawn edge.
  const pivot = ctx.bounds.center;
  const radius = clamp(ctx.bounds.radius * 0.75, 5, 11);
  const height = lerp(4, 8, rng());
  const start = rng() * TAU;
  // A gentle reveal arc, not a circle. Kept slow (a few deg/sec) so the slow
  // orbit never reads as a spin.
  const arc = lerp(0.28, 0.5, rng()) * (rng() < 0.5 ? -1 : 1);
  const focus = new Vector3(pivot.x, ctx.ground(pivot.x, pivot.z) + 0.6, pivot.z);
  return {
    positionGoal: (t) => {
      const ang = start + (progressOf(t) * arc);
      return makeGround(ctx, pivot.x + (Math.cos(ang) * radius), pivot.z + (Math.sin(ang) * radius), height);
    },
    facingGoal: (_t, pos) => {
      const f = facingToPoint(pos, focus);
      return { yaw: f.yaw, pitch: f.pitch, roll: clamp(-arc * 0.1, -0.1, 0.1) };
    },
    fovGoal: () => 0.74,
    pos: POS_HEAVY,
    yaw: AIM_SOFT,
    pitch: AIM_SOFT,
    roll: ROLL_PARAMS,
    minClear: 1.6,
  };
}

// 2) Top-down drone: high above the POI, looking mostly down, slow lateral dolly.
function shotDrone(poi: Poi, ctx: ShotContext, rng: () => number): Shot {
  const height = lerp(11, 15, rng());
  const dir = rng() * TAU;
  const dx = Math.cos(dir);
  const dz = Math.sin(dir);
  const heading = Math.atan2(dx, dz);
  const travel = clamp((poi.radius * 1.4) + 4, 5, 12);
  return {
    positionGoal: (t) => {
      const along = (progressOf(t) - 0.5) * travel;
      return makeGround(ctx, poi.point.x + (dx * along), poi.point.z + (dz * along), height);
    },
    // A moving aerial, NOT a top-down spinner: a FIXED heading along the travel
    // direction, tilted obliquely down. Constant yaw means the ground never
    // rotates under the camera — no nausea. (Straight-down + any yaw spins the
    // world and is the single worst thing the attract loop can do.)
    facingGoal: () => ({ yaw: heading, pitch: -0.92, roll: 0 }),
    fovGoal: () => 0.64,
    pos: POS_HEAVY,
    yaw: AIM_HEAVY,
    pitch: AIM_HEAVY,
    roll: ROLL_PARAMS,
    minClear: 6,
  };
}

// 3) Grass swoop (birdlike — the payoff). Dives from high+back toward the blades
//    near the POI, levels just above them, then climbs away. Looks where it's
//    going, so it tilts down into the dive and up out of it. Subtle bank.
function shotSwoop(poi: Poi, ctx: ShotContext, rng: () => number): Shot {
  const dir = rng() * TAU;
  const dx = Math.cos(dir);
  const dz = Math.sin(dir);
  // Keep the run short enough that the dip stays OVER the flower field rather than
  // shooting out across the plainer grass beyond it.
  const travel = clamp((poi.radius * 2) + 3, 9, 15);
  const highY = lerp(7, 10, rng());
  const lowY = 0.95; // just over the 0.6-0.76 m blades
  const travelDir = new Vector3(dx, 0, dz);
  return {
    positionGoal: (t) => {
      const s = progressOf(t);
      const along = (s - 0.5) * travel;
      const valley = smootherstep01(Math.abs((2 * clamp(s, -0.2, 1.2)) - 1)); // 0 at mid, 1 at ends
      return makeGround(ctx, poi.point.x + (dx * along), poi.point.z + (dz * along), lerp(lowY, highY, valley));
    },
    facingGoal: (t, pos, vel) => {
      // Gaze down-ahead at the grass/flowers we're flying over, using only the
      // HORIZONTAL travel direction — so a steep dive or climb never tips the gaze
      // up into the empty sky. The target sits below ground level ahead, so the
      // pitch is always comfortably downward.
      const horizontal = new Vector3(vel.x, 0, vel.z);
      const hlen = horizontal.length();
      const look = hlen > 0.5 ? horizontal.scaleInPlace(1 / hlen) : travelDir.clone();
      const target = pos.add(look.scale(8));
      target.y = ctx.ground(target.x, target.z) - 1;
      const f = facingToPoint(pos, target);
      // Bank in then out across the dive — gentle, earns a little life.
      return { yaw: f.yaw, pitch: f.pitch, roll: Math.sin(TAU * clamp01(progressOf(t))) * 0.12 };
    },
    fovGoal: () => 0.82,
    pos: POS_GLIDE,
    yaw: AIM_HEAVY,
    pitch: AIM_HEAVY,
    roll: ROLL_PARAMS,
    minClear: 0.6,
  };
}

// 4) Low dolly-past: skims low, holding the POI framed while dollying sideways, so
//    foreground flowers streak past with parallax.
function shotDollyPast(poi: Poi, ctx: ShotContext, rng: () => number): Shot {
  const dir = rng() * TAU;
  const dx = Math.cos(dir);
  const dz = Math.sin(dir);
  const nx = -dz; // perpendicular = the offset side
  const nz = dx;
  const travel = clamp((poi.radius * 2) + 8, 10, 18);
  const offset = clamp(poi.radius + 3, 4, 8);
  const height = lerp(1, 1.8, rng());
  return {
    positionGoal: (t) => {
      const along = (progressOf(t) - 0.5) * travel;
      return makeGround(ctx, poi.point.x + (nx * offset) + (dx * along), poi.point.z + (nz * offset) + (dz * along), height);
    },
    facingGoal: (_t, pos) => {
      const f = facingToPoint(pos, poi.point);
      return { yaw: f.yaw, pitch: f.pitch, roll: 0.03 };
    },
    fovGoal: () => 0.86,
    pos: POS_GLIDE,
    yaw: AIM_HEAVY,
    pitch: AIM_SOFT,
    roll: ROLL_PARAMS,
    minClear: 0.8,
  };
}

// 5) Crane rise: starts low framing the POI, cranes straight up; the framing pulls
//    the pitch down on its own as it climbs, revealing the field pattern.
function shotCrane(poi: Poi, ctx: ShotContext, rng: () => number): Shot {
  const dir = rng() * TAU;
  const back = clamp(poi.radius + 4, 5, 9);
  const bx = Math.cos(dir);
  const bz = Math.sin(dir);
  const lowY = 1.2;
  const rise = lerp(7, 11, rng());
  return {
    positionGoal: (t) => {
      const s = progressOf(t);
      const sway = Math.sin(clamp01(s) * Math.PI) * 1.4;
      return makeGround(ctx, poi.point.x + (bx * back) + (bz * sway), poi.point.z + (bz * back) - (bx * sway), lowY + (s * rise));
    },
    facingGoal: (_t, pos) => {
      const f = facingToPoint(pos, poi.point);
      return { yaw: f.yaw, pitch: f.pitch, roll: 0 };
    },
    fovGoal: () => 0.78,
    pos: POS_HEAVY,
    yaw: AIM_SOFT,
    pitch: AIM_SOFT,
    roll: ROLL_PARAMS,
    minClear: 1,
  };
}

// 6) High establishing drift: calm, high, slow lateral drift looking down over the
//    field with a lazy yaw — the "breathe" shot between busier ones.
function shotEstablish(_poi: Poi, ctx: ShotContext, rng: () => number): Shot {
  // Drift across the whole cluster centre (stays central, away from the edge).
  const pivot = ctx.bounds.center;
  const height = lerp(9, 13, rng());
  const dir = rng() * TAU;
  const dx = Math.cos(dir);
  const dz = Math.sin(dir);
  const travel = clamp(ctx.bounds.radius * 0.7, 5, 11);
  const focus = new Vector3(pivot.x, ctx.ground(pivot.x, pivot.z) + 0.6, pivot.z);
  return {
    positionGoal: (t) => {
      const along = (progressOf(t) - 0.5) * travel;
      return makeGround(ctx, pivot.x + (dx * along), pivot.z + (dz * along), height);
    },
    facingGoal: (_t, pos) => {
      // Frame the cluster and let the slow lateral drift do the work — no added yaw
      // wobble (any extra rotation reads as drift/sway and risks nausea).
      const f = facingToPoint(pos, focus);
      return { yaw: f.yaw, pitch: f.pitch, roll: 0.02 };
    },
    fovGoal: () => 0.68,
    pos: POS_HEAVY,
    yaw: AIM_SOFT,
    pitch: AIM_SOFT,
    roll: ROLL_PARAMS,
    minClear: 4,
  };
}

const SHOT_FACTORIES = [shotOrbit, shotDrone, shotSwoop, shotDollyPast, shotCrane, shotEstablish];

// ---- carrier (one shot in flight) ------------------------------------------
type Carrier = {
  segmentIndex: number;
  spawnTime: number;
  shot: Shot;
  pos: VectorState;
  yaw: ScalarState;
  pitch: ScalarState;
  roll: ScalarState;
  fov: ScalarState;
};

export function createAttractDirector(deps: AttractDeps) {
  const ground = deps.groundHeightAt;

  let levelCode = "";
  let levelSeed = 0;
  let pois: Poi[] = [];
  let bounds: Bounds = { center: Vector3.Zero(), radius: 16, xMin: -8, xMax: 8, zMin: -8, zMax: 8 };
  let ctx: ShotContext = { bounds, ground };

  let current: Carrier | null = null;
  let next: Carrier | null = null;

  const primaryPose: AttractPose = { position: new Vector3(), rotation: new Quaternion(), fov: 0.8 };
  const secondaryPose: AttractPose = { position: new Vector3(), rotation: new Quaternion(), fov: 0.8 };

  const boundsFromRect = (xMin: number, xMax: number, zMin: number, zMax: number): Bounds => {
    const cx = (xMin + xMax) / 2;
    const cz = (zMin + zMax) / 2;
    const width = Math.max(1, xMax - xMin);
    const depth = Math.max(1, zMax - zMin);
    return { center: new Vector3(cx, 0.5, cz), radius: Math.hypot(width, depth) * 0.5, xMin, xMax, zMin, zMax };
  };

  // POIs = the things worth filming: flower-field centres and clover patches.
  const computePois = (): Poi[] => {
    const map = getActiveMap();
    const list: Poi[] = [];
    for (const field of map.flowerFields ?? []) {
      const cx = (field.area.xMin + field.area.xMax) / 2;
      const cz = (field.area.zMin + field.area.zMax) / 2;
      const radius = Math.min(field.area.xMax - field.area.xMin, field.area.zMax - field.area.zMin) / 2;
      list.push({ point: new Vector3(cx, ground(cx, cz) + 0.6, cz), radius: Math.max(2, radius) });
    }
    for (const patch of map.cloverPatches ?? []) {
      list.push({ point: new Vector3(patch.x, ground(patch.x, patch.z) + 0.4, patch.z), radius: patch.radius });
    }
    return list;
  };

  // Camera bounds hug the POINTS OF INTEREST (the flowers/clover), NOT the full
  // grass yard. The grass extends well past these bounds, and the camera is kept
  // inside them, so it never wanders out near the (feathered) lawn edge.
  const computeBounds = (list: Poi[]): Bounds => {
    if (list.length === 0) {
      const map = getActiveMap();
      const { xMin, xMax, zMin, zMax } = map.bounds;
      if (!Number.isFinite(xMin)) {
        const s = map.spawn;
        return boundsFromRect(s.x - 8, s.x + 8, s.z - 8, s.z + 8);
      }
      return boundsFromRect(xMin, xMax, zMin, zMax);
    }
    let xMin = Infinity;
    let xMax = -Infinity;
    let zMin = Infinity;
    let zMax = -Infinity;
    for (const poi of list) {
      xMin = Math.min(xMin, poi.point.x - (poi.radius * 0.5));
      xMax = Math.max(xMax, poi.point.x + (poi.radius * 0.5));
      zMin = Math.min(zMin, poi.point.z - (poi.radius * 0.5));
      zMax = Math.max(zMax, poi.point.z + (poi.radius * 0.5));
    }
    return boundsFromRect(xMin, xMax, zMin, zMax);
  };

  // Fallback for maps with no flowers: a ring of points so shots still vary.
  const ringFallbackPois = (b: Bounds): Poi[] => {
    const list: Poi[] = [];
    const ringRadius = b.radius * 0.42;
    for (let i = 0; i < 4; i += 1) {
      const a = (i / 4) * TAU;
      const px = b.center.x + (Math.cos(a) * ringRadius);
      const pz = b.center.z + (Math.sin(a) * ringRadius);
      list.push({ point: new Vector3(px, ground(px, pz) + 0.6, pz), radius: 4 });
    }
    return list;
  };

  const ensureLevel = () => {
    const code = getActiveLevelCode();
    if (code === levelCode) {
      return;
    }
    levelCode = code;
    levelSeed = hashString(code);
    pois = computePois();
    bounds = computeBounds(pois);
    ctx = { bounds, ground };
    if (pois.length === 0) {
      pois = ringFallbackPois(bounds);
    }
    current = null;
    next = null;
  };

  // Deterministic, no-adjacent-repeat selection of shot type and POI per segment.
  const pickIndex = (segmentIndex: number, salt: number, count: number) => {
    if (count <= 1) {
      return 0;
    }
    const at = (i: number) => hashInt(levelSeed ^ salt ^ Math.imul(i + 1, 0x9e3779b1)) % count;
    let value = at(segmentIndex);
    if (segmentIndex > 0 && value === at(segmentIndex - 1)) {
      value = (value + 1) % count;
    }
    return value;
  };

  const buildShot = (segmentIndex: number): Shot => {
    const seed = hashInt(levelSeed ^ Math.imul(segmentIndex + 1, 0x85ebca6b));
    const rng = mulberry32(seed);
    const factory = SHOT_FACTORIES[pickIndex(segmentIndex, 0x1234, SHOT_FACTORIES.length)];
    const poi = pois[pickIndex(segmentIndex, 0xabcd, pois.length)] ?? { point: bounds.center.clone(), radius: 6 };
    return factory(poi, ctx, rng);
  };

  const createCarrier = (segmentIndex: number, timeSeconds: number): Carrier => {
    const shot = buildShot(segmentIndex);
    const spawnTime = (segmentIndex * SEGMENT) - WARM_UP;
    const t0 = timeSeconds - spawnTime;
    const pos0 = shot.positionGoal(t0);
    // Initial velocity = path derivative, so the carrier is already in motion the
    // instant it appears (principle 3: the shot begins before the shot begins).
    const vel0 = shot.positionGoal(t0 + 0.12).subtractInPlace(pos0).scaleInPlace(1 / 0.12);
    const facing0 = shot.facingGoal(t0, pos0, vel0);
    return {
      segmentIndex,
      spawnTime,
      shot,
      pos: { value: pos0.clone(), vel: vel0.clone(), force: Vector3.Zero() },
      yaw: { value: facing0.yaw, vel: 0, force: 0 },
      pitch: { value: facing0.pitch, vel: 0, force: 0 },
      roll: { value: facing0.roll, vel: 0, force: 0 },
      fov: { value: shot.fovGoal(t0), vel: 0, force: 0 },
    };
  };

  const stepCarrier = (carrier: Carrier, timeSeconds: number, deltaSeconds: number) => {
    const dt = clamp(deltaSeconds, 0.001, 0.05);
    const t = timeSeconds - carrier.spawnTime;
    const shot = carrier.shot;

    // --- Position: a heavy spring toward the path goal, integrated by hand so a
    // SOFT ground cushion can bleed off the descent BEFORE it reaches the floor
    // (no hard slam against an invisible wall). ---
    const p = shot.pos;
    const goal = shot.positionGoal(t);
    const pull = goal.subtract(carrier.pos.value).scaleInPlace(p.stiffness);
    const resist = carrier.pos.vel.scale(p.drag);
    const desired = clampLength(pull.subtractInPlace(resist), p.maxForce);
    const maxChange = (p.maxForce / p.response) * dt;
    const delta = clampLength(desired.subtractInPlace(carrier.pos.force), maxChange);
    carrier.pos.force.addInPlace(delta);
    carrier.pos.vel.addInPlace(carrier.pos.force.scale(dt / p.mass));

    // Magnetic ground cushion: within cushionRange of the floor the camera feels an
    // upward push that ramps up the closer it gets, plus heavy vertical damping —
    // so a fast dive decelerates smoothly and settles just above the grass instead
    // of slamming to a dead stop. The descent is cushioned, never walled.
    const floorY = ground(carrier.pos.value.x, carrier.pos.value.z) + shot.minClear;
    const cushionRange = 3.5;
    const clearance = carrier.pos.value.y - floorY;
    if (clearance < cushionRange) {
      const closeness = clamp(1 - (clearance / cushionRange), 0, 1.4);
      carrier.pos.vel.y += 18 * closeness * closeness * dt; // upward push, ramps in
      carrier.pos.vel.y -= carrier.pos.vel.y * Math.min(1, 8 * closeness * dt); // damp vertical
    }

    carrier.pos.value.addInPlace(carrier.pos.vel.scale(dt));

    // Last-resort hard stop, well BELOW the cushion — should never be reached.
    const hardFloor = floorY - 0.3;
    if (carrier.pos.value.y < hardFloor) {
      carrier.pos.value.y = hardFloor;
      if (carrier.pos.vel.y < 0) {
        carrier.pos.vel.y = 0;
      }
    }

    const facing = shot.facingGoal(t, carrier.pos.value, carrier.pos.vel);
    scalarSpring(carrier.yaw, facing.yaw, dt, shot.yaw, true);
    // Clamp the GOALS (not just the rendered pose) so the heavy head never even
    // tries to chase the sky or an extreme bank — there is nothing for it to lurch
    // toward, so it cannot lurch.
    scalarSpring(carrier.pitch, clamp(facing.pitch, PITCH_MIN, PITCH_MAX), dt, shot.pitch, false);
    scalarSpring(carrier.roll, clamp(facing.roll, -0.2, 0.2), dt, shot.roll, false);
    scalarSpring(carrier.fov, shot.fovGoal(t), dt, FOV_PARAMS, false);
  };

  const writePose = (carrier: Carrier, pose: AttractPose) => {
    pose.position.copyFrom(carrier.pos.value);
    orientation(carrier.yaw.value, carrier.pitch.value, carrier.roll.value, pose.rotation);
    pose.fov = clamp(carrier.fov.value, 0.4, 1.1);
  };

  const frame = (timeSeconds: number, deltaSeconds: number): AttractFrame => {
    ensureLevel();

    const segmentIndex = Math.floor(timeSeconds / SEGMENT);
    const segmentTime = timeSeconds - (segmentIndex * SEGMENT);
    const nextSpawn = (segmentIndex * SEGMENT) + LIVE;

    // Promote / create the current carrier.
    if (!current || current.segmentIndex !== segmentIndex) {
      if (next && next.segmentIndex === segmentIndex) {
        current = next;
        next = null;
      } else {
        current = createCarrier(segmentIndex, timeSeconds);
      }
    }

    // Once we cross into its warm-up window, spin up the next carrier so it is
    // already gliding by the time the wipe reveals it.
    if (timeSeconds >= nextSpawn) {
      if (!next || next.segmentIndex !== segmentIndex + 1) {
        next = createCarrier(segmentIndex + 1, timeSeconds);
      }
    } else {
      next = null;
    }

    stepCarrier(current, timeSeconds, deltaSeconds);
    if (next) {
      stepCarrier(next, timeSeconds, deltaSeconds);
    }

    writePose(current, primaryPose);
    writePose(next ?? current, secondaryPose);

    // Wipe: pure primary until LIVE, then reveal the (already-moving) next shot.
    const mask = segmentTime < LIVE
      ? 1.2
      : 1 - smootherstep01((segmentTime - LIVE) / TRANSITION);

    const transitionOrdinal = Math.max(0, segmentIndex);
    const wipeCycle = transitionOrdinal % 4;
    const wipeMode = wipeCycle === 0 ? 0 : wipeCycle === 2 ? 2 : 1; // normal, eraser, grass pile, eraser

    return {
      primary: primaryPose,
      secondary: secondaryPose,
      mask,
      direction: 1,
      wipeMode,
      wipeSeed: (hashInt(levelSeed ^ Math.imul(segmentIndex + 1, 0x27d4eb2d)) % 1000) / 1000,
    };
  };

  return {
    frame,
    reset() {
      levelCode = "";
      current = null;
      next = null;
    },
  };
}
