import { settings } from "./config";

export type AnalogInput = {
  turn: number;
  controllerTurn: number;
  touchTurn: number;
  cameraTurn: number;
  cameraPitch: number;
  throttle: number;
  boost: boolean;
  setMode: (mode: InputMode) => void;
  // Re-sync which touch widget shows (all-in-one vs split) after a settings change.
  syncTouchControls: () => void;
  // Clear the held split throttle (on menu open, end card, or a new level).
  cancelThrottle: () => void;
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

function shapedDeadzone(value: number, threshold: number, exponent: number) {
  const magnitude = Math.abs(value);

  if (magnitude < threshold) {
    return 0;
  }

  const normalized = (magnitude - threshold) / (1 - threshold);
  return Math.sign(value) * Math.pow(normalized, exponent);
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
    syncTouchControls: () => {},
    cancelThrottle: () => {},
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
  const touchRadius = 58;
  // Touch steering shaping: a wider dead zone with a very gentle response just
  // outside it (high exponent keeps small offsets tiny), ramping to full only near
  // the rim — finer control than a near-linear stick.
  const TOUCH_STEER_DEADZONE = 0.34;
  const TOUCH_STEER_EXPONENT = 2.6;
  const touchSteer = () => shapedDeadzone(touch.x / touchRadius, TOUCH_STEER_DEADZONE, TOUCH_STEER_EXPONENT);

  // --- Optional SPLIT touch controls: a steering strip (absolute position, the
  // mower straightens when you let go) and a set-and-hold throttle (reverse /
  // idle / analog-forward zones that stay where you set them). Toggled live by
  // settings.touchSplitControls. ---
  const steerPad = document.querySelector<HTMLElement>("#touchSteer");
  const steerKnob = document.querySelector<HTMLElement>("#touchSteerKnob");
  const throttlePad = document.querySelector<HTMLElement>("#touchThrottle");
  const throttleKnob = document.querySelector<HTMLElement>("#touchThrottleKnob");
  const steer = { active: false, pointerId: -1, originX: 0, x: 0 }; // x = swipe delta in [-1,1]
  const THROTTLE_REST = -0.4; // stop position: centre of the stop band, NOT the pad centre
  const throttleCtl = { active: false, pointerId: -1, p: THROTTLE_REST }; // last Y in [-1,1], persists (locked)
  // Steering is a trackpad: swipe from where you touch, hold the position to hold
  // the steer, release re-centres.
  const SPLIT_STEER_RANGE = 110; // px of swipe for full lock
  const SPLIT_STEER_DEADZONE = 0.1;
  const SPLIT_STEER_EXPONENT = 2.2;

  const splitOn = () => settings.touchSplitControls;

  // Throttle is a set-and-hold slider in thirds (top -> bottom): the top 3/5 is a
  // smooth analog forward, the next 1/5 is stop, the bottom 1/5 is constant reverse.
  const throttleFromP = (p: number) => {
    if (p >= -0.2) {
      return Math.min(1, Math.max(0, (p + 0.2) / 1.2)); // top 3/5: analog forward
    }
    if (p >= -0.6) {
      return 0; // middle 1/5: stop
    }
    return -0.45; // bottom 1/5: constant reverse
  };

  const updateSteerKnob = () => {
    if (!steerKnob) {
      return;
    }
    steerPad?.classList.toggle("active", steer.active);
    const half = ((steerPad?.clientWidth ?? 180) / 2) - 24;
    steerKnob.style.transform = `translate(calc(-50% + ${steer.x * half}px), -50%)`;
  };
  const updateThrottleKnob = () => {
    if (!throttleKnob) {
      return;
    }
    throttlePad?.classList.toggle("active", throttleCtl.active);
    const half = ((throttlePad?.clientHeight ?? 230) / 2) - 26;
    throttleKnob.style.transform = `translate(-50%, calc(-50% + ${-throttleCtl.p * half}px))`;
  };

  // Trackpad: steer by the swipe DELTA from the touch-down point, not absolute
  // position, so a swipe-and-hold holds the steer and a release re-centres.
  const steerDelta = (clientX: number) => clamp((clientX - steer.originX) / SPLIT_STEER_RANGE, -1, 1);
  const throttleAt = (clientY: number) => {
    if (!throttlePad) {
      return 0;
    }
    const rect = throttlePad.getBoundingClientRect();
    return clamp(1 - (((clientY - rect.top) / rect.height) * 2), -1, 1); // top = +1, bottom = -1
  };

  if (steerPad) {
    steerPad.addEventListener("pointerdown", (event) => {
      steer.active = true;
      steer.pointerId = event.pointerId;
      steer.originX = event.clientX;
      steer.x = 0;
      steerPad.setPointerCapture(event.pointerId);
      updateSteerKnob();
    });
    steerPad.addEventListener("pointermove", (event) => {
      if (!steer.active || event.pointerId !== steer.pointerId) {
        return;
      }
      steer.x = steerDelta(event.clientX);
      updateSteerKnob();
    });
    const endSteer = (event: PointerEvent) => {
      if (event.pointerId !== steer.pointerId) {
        return;
      }
      steer.active = false;
      steer.pointerId = -1;
      steer.x = 0; // re-centre (straighten) on release
      updateSteerKnob();
    };
    steerPad.addEventListener("pointerup", endSteer);
    steerPad.addEventListener("pointercancel", endSteer);
  }

  if (throttlePad) {
    throttlePad.addEventListener("pointerdown", (event) => {
      throttleCtl.active = true;
      throttleCtl.pointerId = event.pointerId;
      throttleCtl.p = throttleAt(event.clientY);
      throttlePad.setPointerCapture(event.pointerId);
      updateThrottleKnob();
    });
    throttlePad.addEventListener("pointermove", (event) => {
      if (!throttleCtl.active || event.pointerId !== throttleCtl.pointerId) {
        return;
      }
      throttleCtl.p = throttleAt(event.clientY);
      updateThrottleKnob();
    });
    const endThrottle = (event: PointerEvent) => {
      if (event.pointerId !== throttleCtl.pointerId) {
        return;
      }
      throttleCtl.active = false;
      throttleCtl.pointerId = -1;
      updateThrottleKnob(); // p persists: throttle stays locked where you set it
    };
    throttlePad.addEventListener("pointerup", endThrottle);
    throttlePad.addEventListener("pointercancel", endThrottle);
  }

  const steerTurn = () => (steer.active ? shapedDeadzone(steer.x, SPLIT_STEER_DEADZONE, SPLIT_STEER_EXPONENT) : 0);

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
  const syncTouchControls = () => {
    const showTouch = shouldShowTouchPad();
    const split = showTouch && splitOn();
    touchPad.dataset.mode = (showTouch && !split) ? "visible" : "hidden";
    if (steerPad) {
      steerPad.dataset.mode = split ? "visible" : "hidden";
    }
    if (throttlePad) {
      throttlePad.dataset.mode = split ? "visible" : "hidden";
    }
    if (!split) {
      // No locked throttle / held steer left running behind a hidden widget.
      steer.active = false;
      steer.x = 0;
      throttleCtl.active = false;
      throttleCtl.p = 0;
    }
    updateSteerKnob();
    updateThrottleKnob();
  };

  syncTouchControls();

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

    touch.x = clamp(event.clientX - touch.originX, -touchRadius, touchRadius);
    touch.y = clamp(event.clientY - touch.originY, -touchRadius, touchRadius);
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
      const touchTurn = shouldUseTouch()
        ? (splitOn() ? steerTurn() : (touch.active ? touchSteer() : 0))
        : 0;
      const gamepad = shouldUseController() ? navigator.getGamepads().find(Boolean) : null;
      const gamepadTurn = gamepad ? deadzone(gamepad.axes[0] ?? 0) : 0;
      return clamp(touchTurn + gamepadTurn, -1, 1);
    },

    get controllerTurn() {
      const gamepad = shouldUseController() ? navigator.getGamepads().find(Boolean) : null;
      return gamepad ? deadzone(gamepad.axes[0] ?? 0) : 0;
    },

    get touchTurn() {
      // Wide dead center then a very gentle ramp (see TOUCH_STEER_* above): the
      // first few millimeters outside center barely steer, full lock only near
      // the rim. In split mode this comes from the steering strip instead.
      if (!shouldUseTouch()) {
        return 0;
      }
      return splitOn() ? steerTurn() : (touch.active ? touchSteer() : 0);
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
      const touchThrottle = shouldUseTouch()
        ? (splitOn() ? throttleFromP(throttleCtl.p) : (touch.active ? clamp(-touch.y / touchRadius, -0.45, 1) : 0))
        : 0;
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
      syncTouchControls();

      if (!shouldUseTouch()) {
        touch.active = false;
        touch.pointerId = -1;
        touch.x = 0;
        touch.y = 0;
        updateTouchKnob();
      }
    },

    syncTouchControls,

    cancelThrottle() {
      if (throttleCtl.p === 0 && !throttleCtl.active) {
        return; // already idle — no work / no DOM write
      }
      throttleCtl.active = false;
      throttleCtl.pointerId = -1;
      throttleCtl.p = 0;
      updateThrottleKnob();
    },
  };
}
