import type { InputMode } from "./input";
import { settings } from "./config";
import { setTouchSplitControls } from "./localSettings";

export type MenuLevel = {
  code: string;
  name: string;
  bestStars: number;
};

export type MenuDeps = {
  // Toggle real fullscreen (reuses the existing fullscreen button's handler).
  toggleFullscreen: () => void;
  getInputMode: () => InputMode;
  setInputMode: (mode: InputMode) => void;
  getLevels: () => MenuLevel[];
  getCurrentLevelCode: () => string;
  onSelectLevel: (code: string) => void;
  // True on a touch-first device: show the hamburger; otherwise Esc opens it.
  isTouch: boolean;
  // Re-sync which touch widget shows after the split-controls toggle changes.
  onTouchControlsChange?: () => void;
  // Apply the master volume slider value (0..1) to the audio engine.
  onMasterVolume?: (value: number) => void;
  // Called when the menu opens/closes so the game can pause/resume.
  onOpen?: () => void;
  onClose?: () => void;
};

export type Menu = ReturnType<typeof createMenu>;

// The pause/start menu overlay. Owns its DOM (#menu and the #menuButton
// hamburger) and the FPS toggle (#perf visibility). Opening pauses the game via
// the onOpen/onClose hooks the caller wires into the render loop.
export function createMenu(deps: MenuDeps) {
  const menuEl = document.querySelector<HTMLDivElement>("#menu");
  const menuButton = document.querySelector<HTMLButtonElement>("#menuButton");
  const fpsCheckbox = document.querySelector<HTMLInputElement>("#menuFps");
  const perfEl = document.querySelector<HTMLElement>("#perf");
  const menuTitleEl = document.querySelector<HTMLElement>("#menuTitle");
  const resumeLabel = document.querySelector<HTMLSpanElement>("[data-resume-label]");
  const inputModesEl = document.querySelector<HTMLDivElement>("#menuInputModes");
  const inputSwapSlot = document.querySelector<HTMLDivElement>("#menuInputSwapSlot");
  const touchSplitRow = document.querySelector<HTMLElement>("#menuTouchSplitRow");
  const inputOverflowEl = document.querySelector<HTMLDivElement>("#menuInputOverflow");
  const levelSelectEl = document.querySelector<HTMLDivElement>("#menuLevelSelect");
  const levelListEl = document.querySelector<HTMLDivElement>("#menuLevelList");

  let open = false;
  let everOpened = false;
  let startMode = false;
  let selectedLevelCode = "";
  let selectedLevelManual = false;

  const swappableInputModes: InputMode[] = ["controller", "mouse", "touch"];

  const expanderEntries = () => (
    [...document.querySelectorAll<HTMLDetailsElement>("[data-menu-expander]")]
      .map((details) => {
        const key = details.dataset.menuExpander;
        const panel = key
          ? document.querySelector<HTMLElement>(`[data-menu-panel="${key}"]`)
          : null;
        return key && panel ? { key, details, panel } : null;
      })
      .filter((entry): entry is { key: string; details: HTMLDetailsElement; panel: HTMLElement } => Boolean(entry))
  );

  const setExpanderOpen = (entry: { details: HTMLDetailsElement; panel: HTMLElement }, expanded: boolean) => {
    entry.details.open = expanded;
    entry.panel.classList.toggle("is-open", expanded);
    entry.panel.setAttribute("aria-hidden", String(!expanded));
    entry.panel.toggleAttribute("inert", !expanded);
  };

  const closeExpanders = (exceptKey = "") => {
    for (const entry of expanderEntries()) {
      if (entry.key !== exceptKey) {
        setExpanderOpen(entry, false);
      }
    }
  };

  const toggleExpander = (key: string) => {
    const entry = expanderEntries().find((candidate) => candidate.key === key);
    if (!entry) {
      return;
    }

    if (entry.details.open) {
      setExpanderOpen(entry, false);
      return;
    }

    closeExpanders(key);
    setExpanderOpen(entry, true);
  };

  const renderStars = (container: HTMLElement, bestStars: number) => {
    const starCount = Math.max(0, Math.min(3, bestStars));
    container.replaceChildren();
    for (let starIndex = 0; starIndex < 3; starIndex += 1) {
      const star = document.createElement("span");
      star.className = starIndex < starCount ? "menu-star earned" : "menu-star";
      star.textContent = "\u2605";
      container.append(star);
    }
  };

  const automaticLevelCode = (levels: MenuLevel[]) => {
    if (levels.length <= 0) {
      return deps.getCurrentLevelCode();
    }

    if (!startMode) {
      const currentLevelCode = deps.getCurrentLevelCode();
      return levels.some((level) => level.code === currentLevelCode)
        ? currentLevelCode
        : levels[0].code;
    }

    let newestZeroStarLevel: MenuLevel | null = null;
    for (const level of levels) {
      if (level.bestStars <= 0) {
        newestZeroStarLevel = level;
      }
    }

    return (newestZeroStarLevel ?? levels[levels.length - 1]).code;
  };

  const syncSelectedLevel = () => {
    const levels = deps.getLevels();
    const selectedIsValid = levels.some((level) => level.code === selectedLevelCode);

    if (!selectedLevelManual || !selectedIsValid) {
      selectedLevelCode = automaticLevelCode(levels);
      selectedLevelManual = false;
    }

    return levels;
  };

  const setResumeLabel = () => {
    if (!resumeLabel) {
      return;
    }

    const levels = deps.getLevels();

    if (selectedLevelManual) {
      resumeLabel.textContent = "Play Selected Level";
      return;
    }

    if (startMode) {
      const hasProgress = levels.some((level) => level.bestStars > 0);
      const firstLevelCode = levels[0]?.code ?? selectedLevelCode;
      resumeLabel.textContent = !hasProgress && selectedLevelCode === firstLevelCode
        ? "Start Game"
        : "Continue Game";
      return;
    }

    resumeLabel.textContent = "Resume";
  };

  const syncInputModes = () => {
    const current = deps.getInputMode();
    // Split-touch toggle shows ONLY for explicit Touch ("T"), or Auto ("A") on a
    // true mobile device (touch-primary: coarse pointer and no fine pointer) —
    // never for keyboard/mouse/controller, or Auto on a desktop/touchscreen laptop.
    const isMobile = matchMedia("(pointer: coarse)").matches && !matchMedia("(pointer: fine)").matches;
    const showSplitToggle = current === "touch" || (current === "auto" && isMobile);
    if (touchSplitRow) {
      touchSplitRow.hidden = !showSplitToggle;
    }
    const primaryMode = swappableInputModes.includes(current)
      ? current
      : "controller";

    if (inputSwapSlot && inputOverflowEl) {
      for (const mode of swappableInputModes) {
        const button = inputModesEl?.querySelector<HTMLButtonElement>(`[data-input-mode="${mode}"]`);
        if (!button) {
          continue;
        }

        if (mode === primaryMode) {
          inputSwapSlot.append(button);
        } else {
          inputOverflowEl.append(button);
        }
      }
    }

    for (const button of inputModesEl?.querySelectorAll<HTMLButtonElement>("[data-input-mode]") ?? []) {
      button.setAttribute("aria-pressed", String(button.dataset.inputMode === current));
    }
  };

  const renderLevelSelect = () => {
    if (!levelSelectEl || !levelListEl) {
      return;
    }

    const levels = syncSelectedLevel();

    levelSelectEl.hidden = false;
    levelListEl.replaceChildren();

    if (levels.length <= 0) {
      setResumeLabel();
      return;
    }

    for (const level of levels) {
      const button = document.createElement("button");
      const name = document.createElement("span");
      const stars = document.createElement("span");

      button.type = "button";
      button.className = "menu-level";
      button.dataset.levelCode = level.code;
      button.setAttribute("aria-current", String(level.code === selectedLevelCode));
      name.className = "menu-level-name";
      name.textContent = level.name;
      stars.className = "menu-level-stars";
      renderStars(stars, level.bestStars);
      button.append(name, stars);
      levelListEl.append(button);
    }

    setResumeLabel();
  };

  const setOpen = (value: boolean) => {
    if (value === open) {
      return;
    }
    open = value;
    if (menuEl) {
      menuEl.hidden = !value;
    }
    if (value) {
      everOpened = true;
      closeExpanders();
      selectedLevelManual = false;
      syncInputModes();
      renderLevelSelect();
      deps.onOpen?.();
    } else {
      deps.onClose?.();
    }
  };

  // FPS visibility is driven entirely by the checkbox (default on for now).
  const syncFps = () => {
    if (perfEl) {
      perfEl.hidden = !(fpsCheckbox?.checked ?? false);
    }
  };
  syncFps();
  fpsCheckbox?.addEventListener("change", syncFps);
  closeExpanders();
  for (const entry of expanderEntries()) {
    entry.details.addEventListener("toggle", () => {
      if (entry.details.open) {
        closeExpanders(entry.key);
      }
      setExpanderOpen(entry, entry.details.open);
    });
  }

  // Reverse-steer flip: lets players who dislike the mirrored reverse restore the
  // old un-mirrored feel. In-session for now (a proper input panel + persistence
  // is the planned follow-up).
  const reverseFlipCheckbox = document.querySelector<HTMLInputElement>("#menuReverseFlip");
  if (reverseFlipCheckbox) {
    reverseFlipCheckbox.checked = settings.reverseSteerFlip;
    reverseFlipCheckbox.addEventListener("change", () => {
      settings.reverseSteerFlip = reverseFlipCheckbox.checked;
    });
  }

  // Split touch controls: separate steering strip + set-and-hold throttle vs the
  // all-in-one thumbpad. input.ts re-syncs which widget shows via the callback.
  const touchSplitCheckbox = document.querySelector<HTMLInputElement>("#menuTouchSplit");
  if (touchSplitCheckbox) {
    touchSplitCheckbox.checked = settings.touchSplitControls;
    touchSplitCheckbox.addEventListener("change", () => {
      settings.touchSplitControls = touchSplitCheckbox.checked;
      setTouchSplitControls(settings.touchSplitControls);
      deps.onTouchControlsChange?.();
    });
  }

  const masterVolumeSlider = document.querySelector<HTMLInputElement>("#menuMasterVolume");
  if (masterVolumeSlider) {
    masterVolumeSlider.value = String(settings.masterVolume);
    masterVolumeSlider.addEventListener("input", () => {
      settings.masterVolume = Number(masterVolumeSlider.value);
      deps.onMasterVolume?.(settings.masterVolume);
    });
  }

  const muteBlurCheckbox = document.querySelector<HTMLInputElement>("#menuMuteBlur");
  if (muteBlurCheckbox) {
    muteBlurCheckbox.checked = settings.muteOnBlur;
    muteBlurCheckbox.addEventListener("change", () => {
      settings.muteOnBlur = muteBlurCheckbox.checked;
    });
  }

  const scheduleLogoShimmer = () => {
    window.setTimeout(() => {
      menuTitleEl?.classList.add("logo-shimmer");
      window.setTimeout(() => menuTitleEl?.classList.remove("logo-shimmer"), 1800);
      scheduleLogoShimmer();
    }, 20000 + (Math.random() * 100000));
  };
  scheduleLogoShimmer();

  menuEl?.addEventListener("click", (event) => {
    const target = event.target as HTMLElement;
    const inputMode = target.closest<HTMLElement>("[data-input-mode]")?.dataset.inputMode as InputMode | undefined;
    const levelCode = target.closest<HTMLElement>("[data-level-code]")?.dataset.levelCode;
    const expanderKey = target.closest<HTMLElement>("[data-menu-open]")?.dataset.menuOpen;

    if (expanderKey) {
      toggleExpander(expanderKey);
      return;
    }

    if (inputMode) {
      deps.setInputMode(inputMode);
      syncInputModes();
      closeExpanders();
      return;
    }

    if (levelCode) {
      selectedLevelCode = levelCode;
      selectedLevelManual = true;
      renderLevelSelect();
      closeExpanders();
      return;
    }

    const action = target.closest<HTMLElement>("[data-action]")?.dataset.action;
    if (action === "resume") {
      if (startMode || selectedLevelManual) {
        const levels = syncSelectedLevel();
        const levelCodeToPlay = selectedLevelCode || automaticLevelCode(levels);
        deps.onSelectLevel(levelCodeToPlay);
        selectedLevelManual = false;
      }
      setOpen(false);
    } else if (action === "fullscreen") {
      deps.toggleFullscreen();
    }
  });

  if (deps.isTouch && menuButton) {
    menuButton.hidden = false;
    menuButton.addEventListener("click", () => setOpen(!open));
  }

  return {
    isOpen: () => open,
    hasOpened: () => everOpened,
    open: () => setOpen(true),
    close: () => setOpen(false),
    toggle: () => setOpen(!open),
    // Before the first level this primary action reads as Start/Continue.
    setStartMode(start: boolean) {
      startMode = start;
      selectedLevelManual = false;
      renderLevelSelect();
      setResumeLabel();
    },
  };
}
