import type { AnalogInput, InputMode } from "./input";
import { lawnLevels, normalizeLevelCode, settings } from "./config";

export type SettingsUi = ReturnType<typeof createSettingsUi>;

export type SettingsUiDeps = {
  settingsRoot: HTMLDetailsElement;
  quickInput: HTMLDivElement;
  analogInput: AnalogInput;
  onRegenerate: () => void;
  refreshGrassColors: () => void;
  refreshGrassMaterial: () => void;
  refreshTextureScales: () => void;
  refreshGroundColor: () => void;
  refreshLighting: () => void;
  refreshLod: () => void;
  updateCameraProjection: () => void;
  syncFenceHealth: () => void;
};

// Input-mode resolution plus the dev settings panel. effectiveInputMode() is
// read every frame by movement/camera; setup() wires the panel and quick input
// selector. Refreshes happen through injected callbacks so this stays UI-only.
export function createSettingsUi(deps: SettingsUiDeps) {
  let lastAppliedInputMode: InputMode = "auto";

  const hasTouchInput = () => navigator.maxTouchPoints > 0 || matchMedia("(pointer: coarse)").matches;
  const hasControllerInput = () => Boolean(navigator.getGamepads().find(Boolean));
  // A genuine touch-first device (phone/tablet): a coarse pointer and no mouse.
  // This deliberately excludes touchscreen laptops so they stay on keyboard/mouse.
  const isTouchPrimaryDevice = () => matchMedia("(pointer: coarse)").matches && !matchMedia("(pointer: fine)").matches;

  // Resolves the user's preference into the concrete device that actually drives
  // the game. In "auto", presence wins in priority order: controller, then
  // touch, then keyboard. Explicitly forced modes are returned unchanged.
  const effectiveInputMode = (): InputMode => {
    if (settings.inputMode !== "auto") {
      return settings.inputMode as InputMode;
    }

    if (hasControllerInput()) {
      return "controller";
    }

    if (isTouchPrimaryDevice()) {
      return "touch";
    }

    return "keyboard";
  };

  // Pushes the resolved device into analogInput, but only when it changes, so a
  // connected controller or touch device engages automatically and touch state
  // is not reset every frame.
  const applyActiveInputMode = () => {
    const resolved = effectiveInputMode();

    if (resolved !== lastAppliedInputMode) {
      deps.analogInput.setMode(resolved);
      lastAppliedInputMode = resolved;
    }
  };

  const syncQuickInputSelection = () => {
    for (const button of deps.quickInput.querySelectorAll<HTMLButtonElement>(".quick-input-button")) {
      button.setAttribute("aria-pressed", String(button.dataset.mode === settings.inputMode));
    }
  };

  const setInputMode = (mode: InputMode) => {
    settings.inputMode = mode;
    applyActiveInputMode();
    const inputModeControl = deps.settingsRoot.querySelector<HTMLSelectElement>("#inputMode");

    if (inputModeControl) {
      inputModeControl.value = mode;
    }

    syncQuickInputSelection();
  };

  const syncQuickInputModes = () => {
    const modes: Array<{ value: InputMode; icon: string; label: string; available: boolean }> = [
      { value: "auto", icon: "A", label: "Auto input", available: true },
      { value: "keyboard", icon: "K", label: "Keyboard", available: true },
      { value: "mouse", icon: "M", label: "Mouse", available: matchMedia("(pointer: fine)").matches },
      { value: "controller", icon: "G", label: "Controller", available: hasControllerInput() },
      { value: "touch", icon: "T", label: "Touchpad", available: hasTouchInput() },
    ];
    deps.quickInput.replaceChildren();

    for (const mode of modes) {
      if (!mode.available) {
        continue;
      }

      const button = document.createElement("button");
      button.type = "button";
      button.className = "quick-input-button";
      button.dataset.mode = mode.value;
      button.textContent = mode.icon;
      button.title = mode.label;
      button.setAttribute("aria-label", mode.label);
      button.addEventListener("click", () => {
        setInputMode(mode.value);
      });
      deps.quickInput.append(button);
    }

    if (!deps.quickInput.querySelector(`[data-mode="${settings.inputMode}"]`)) {
      setInputMode("auto");
      return;
    }

    syncQuickInputSelection();
  };

  // One-time startup pick: a controller or a genuine touch device that is
  // already present wins, otherwise keyboard.
  const detectInitialInputMode = (): InputMode => {
    if (hasControllerInput()) {
      return "controller";
    }

    if (isTouchPrimaryDevice()) {
      return "touch";
    }

    return "keyboard";
  };

  const setup = () => {
    const numberControls = [
      "playerSpeed",
      "playerBoost",
      "minHeight",
      "maxHeight",
      "clumpStrength",
      "heightRandomness",
      "windStrength",
      "bendStrength",
      "mowerAcceleration",
      "mowerTorqueFade",
      "mowerMinTorque",
      "turnMaxSpeed",
      "turnBuild",
      "controllerTurnAccelThreshold",
      "fenceMaxHealth",
      "fenceDamageSpeed",
      "mowerVolume",
      "breezeVolume",
      "ambientBreezeVolume",
      "breezeFacingAmount",
      "grassCuttingVolume",
      "grassCuttingAttackDelay",
      "grassCuttingAttack",
      "grassCuttingDecay",
      "flowerPopVolume",
      "wallBumpVolume",
      "reverseBeepVolume",
      "completionFanfareVolume",
      "completionLoopVolume",
      "gunShotVolume",
      "grassRoughness",
      "grassMetallic",
      "grassClearCoat",
      "cutGrassRoughness",
      "cutGrassMetallic",
      "cutGrassClearCoat",
      "hueVariance",
      "satVariance",
      "lightVariance",
      "grassyTextureScale",
      "dirtTextureUScale",
      "dirtTextureVScale",
      "dirtNormalStrength",
      "roadTextureUScale",
      "roadTextureVScale",
      "skyAmbientIntensity",
      "ssaoStrength",
      "ssaoRadius",
      "ssaoScale",
      "ssaoBlurScale",
      "ssaoSamples",
      "targetFps",
      "fenceBumpTimePenalty",
      "portraitFov",
      "portraitDistance",
      "portraitHeight",
      "portraitLookAhead",
      "lodOpacity",
      "lodHeightTotal",
      "lodBumpAmplitude",
      "lodHeightOffset",
      "lodNoiseScale",
      "lodNormalStrength",
      "lodNormalScale",
      "lodSpecular",
      "lodRoughness",
      "lodSheen",
      "lodSlatHeight",
      "lodSlatTileScale",
      "lodSlatCutoff",
      "lodSlatWiggle",
      "lodSlatWiggleFreq",
      "lodSlatBend",
    ] as const;
    const colorControls = [
      "grassBaseColor",
      "cutGrassRootColor",
      "cutGrassTopColorA",
      "cutGrassTopColorB",
      "groundColor",
      "skyAmbientColor",
      "lodTopColor",
      "lodBottomColor",
    ] as const;
    const checkboxControls = [
      "showFenceHealth",
      "disableFenceCollision",
      "dynamicResolution",
      "autoFinishOnMaxStars",
      "ssaoEnabled",
      "lodShow",
      "lodSlatsShow",
    ] as const;
    const inputModeControl = deps.settingsRoot.querySelector<HTMLSelectElement>("#inputMode");
    const mapControl = deps.settingsRoot.querySelector<HTMLSelectElement>("#mapId");
    let regenerateTimer = 0;

    const scheduleRegenerate = () => {
      window.clearTimeout(regenerateTimer);
      regenerateTimer = window.setTimeout(() => {
        deps.onRegenerate();
      }, 140);
    };

    for (const id of numberControls) {
      const input = deps.settingsRoot.querySelector<HTMLInputElement>(`#${id}`);
      const valueEl = deps.settingsRoot.querySelector<HTMLSpanElement>(`[data-value-for="${id}"]`);

      if (input) {
        input.value = String(settings[id]);

        if (valueEl) {
          valueEl.textContent = input.value;
        }
      }

      input?.addEventListener("input", () => {
        settings[id] = Number(input.value);
        if (valueEl) {
          valueEl.textContent = input.value;
        }

        if (["minHeight", "maxHeight", "clumpStrength", "heightRandomness"].includes(id)) {
          if (settings.minHeight > settings.maxHeight) {
            settings.maxHeight = settings.minHeight;
          }

          scheduleRegenerate();
        } else if (id === "fenceMaxHealth") {
          scheduleRegenerate();
        } else if (["hueVariance", "satVariance", "lightVariance"].includes(id)) {
          deps.refreshGrassColors();
        } else if ([
          "grassRoughness",
          "grassMetallic",
          "grassClearCoat",
          "cutGrassRoughness",
          "cutGrassMetallic",
          "cutGrassClearCoat",
        ].includes(id)) {
          deps.refreshGrassMaterial();
        } else if ([
          "grassyTextureScale",
          "dirtTextureUScale",
          "dirtTextureVScale",
          "dirtNormalStrength",
          "roadTextureUScale",
          "roadTextureVScale",
        ].includes(id)) {
          deps.refreshTextureScales();
        } else if ([
          "skyAmbientIntensity",
          "ssaoStrength",
          "ssaoRadius",
          "ssaoScale",
          "ssaoBlurScale",
          "ssaoSamples",
        ].includes(id)) {
          deps.refreshLighting();
        } else if ([
          "lodOpacity",
          "lodHeightTotal",
          "lodBumpAmplitude",
          "lodHeightOffset",
          "lodNoiseScale",
          "lodNormalStrength",
          "lodNormalScale",
          "lodSpecular",
          "lodRoughness",
          "lodSheen",
          "lodSlatHeight",
          "lodSlatTileScale",
          "lodSlatCutoff",
          "lodSlatWiggle",
          "lodSlatWiggleFreq",
          "lodSlatBend",
        ].includes(id)) {
          deps.refreshLod();
        } else if (id === "portraitFov") {
          deps.updateCameraProjection();
        }
      });
    }

    for (const input of deps.settingsRoot.querySelectorAll<HTMLInputElement>("[data-level-code][data-level-setting]")) {
      const levelCode = normalizeLevelCode(input.dataset.levelCode ?? "");
      const settingName = input.dataset.levelSetting;
      const valueEl = deps.settingsRoot.querySelector<HTMLSpanElement>(`[data-value-for="${input.id}"]`);

      if (settingName !== "parSeconds") {
        continue;
      }

      input.value = String(lawnLevels.settings.parSeconds[levelCode]);

      if (valueEl) {
        valueEl.textContent = input.value;
      }

      input.addEventListener("input", () => {
        lawnLevels.settings.parSeconds[levelCode] = Number(input.value);

        if (valueEl) {
          valueEl.textContent = input.value;
        }
      });
    }

    for (const id of colorControls) {
      const input = deps.settingsRoot.querySelector<HTMLInputElement>(`#${id}`);

      if (input) {
        input.value = settings[id];
      }

      input?.addEventListener("input", () => {
        settings[id] = input.value;

        if (id === "groundColor") {
          deps.refreshGroundColor();
        } else if (id === "skyAmbientColor") {
          deps.refreshLighting();
        } else if (id === "lodTopColor" || id === "lodBottomColor") {
          deps.refreshLod();
        } else {
          deps.refreshGrassColors();
        }
      });
    }

    for (const id of checkboxControls) {
      const input = deps.settingsRoot.querySelector<HTMLInputElement>(`#${id}`);

      if (input) {
        input.checked = Boolean(settings[id]);
      }

      input?.addEventListener("input", () => {
        settings[id] = input.checked;

        if (id === "showFenceHealth") {
          deps.syncFenceHealth();
        } else if (id === "ssaoEnabled") {
          deps.refreshLighting();
        } else if (id === "lodShow" || id === "lodSlatsShow") {
          deps.refreshLod();
        }
      });
    }

    if (inputModeControl) {
      inputModeControl.value = settings.inputMode;
      applyActiveInputMode();
      inputModeControl.addEventListener("input", () => {
        setInputMode(inputModeControl.value as InputMode);
      });
    }

    syncQuickInputModes();
    window.addEventListener("gamepadconnected", syncQuickInputModes);
    window.addEventListener("gamepaddisconnected", syncQuickInputModes);

    if (mapControl) {
      settings.mapId = normalizeLevelCode(settings.mapId);
      mapControl.value = settings.mapId;
      mapControl.addEventListener("input", () => {
        settings.mapId = normalizeLevelCode(mapControl.value);
        deps.onRegenerate();
      });
    }
  };

  return {
    effectiveInputMode,
    applyActiveInputMode,
    setInputMode,
    detectInitialInputMode,
    setup,
  };
}
