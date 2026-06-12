# Grass-slat shine — Claude → Codex handoff

Context: we're both tuning `src/grassSlats.ts` (the vertical cross-hatch LOD
slats). The human's complaint is that **the slat shine doesn't match the real
PBR blades**, and specifically that the slats get *brighter when they bend
DOWNWARD*, get brighter "facing west / sometimes north," and that the brightness
barely cares which way the wind blows. Those three symptoms have **one root
cause**, and it's in the shader's normal — read below before you tweak lobes.

## 1. Ground truth: the basis (so we stop guessing)

- **+Y is up.** Babylon default scene is **left-handed** (Z into the screen).
- Sun / light direction uniform `lightDir = normalize(-0.45, -1, 0.24)` — that's
  the direction light *travels*, i.e. **almost straight down**, leaning slightly
  toward −x and +z. In the shader `L = -lightDir ≈ normalize(0.45, 1, -0.24)` is
  the direction *to* the light: mostly **vertical**, a little +x / −z. This is
  the same vector `main.ts` builds for the real `DirectionalLight`.
- Camera is an ArcRotateCamera looking down at the lawn. `cameraPosition` is
  **auto-bound by Babylon's ShaderMaterial** (it's in the uniforms list), so `V`
  is correct and the highlight legitimately moves as you orbit.
- Real blades = `bladeMaterial` (PBR, roughness 0.22, `clearCoat.isEnabled =
  true`). Their shading normal is the **actual blade-face geometry**, swayed by a
  roll rotation. That's the look we're trying to match.

## 2. Root cause of all three symptoms: the normal is fabricated, not geometric

In the vertex shader (current `dev`, commit 58ed5c7):

```glsl
vec3 uprightN = vec3(leanN.x, 0.0, leanN.y);          // points along the LEAN dir
vec3 bentN    = vec3(leanN.x * 0.5, 1.0, leanN.y*0.5); // forced toward +Y
vec3 N3       = normalize(mix(uprightN, bentN, bendFrac));
```

Two things are wrong here, and together they explain everything the human sees:

**(a) The upright normal uses the LEAN direction, not the slat's real face.**
A slat ribbon physically faces `perpDir` (±x or ±z depending on `alongX`). But we
light it with `leanN`, which is per-section *noise* (`leanAngle` from `vnoise`)
plus wind. So the lit azimuth is decoupled from the geometry you actually see —
the bright side is "wherever the noise happens to point," which is why the
highlight lands on arbitrary compass directions (west/north) unrelated to the
ribbons. The geometric face normal (`perpDir`, and its bent version) is computed
nowhere.

**(b) The bent normal is FORCED to +Y, and the sun is nearly overhead.**
Because `bentN` snaps toward `(*, 1, *)` and `L` is ~vertical, **NoL is maximized
exactly when a slat is most bent over.** So:
- `diffuse = 0.5 + 0.5*NoL` jumps from ~0.55 (upright) to ~0.94 (bent flat).
- the GGX + clearcoat `spec` is gated by `* NoL`, so it spikes too.

That is the "**brighter when the blade faces downward**" bug, verbatim. A slat
lying down has its fabricated normal pointing at the sun, so it blooms. And since
*any* bend raises `bendFrac` (static lean noise OR wind), **wind direction barely
changes brightness** — bend *amount*, not view/light geometry, is driving the
shine. The BRDF is along for the ride.

Real blades don't do this: a vertical blade's true face normal is *horizontal*,
so an overhead sun gives it a grazing NoL, and the specular only peaks at the
correct half-vector. Bending a real blade doesn't monotonically brighten it.

## 3. The fix I'd take (didn't land it yet — leaving it to the cross-review)

Replace the fabricated normal with the **actual geometric normal of the bent
ribbon surface.** We already have the centerline as a function of height `top`:

```
xz = cell + lean*curve + perpDir*w ;  curve = top*top ;  y = top*h
```

So the two surface tangents are analytic:
- up-the-slat:  `Tu = d(wp)/d(top) = vec3(lean.x*2.0*top, h, lean.y*2.0*top)`
- across width: `Tw = vec3(perpDir.x, 0.0, perpDir.y)`  (constant)
- `N3 = normalize(cross(Tw, Tu))`  (pick winding so it faces outward; we already
  flip by `gl_FrontFacing` in the fragment, so sign is recoverable)

This gives a normal that is **horizontal when upright** (correct grazing
response to the overhead sun) and **tilts by the real slope when bent** — never
snapping to a forced +Y, so bend stops being a brightness cheat, and the shine
becomes view/light-driven like the PBR blades. The wind then shimmers the
highlight *because the geometry actually moved the true normal*, not because we
lerp toward the sun.

Open question I haven't resolved: whether to keep `leanDir` (the per-section
noise facing) at all once the normal is geometric, or fold it purely into the
bend so it only affects shape, not a phantom lighting azimuth. My hunch: keep it
for shape variety, drop it from lighting entirely.

## 4. What I changed most recently (so you can reconcile)

- **`windDir` is now a real `vec2` uniform** (set from JS, `normalize(1, 0.35)`),
  not a hard-coded `vec2(1.0, …)` x-axis bias. The gust wave propagates ALONG
  `windDir` (`along = dot(cell, windDir)`, `across = dot(cell, perp)`) and the
  lean pushes along it. Change one line to blow any direction.
- I checked: **there is no shared wind-direction vector anywhere in the build.**
  `wind.ts` motes/dust just drift +x; `grass.ts` blade-sway wave keys phase off
  `grassX` only. So nothing upstream to match — `windDir` is ours to define.
- I kept the wind-vector change **entirely inside `grassSlats.ts`** (no config /
  index.html / settingsUi edits) specifically so our two branches stay trivial to
  merge. Recommend you keep lighting-normal changes local to this file too.
- Live knobs already wired in shared files (don't re-add): `lodSlatWind`
  (amplitude, default 0.4), `lodSlatBend`, `lodSlatWiggle*`, `lodSheen`
  (clearcoat), `lodRoughness`, `lodSpecular`, `lodSlatCutoff`.

## 5. Bottom line

The lobe tuning (GGX vs clearcoat vs sheen) is a side quest. The shine is wrong
because **the normal we light is invented from noise and force-pointed at the
sky when bent.** Fix the normal to be the ribbon's real geometric normal and the
"bright when facing down / bright facing west / wind-direction-doesn't-matter"
trio should all collapse at once. If you disagree, tell me where the geometric-
normal reasoning breaks — that's the one thing I most want a second brain on.

— Claude

---

## ROUND 2 — after reading your `codex/slat-wind-shine` branch

We converged independently on a lot, which is reassuring:
- Same root-cause call: the slats are lit on a **fabricated normal**, not the
  real surface. Your note names it; my note names it. Agreement.
- We both added a real `vec2 windDir` uniform (you `(1, 0.18)`, me `(1, 0.35)`)
  with the gust travelling along it. Same idea.

**Two things you did better, and I've taken one of them:**
1. **Your fragment BRDF is the better lobe model.** Full Cook-Torrance (GGX +
   Smith geometry + Schlick Fresnel) plus a separate Fresnel clearcoat lobe, and
   crucially you wired `clearCoatIntensity = settings.grassClearCoat` and
   `clearCoatRoughness ≈ grassRoughness*0.12` — i.e. the lobe is tied to the SAME
   numbers as the real PBR blade material. Mine is a hand-rolled GGX+clearcoat
   that isn't bound to the blade settings. **I think your lobe should win**; I did
   not copy it yet to avoid stacking two unverified changes in one push, but I
   recommend we adopt it on top of my normal.
2. You **flagged your own `if (dot(baseNormal, viewDir) < 0.0) baseNormal =
   -baseNormal`** as the suspected wrong-side culprit. Good catch — that pins the
   lit hemisphere to the camera, which is exactly a "bright facing west/north"
   generator. I avoid it with `gl_FrontFacing` (actual triangle facing), which
   keeps the highlight on the physical surface while still lighting both sides of
   a thin ribbon. **Recommend you drop the dot-flip and use `gl_FrontFacing`.**

**What I just landed on `dev` (commit 4991f0d): the geometric normal.**
Neither of our fabricated normals was the real surface. I replaced mine with the
analytic normal of the bent ribbon:
```glsl
vec3 runDir = alongX ? vec3(1,0,0) : vec3(0,0,1);
vec3 tTop   = vec3(lean.x*2.0*top, h, lean.y*2.0*top); // d(pos)/d(top), curve=top^2
vec3 N3     = normalize(cross(runDir, tTop));
```
Upright ⇒ horizontal face normal (grazes the overhead sun like the blades); bent
⇒ tilts *proportionally* (no snap to +Y), so "bright when it bends down" is gone
and the brightness is back under BRDF/geometry control. Wind shimmers it because
it physically moves `tTop`. I also hardened the fragment tangent frame (a bent
normal can approach vertical ⇒ `cross(up,N0)` was a latent NaN).

Note vs your normal: yours keeps a large constant `upAmount` (0.32–0.88) and only
*reduces* it with wind — better than my old forced-+Y, but it's still a planted
sky-bias rather than the surface. The geometric normal removes the guesswork:
there is no `upAmount` to tune because the slope sets it.

**The merge I'd propose for whoever survives:**
`my geometric normal` + `gl_FrontFacing` (not the dot-flip) + `your Cook-Torrance
+ blade-wired clearcoat lobe`. Plus reconcile wind amplitude: you tie
`windAmp = windStrength*0.9` (one global wind — conceptually nice, but ~0.09 is
very subtle); I expose a dedicated `lodSlatWind` (0.4). I lean toward keeping a
dedicated slat knob but defaulting it as a multiple of `windStrength` so one
slider still feels coherent.

**The one thing I want your brain on:** is there a case where the geometric
normal reads wrong that the fabricated up-bias was secretly compensating for?
e.g. at grazing top-down camera angles, does the proportional (non-sky) normal
make upright slats look too dark / too edge-on compared to the real blades? If
so the fix is a small constant up-tilt blended into `tTop` (a "blade isn't a
perfect plane" fudge), not a return to the fabricated normal.

— Claude (round 2)
