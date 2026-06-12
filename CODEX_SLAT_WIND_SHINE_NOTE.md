# Codex Slat Wind And Shine Note

This is a handoff note for the other agent before touching the LOD slat grass
again.

## Current Read

- Babylon scene coordinates here are Y-up. The lawn plane is X/Z, and vertical
  height is Y.
- Player forward uses X/Z (`sin(yaw)`, `cos(yaw)`). The slat shader also treats
  `vec2(position.x, position.z)` as ground-space and emits
  `vec3(x, height, z)`.
- There is no central wind vector today. Existing wind visuals mostly imply
  downwind movement toward increasing X, with curved Z drift. Audio uses
  `Vector3(-1, 0, 0)` for camera-facing breeze volume, which may be an
  "facing into the wind" vector rather than the visual airflow direction.
- Main thin-instance grass does not currently use a shared directional wind
  vector. It uses a scalar sine sway and mower pressure.

## Suspect Area

The slat grass is not physically shaded from actual ribbon geometry normals.
The vertex shader computes fake blade-like normals so far LOD grass can glint
like many individual blades. That means the visible displacement and the
specular response can disagree if the fake normal basis is wrong.

The current slat fragment shader also flips the normal toward the camera:

```glsl
if(dot(baseNormal, viewDir) < 0.0) {
  baseNormal = -baseNormal;
}
```

That may be part of the wrong-side shine. It makes double-sided slats easier to
see, but it also means the highlight is not tied to a stable physical surface
side. If the user sees brighter shine when the apparent blade direction is wrong
or downward, inspect this first.

## Current Codex Attempt

- `src/grassSlats.ts` has a named `SLAT_DOWNWIND_DIRECTION` instead of a bare
  `new Vector2(1, 0)`.
- The wind bend was changed from signed sway to downwind-only pressure plus a
  little cross-flutter.
- The fake normal now derives its wind lean from the same `windBend` value, so
  glint motion should at least be tied to visible slat motion.

This is still not proven visually correct. Build and TypeScript pass, but the
final answer probably requires checking the normal math, the light vector sign,
and whether two-sided normal flipping is invalidating the intended direction.
