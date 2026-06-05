import { ArcRotateCamera, Camera, Vector3 } from "@babylonjs/core";
import type { Engine, Scene } from "@babylonjs/core";
import { settings } from "./config";
import type { AnalogInput, InputMode } from "./input";
import { updateFollowCamera } from "./world";

export type CameraRig = ReturnType<typeof createCameraRig>;

export type CameraRigDeps = {
  scene: Scene;
  engine: Engine;
  keys: Set<string>;
  analogInput: AnalogInput;
  getYaw: () => number;
  getPlayerPosition: () => Vector3;
  getInputMode: () => InputMode;
  perfEl: HTMLDivElement | null;
};

// Owns the chase camera and everything that aims it: orbit/return-to-behind
// state, right-drag and wheel control, portrait FOV/framing, and optional
// adaptive resolution. The render loop calls updateInput/follow; canvas pointer
// handlers delegate begin/drag/end/zoom.
export function createCameraRig(deps: CameraRigDeps) {
  const { scene, engine, keys, analogInput, getYaw, getPlayerPosition, getInputMode, perfEl } = deps;

  const camera = new ArcRotateCamera("camera", -Math.PI / 2, Math.PI / 3, 16, Vector3.Zero(), scene);
  camera.detachControl();
  camera.lowerRadiusLimit = 8;
  camera.upperRadiusLimit = 24;

  let orbitYaw = 0;
  let orbitHeight = 0;
  let distanceOffset = 0;
  let adjustmentCount = 0;
  let adjustmentCooldown = 0;
  let returnDelay = 0;
  let returning = false;
  let isPortrait = false;
  let perfSampleTime = 0;
  let currentHardwareScale = 1;
  const drag = { active: false, pointerId: -1, lastX: 0, lastY: 0 };

  const markAdjusted = () => {
    if (adjustmentCooldown <= 0) {
      adjustmentCount += 1;
    }

    adjustmentCooldown = 0.45;
    returnDelay = Math.min(18, Math.max(2.5, adjustmentCount * 2.5));
    returning = false;
  };

  const updateProjection = () => {
    const aspect = engine.getRenderWidth() / Math.max(1, engine.getRenderHeight());
    isPortrait = aspect < 1;

    if (isPortrait) {
      // Portrait (phones): fix the HORIZONTAL field of view so left/right stay
      // visible without the slit you get from a vertical-fixed FOV on a tall
      // window. The framing (zoom/angle) is handled by the follow camera.
      camera.fovMode = Camera.FOVMODE_HORIZONTAL_FIXED;
      camera.fov = settings.portraitFov;
    } else {
      camera.fovMode = Camera.FOVMODE_VERTICAL_FIXED;
      camera.fov = 0.8;
    }
  };

  updateProjection();

  return {
    camera,

    isDragging: () => drag.active,

    markAdjusted,

    updateProjection,

    reset() {
      orbitYaw = 0;
      orbitHeight = 0;
      distanceOffset = 0;
      adjustmentCount = 0;
      adjustmentCooldown = 0;
      returnDelay = 0;
      returning = false;
    },

    beginDrag(pointerId: number, x: number, y: number) {
      drag.active = true;
      drag.pointerId = pointerId;
      drag.lastX = x;
      drag.lastY = y;
    },

    // Applies a right-drag orbit. Returns true when the move was consumed as a
    // drag (so the caller skips mouse steering).
    dragTo(pointerId: number, x: number, y: number) {
      if (!drag.active || pointerId !== drag.pointerId) {
        return false;
      }

      orbitYaw -= (x - drag.lastX) * 0.006;
      orbitHeight += (y - drag.lastY) * 0.012;
      orbitHeight = Math.max(-1.7, Math.min(4.8, orbitHeight));
      markAdjusted();
      drag.lastX = x;
      drag.lastY = y;
      return true;
    },

    endDrag(pointerId: number) {
      if (pointerId !== drag.pointerId) {
        return;
      }

      drag.active = false;
      drag.pointerId = -1;
    },

    zoom(deltaY: number) {
      distanceOffset += deltaY * 0.008;
      distanceOffset = Math.max(-3.2, Math.min(7.5, distanceOffset));
      markAdjusted();
    },

    updateInput(deltaSeconds: number) {
      let adjusted = false;
      const controllerCameraTurn = analogInput.cameraTurn;
      const controllerCameraPitch = analogInput.cameraPitch;

      if (Math.abs(controllerCameraTurn) > 0 || Math.abs(controllerCameraPitch) > 0) {
        orbitYaw += controllerCameraTurn * deltaSeconds * 2.2;
        orbitHeight -= controllerCameraPitch * deltaSeconds * 2.4;
        adjusted = true;
      }

      if (getInputMode() === "keyboard") {
        const arrowTurn = (keys.has("arrowright") ? 1 : 0) - (keys.has("arrowleft") ? 1 : 0);
        const arrowPitch = (keys.has("arrowdown") ? 1 : 0) - (keys.has("arrowup") ? 1 : 0);

        if (arrowTurn !== 0 || arrowPitch !== 0) {
          orbitYaw += arrowTurn * deltaSeconds * 2.4;
          orbitHeight += arrowPitch * deltaSeconds * 3.1;
          adjusted = true;
        }
      }

      if (adjusted) {
        markAdjusted();
      } else {
        adjustmentCooldown = Math.max(0, adjustmentCooldown - deltaSeconds);

        if (adjustmentCount < 7 && (Math.abs(orbitYaw) > 0.001 || Math.abs(orbitHeight) > 0.001 || Math.abs(distanceOffset) > 0.001)) {
          returnDelay -= deltaSeconds;

          if (returnDelay <= 0) {
            returning = true;
          }
        }
      }

      if (returning) {
        const returnAmount = Math.min(1, deltaSeconds / 7);
        orbitYaw += (0 - orbitYaw) * returnAmount;
        orbitHeight += (0 - orbitHeight) * returnAmount;
        distanceOffset += (0 - distanceOffset) * returnAmount;

        if (Math.abs(orbitYaw) < 0.004 && Math.abs(orbitHeight) < 0.004 && Math.abs(distanceOffset) < 0.004) {
          orbitYaw = 0;
          orbitHeight = 0;
          distanceOffset = 0;
          returning = false;
          adjustmentCount = 0;
        }
      }

      orbitHeight = Math.max(-1.7, Math.min(4.8, orbitHeight));
      distanceOffset = Math.max(-3.2, Math.min(7.5, distanceOffset));
    },

    follow(deltaSeconds: number) {
      const baseDistance = isPortrait ? settings.portraitDistance : 7.2;
      const baseHeight = isPortrait ? settings.portraitHeight : 4.2;
      const lookAhead = isPortrait ? settings.portraitLookAhead : 0;
      updateFollowCamera(camera, getPlayerPosition(), getYaw(), deltaSeconds, orbitYaw, orbitHeight, distanceOffset, baseDistance, baseHeight, lookAhead);
    },

    // Optional adaptive resolution: sample FPS twice a second and nudge the
    // engine hardware-scaling level so a struggling device renders lower-res
    // (smoother) and a comfortable one returns toward native. Off by default.
    updateAdaptiveResolution(deltaSeconds: number) {
      perfSampleTime += deltaSeconds;

      if (perfSampleTime < 0.5) {
        return;
      }

      perfSampleTime = 0;
      const fps = engine.getFps();

      if (settings.dynamicResolution) {
        if (fps < settings.targetFps - 4 && currentHardwareScale < 2.5) {
          currentHardwareScale = Math.min(2.5, currentHardwareScale + 0.15);
          engine.setHardwareScalingLevel(currentHardwareScale);
        } else if (fps > settings.targetFps + 6 && currentHardwareScale > 1) {
          currentHardwareScale = Math.max(1, currentHardwareScale - 0.1);
          engine.setHardwareScalingLevel(currentHardwareScale);
        }
      } else if (currentHardwareScale !== 1) {
        currentHardwareScale = 1;
        engine.setHardwareScalingLevel(1);
      }

      if (perfEl && !perfEl.hidden) {
        perfEl.textContent = `${Math.round(fps)} fps · ${currentHardwareScale.toFixed(2)}x`;
      }
    },
  };
}
