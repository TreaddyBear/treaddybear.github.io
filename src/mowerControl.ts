// A small imperative command layer for driving the mower, sitting on top of the
// normal per-frame input. Commands are queued and run one at a time; each frame
// the active command reports the turn (-1..1) and throttle (-1..1) it wants, and
// the movement code folds that in exactly like a controller stick. Control is
// closed-loop — "drive 1 m" means "drive until you've travelled ~1 m, then stop"
// — so it stays physical (a little momentum overshoot) rather than teleporting.
//
// This is what a classic-game AI mower would issue later; for now it is also a
// dev hook on window.mower so the vehicle can be scripted from the console:
//   await mower.driveDistance(2); await mower.rotateBy(90); mower.driveTo(0, 0);

export type MowerState = { x: number; z: number; heading: number; speed: number };

// What the active command wants the vehicle to do this frame.
type Drive = { turn: number; throttle: number };

type Command = {
  update: (state: MowerState, deltaSeconds: number) => Drive;
  isDone: (state: MowerState) => boolean;
  resolve: () => void;
};

export type MowerControlDeps = {
  getState: () => MowerState;
};

export type MowerControl = ReturnType<typeof createMowerControl>;

const idle: Drive = { turn: 0, throttle: 0 };

// Wrap an angle to (-pi, pi] so heading errors take the short way round.
const wrapAngle = (angle: number) => {
  let a = angle;
  while (a > Math.PI) {
    a -= Math.PI * 2;
  }
  while (a < -Math.PI) {
    a += Math.PI * 2;
  }
  return a;
};

export function createMowerControl(deps: MowerControlDeps) {
  const queue: Command[] = [];

  // Heading convention matches the movement code: forward = (sin(yaw), cos(yaw)),
  // so the heading that points at (dx, dz) is atan2(dx, dz). 0 = +z.
  const headingTo = (state: MowerState, x: number, z: number) => Math.atan2(x - state.x, z - state.z);

  // Steer toward a target heading: proportional turn that eases off near zero error.
  const steer = (state: MowerState, targetHeading: number) => {
    const error = wrapAngle(targetHeading - state.heading);
    return Math.max(-1, Math.min(1, error * 2.4));
  };

  const enqueue = (make: (resolve: () => void) => Command) => new Promise<void>((resolve) => {
    queue.push(make(resolve));
  });

  // Drains finished commands (including ones already satisfied) and returns the
  // drive the front command wants. Called once per frame by the movement code.
  const update = (deltaSeconds: number): Drive => {
    let state = deps.getState();

    while (queue.length > 0 && queue[0].isDone(state)) {
      queue[0].resolve();
      queue.shift();
      state = deps.getState();
    }

    if (queue.length === 0) {
      return idle;
    }

    return queue[0].update(state, deltaSeconds);
  };

  // Turn in place to an absolute heading (radians, 0 = +z).
  const turnToHeading = (headingRadians: number) => enqueue((resolve) => ({
    update: (state) => ({ turn: steer(state, headingRadians), throttle: 0 }),
    isDone: (state) => Math.abs(wrapAngle(headingRadians - state.heading)) < 0.02 && Math.abs(state.speed) < 0.06,
    resolve,
  }));

  // Rotate by a relative angle in degrees (+ is the same sense as steering right).
  const rotateBy = (degrees: number) => {
    let target = 0;
    let captured = false;
    return enqueue((resolve) => ({
      update: (state) => {
        if (!captured) {
          target = state.heading + (degrees * Math.PI / 180);
          captured = true;
        }
        return { turn: steer(state, target), throttle: 0 };
      },
      isDone: (state) => captured && Math.abs(wrapAngle(target - state.heading)) < 0.02 && Math.abs(state.speed) < 0.06,
      resolve,
    }));
  };

  // Drive straight (current heading) a set distance in metres; negative reverses.
  const driveDistance = (metres: number) => {
    let startX = 0;
    let startZ = 0;
    let captured = false;
    const direction = metres < 0 ? -1 : 1;
    return enqueue((resolve) => ({
      update: (state) => {
        if (!captured) {
          startX = state.x;
          startZ = state.z;
          captured = true;
        }
        return { turn: 0, throttle: direction };
      },
      isDone: (state) => {
        if (!captured) {
          return false;
        }
        const dx = state.x - startX;
        const dz = state.z - startZ;
        return Math.sqrt((dx * dx) + (dz * dz)) >= Math.abs(metres);
      },
      resolve,
    }));
  };

  // Drive to a world point, steering toward it and easing off forward speed while
  // badly misaligned. Stops once within stopRadius metres.
  const driveTo = (x: number, z: number, stopRadius = 0.35) => enqueue((resolve) => ({
    update: (state) => {
      const error = wrapAngle(headingTo(state, x, z) - state.heading);
      const throttle = Math.abs(error) > 1.1 ? 0 : 1;
      return { turn: Math.max(-1, Math.min(1, error * 2.4)), throttle };
    },
    isDone: (state) => {
      const dx = x - state.x;
      const dz = z - state.z;
      return Math.sqrt((dx * dx) + (dz * dz)) <= stopRadius;
    },
    resolve,
  }));

  // Abandon all queued/active commands and let the vehicle coast to a halt.
  const stop = () => {
    for (const command of queue) {
      command.resolve();
    }
    queue.length = 0;
  };

  return {
    update,
    rotateBy,
    turnToHeading,
    driveDistance,
    driveTo,
    stop,
    getState: deps.getState,
    get queueLength() {
      return queue.length;
    },
  };
}
