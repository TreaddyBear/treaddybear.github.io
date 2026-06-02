export type AnalogInput = {
  turn: number;
  controllerTurn: number;
  touchTurn: number;
  cameraTurn: number;
  cameraPitch: number;
  throttle: number;
  boost: boolean;
  setMode: (mode: InputMode) => void;
};

export type InputMode = "auto" | "keyboard" | "mouse" | "controller" | "touch";

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function deadzone(value: number, threshold = 0.18) {
  if (Math.abs(value) < threshold) {
    return 0;
  }

  return Math.sign(value) * ((Math.abs(value) - threshold) / (1 - threshold));
}

export function createInputController(touchPad: HTMLElement, touchKnob: HTMLElement): AnalogInput {
  const state: AnalogInput = {
    turn: 0,
    controllerTurn: 0,
    touchTurn: 0,
    cameraTurn: 0,
    cameraPitch: 0,
    throttle: 0,
    boost: false,
    setMode: () => {},
  };
  let inputMode: InputMode = "auto";
  const touch = {
    active: false,
    pointerId: -1,
    originX: 0,
    originY: 0,
    x: 0,
    y: 0,
  };

  const updateTouchKnob = () => {
    if (!touch.active) {
      touchPad.classList.remove("active");
      touchKnob.style.transform = "translate(-50%, -50%)";
      return;
    }

    touchPad.classList.add("active");
    touchKnob.style.transform = `translate(calc(-50% + ${touch.x}px), calc(-50% + ${touch.y}px))`;
  };

  const shouldUseTouch = () => inputMode === "auto" || inputMode === "touch";
  const shouldUseController = () => inputMode === "auto" || inputMode === "controller";
  const shouldShowTouchPad = () => inputMode === "touch" || (inputMode === "auto" && matchMedia("(pointer: coarse)").matches);
  const syncTouchVisibility = () => {
    touchPad.dataset.mode = shouldShowTouchPad() ? "visible" : "hidden";
  };

  syncTouchVisibility();

  touchPad.addEventListener("pointerdown", (event) => {
    touch.active = true;
    touch.pointerId = event.pointerId;
    touch.originX = event.clientX;
    touch.originY = event.clientY;
    touch.x = 0;
    touch.y = 0;
    touchPad.setPointerCapture(event.pointerId);
    updateTouchKnob();
  });

  touchPad.addEventListener("pointermove", (event) => {
    if (!touch.active || event.pointerId !== touch.pointerId) {
      return;
    }

    touch.x = clamp(event.clientX - touch.originX, -54, 54);
    touch.y = clamp(event.clientY - touch.originY, -54, 54);
    updateTouchKnob();
  });

  const endTouch = (event: PointerEvent) => {
    if (event.pointerId !== touch.pointerId) {
      return;
    }

    touch.active = false;
    touch.pointerId = -1;
    touch.x = 0;
    touch.y = 0;
    updateTouchKnob();
  };

  touchPad.addEventListener("pointerup", endTouch);
  touchPad.addEventListener("pointercancel", endTouch);

  return {
    get turn() {
      const touchTurn = touch.active && shouldUseTouch() ? deadzone(touch.x / 54) : 0;
      const gamepad = shouldUseController() ? navigator.getGamepads().find(Boolean) : null;
      const gamepadTurn = gamepad ? deadzone(gamepad.axes[0] ?? 0) : 0;
      return clamp(touchTurn + gamepadTurn, -1, 1);
    },

    get controllerTurn() {
      const gamepad = shouldUseController() ? navigator.getGamepads().find(Boolean) : null;
      return gamepad ? deadzone(gamepad.axes[0] ?? 0) : 0;
    },

    get touchTurn() {
      // Same feel as the analog stick: a dead center, then gentle proportional
      // turning. The turn-acceleration ramp on the sides is applied downstream
      // once this passes controllerTurnAccelThreshold, exactly like the gamepad.
      return touch.active && shouldUseTouch() ? deadzone(touch.x / 54) : 0;
    },

    get cameraTurn() {
      const gamepad = shouldUseController() ? navigator.getGamepads().find(Boolean) : null;
      return gamepad ? deadzone(gamepad.axes[2] ?? 0, 0.14) : 0;
    },

    get cameraPitch() {
      const gamepad = shouldUseController() ? navigator.getGamepads().find(Boolean) : null;
      return gamepad ? deadzone(gamepad.axes[3] ?? 0, 0.14) : 0;
    },

    get throttle() {
      const touchThrottle = touch.active && shouldUseTouch() ? clamp(-touch.y / 54, -0.45, 1) : 0;
      const gamepad = shouldUseController() ? navigator.getGamepads().find(Boolean) : null;
      const stickY = gamepad ? deadzone(gamepad.axes[1] ?? 0) : 0;
      const gamepadThrottle = stickY < 0 ? -stickY : stickY > 0 ? -stickY * 0.45 : 0;
      return clamp(touchThrottle + gamepadThrottle, -0.45, 1);
    },

    get boost() {
      const gamepad = shouldUseController() ? navigator.getGamepads().find(Boolean) : null;
      return Boolean(gamepad?.buttons[0]?.pressed || gamepad?.buttons[7]?.pressed);
    },

    setMode(mode: InputMode) {
      inputMode = mode;
      syncTouchVisibility();

      if (!shouldUseTouch()) {
        touch.active = false;
        touch.pointerId = -1;
        touch.x = 0;
        touch.y = 0;
        updateTouchKnob();
      }
    },
  };
}
