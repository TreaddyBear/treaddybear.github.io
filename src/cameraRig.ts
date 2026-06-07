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

type DragState = {
  active: boolean;
  pointerId: number;
  lastX: number;
  lastY: number;
};

type CameraRigState = {
  orbitYaw: number;
  orbitHeight: number;
  distanceOffset: number;
  adjustmentCount: number;
  adjustmentCooldown: number;
  returnDelay: number;
  returning: boolean;
  isPortrait: boolean;
  perfSampleTime: number;
  currentHardwareScale: number;
  drag: DragState;
};

// Owns the chase camera and everything that aims it: orbit/return-to-behind
// state, right-drag and wheel control, portrait FOV/framing, and optional
// adaptive resolution. The render loop calls updateInput/follow; canvas pointer
// handlers delegate begin/drag/end/zoom.
export function createCameraRig(deps: CameraRigDeps) {
  const {
    scene,
    engine,
    keys,
    analogInput,
    getYaw,
    getPlayerPosition,
    getInputMode,
    perfEl: perfElement,
  } = deps;

  const camera = new ArcRotateCamera("camera", -Math.PI / 2, Math.PI / 3, 16, Vector3.Zero(), scene);
  camera.detachControl();
  camera.lowerRadiusLimit = 8;
  camera.upperRadiusLimit = 24;

  const cameraState: CameraRigState = {
    orbitYaw: 0,
    orbitHeight: 0,
    distanceOffset: 0,
    adjustmentCount: 0,
    adjustmentCooldown: 0,
    returnDelay: 0,
    returning: false,
    isPortrait: false,
    perfSampleTime: 0,
    currentHardwareScale: 1,
    drag: {
      active: false,
      pointerId: -1,
      lastX: 0,
      lastY: 0,
    },
  };

  const markAdjusted = () => {
    if(cameraState.adjustmentCooldown <= 0) {
      cameraState.adjustmentCount += 1;
    }

    cameraState.adjustmentCooldown = 0.45;
    cameraState.returnDelay = Math.min(18, Math.max(2.5, cameraState.adjustmentCount * 2.5));
    cameraState.returning = false;
  };

  const updateProjection = () => {
    const aspect = engine.getRenderWidth() / Math.max(1, engine.getRenderHeight());
    cameraState.isPortrait = aspect < 1;

    if(cameraState.isPortrait) {
      // Portrait (phones): fix the horizontal field of view so left/right stay
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

    isDragging: () => cameraState.drag.active,

    markAdjusted,

    updateProjection,

    reset() {
      cameraState.orbitYaw = 0;
      cameraState.orbitHeight = 0;
      cameraState.distanceOffset = 0;
      cameraState.adjustmentCount = 0;
      cameraState.adjustmentCooldown = 0;
      cameraState.returnDelay = 0;
      cameraState.returning = false;
    },

    beginDrag(pointerId: number, x: number, y: number) {
      cameraState.drag.active = true;
      cameraState.drag.pointerId = pointerId;
      cameraState.drag.lastX = x;
      cameraState.drag.lastY = y;
    },

    // Applies a right-drag orbit. Returns true when the move was consumed as a
    // drag, so the caller skips mouse steering.
    dragTo(pointerId: number, x: number, y: number) {
      if(!cameraState.drag.active || pointerId !== cameraState.drag.pointerId) {
        return false;
      }

      cameraState.orbitYaw -= (x - cameraState.drag.lastX) * 0.006;
      cameraState.orbitHeight += (y - cameraState.drag.lastY) * 0.012;
      cameraState.orbitHeight = Math.max(-1.7, Math.min(4.8, cameraState.orbitHeight));
      markAdjusted();
      cameraState.drag.lastX = x;
      cameraState.drag.lastY = y;
      return true;
    },

    endDrag(pointerId: number) {
      if(pointerId !== cameraState.drag.pointerId) {
        return;
      }

      cameraState.drag.active = false;
      cameraState.drag.pointerId = -1;
    },

    zoom(deltaY: number) {
      cameraState.distanceOffset += deltaY * 0.008;
      cameraState.distanceOffset = Math.max(-3.2, Math.min(7.5, cameraState.distanceOffset));
      markAdjusted();
    },

    updateInput(deltaSeconds: number) {
      let adjusted = false;
      const controllerCameraTurn = analogInput.cameraTurn;
      const controllerCameraPitch = analogInput.cameraPitch;
      const hasCameraStickInput = (
        Math.abs(controllerCameraTurn) > 0
        || Math.abs(controllerCameraPitch) > 0
      );

      if(hasCameraStickInput) {
        cameraState.orbitYaw += controllerCameraTurn * deltaSeconds * 2.2;
        cameraState.orbitHeight -= controllerCameraPitch * deltaSeconds * 2.4;
        adjusted = true;
      }

      if(getInputMode() === "keyboard") {
        const arrowTurn = (keys.has("arrowright") ? 1 : 0) - (keys.has("arrowleft") ? 1 : 0);
        const arrowPitch = (keys.has("arrowdown") ? 1 : 0) - (keys.has("arrowup") ? 1 : 0);
        const hasKeyboardCameraInput = arrowTurn !== 0 || arrowPitch !== 0;

        if(hasKeyboardCameraInput) {
          cameraState.orbitYaw += arrowTurn * deltaSeconds * 2.4;
          cameraState.orbitHeight += arrowPitch * deltaSeconds * 3.1;
          adjusted = true;
        }
      }

      if(adjusted) {
        markAdjusted();
      } else {
        cameraState.adjustmentCooldown = Math.max(0, cameraState.adjustmentCooldown - deltaSeconds);

        const hasManualCameraOffset = (
          Math.abs(cameraState.orbitYaw) > 0.001
          || Math.abs(cameraState.orbitHeight) > 0.001
          || Math.abs(cameraState.distanceOffset) > 0.001
        );

        if(cameraState.adjustmentCount < 7 && hasManualCameraOffset) {
          cameraState.returnDelay -= deltaSeconds;

          if(cameraState.returnDelay <= 0) {
            cameraState.returning = true;
          }
        }
      }

      if(cameraState.returning) {
        const returnAmount = Math.min(1, deltaSeconds / 7);
        cameraState.orbitYaw += (0 - cameraState.orbitYaw) * returnAmount;
        cameraState.orbitHeight += (0 - cameraState.orbitHeight) * returnAmount;
        cameraState.distanceOffset += (0 - cameraState.distanceOffset) * returnAmount;

        const hasReturnedToFollow = (
          Math.abs(cameraState.orbitYaw) < 0.004
          && Math.abs(cameraState.orbitHeight) < 0.004
          && Math.abs(cameraState.distanceOffset) < 0.004
        );

        if(hasReturnedToFollow) {
          cameraState.orbitYaw = 0;
          cameraState.orbitHeight = 0;
          cameraState.distanceOffset = 0;
          cameraState.returning = false;
          cameraState.adjustmentCount = 0;
        }
      }

      cameraState.orbitHeight = Math.max(-1.7, Math.min(4.8, cameraState.orbitHeight));
      cameraState.distanceOffset = Math.max(-3.2, Math.min(7.5, cameraState.distanceOffset));
    },

    follow(deltaSeconds: number) {
      const baseDistance = cameraState.isPortrait ? settings.portraitDistance : 7.2;
      const baseHeight = cameraState.isPortrait ? settings.portraitHeight : 4.2;
      const lookAhead = cameraState.isPortrait ? settings.portraitLookAhead : 0;

      updateFollowCamera(
        camera,
        getPlayerPosition(),
        getYaw(),
        deltaSeconds,
        cameraState.orbitYaw,
        cameraState.orbitHeight,
        cameraState.distanceOffset,
        baseDistance,
        baseHeight,
        lookAhead,
      );
    },

    // Optional adaptive resolution: sample FPS twice a second and nudge the
    // engine hardware-scaling level so a struggling device renders lower-res
    // and a comfortable one returns toward native. Off by default.
    updateAdaptiveResolution(deltaSeconds: number) {
      cameraState.perfSampleTime += deltaSeconds;

      if(cameraState.perfSampleTime < 0.5) {
        return;
      }

      cameraState.perfSampleTime = 0;
      const fps = engine.getFps();

      if(settings.dynamicResolution) {
        const mobileLike = getInputMode() === "touch" || window.innerWidth < 620;
        const maxHardwareScale = mobileLike ? 1.45 : 2;
        const shouldRaiseHardwareScale = (
          fps < settings.targetFps - 5
          && cameraState.currentHardwareScale < maxHardwareScale
        );
        const shouldLowerHardwareScale = (
          fps >= settings.targetFps - 1
          && cameraState.currentHardwareScale > 1
        );

        if(shouldRaiseHardwareScale) {
          cameraState.currentHardwareScale = Math.min(
            maxHardwareScale,
            cameraState.currentHardwareScale + 0.08,
          );
          engine.setHardwareScalingLevel(cameraState.currentHardwareScale);
        } else if(shouldLowerHardwareScale) {
          cameraState.currentHardwareScale = Math.max(1, cameraState.currentHardwareScale - 0.06);
          engine.setHardwareScalingLevel(cameraState.currentHardwareScale);
        }
      } else if(cameraState.currentHardwareScale !== 1) {
        cameraState.currentHardwareScale = 1;
        engine.setHardwareScalingLevel(1);
      }

      if(perfElement && !perfElement.hidden) {
        perfElement.textContent = `${Math.round(fps)} fps \u00B7 ${cameraState.currentHardwareScale.toFixed(2)}x`;
      }
    },
  };
}
