import type { InputMode } from "./input";

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
  const resumeLabel = document.querySelector<HTMLSpanElement>("[data-resume-label]");
  const inputModesEl = document.querySelector<HTMLDivElement>("#menuInputModes");
  const levelSelectEl = document.querySelector<HTMLDivElement>("#menuLevelSelect");
  const levelListEl = document.querySelector<HTMLDivElement>("#menuLevelList");

  let open = false;
  let everOpened = false;
  let startMode = false;

  const setResumeLabel = () => {
    if (!resumeLabel) {
      return;
    }

    const hasProgress = deps.getLevels().some((level) => level.bestStars > 0);
    resumeLabel.textContent = startMode
      ? (hasProgress ? "Start Selected" : "Start Game")
      : "Resume";
  };

  const syncInputModes = () => {
    const current = deps.getInputMode();

    for (const button of inputModesEl?.querySelectorAll<HTMLButtonElement>("[data-input-mode]") ?? []) {
      button.setAttribute("aria-pressed", String(button.dataset.inputMode === current));
    }
  };

  const renderLevelSelect = () => {
    if (!levelSelectEl || !levelListEl) {
      return;
    }

    const levels = deps.getLevels();
    const show = levels.some((level) => level.bestStars > 0);
    levelSelectEl.hidden = !show;
    levelListEl.replaceChildren();

    if (!show) {
      setResumeLabel();
      return;
    }

    const currentLevelCode = deps.getCurrentLevelCode();
    for (const level of levels) {
      const button = document.createElement("button");
      const name = document.createElement("span");
      const stars = document.createElement("span");
      const bestStars = Math.max(0, Math.min(3, level.bestStars));

      button.type = "button";
      button.className = "menu-level";
      button.dataset.levelCode = level.code;
      button.setAttribute("aria-current", String(level.code === currentLevelCode));
      name.className = "menu-level-name";
      name.textContent = level.name;
      stars.className = "menu-level-stars";
      stars.textContent = `${"\u2605".repeat(bestStars)}${"\u2606".repeat(3 - bestStars)}`;
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

  menuEl?.addEventListener("click", (event) => {
    const target = event.target as HTMLElement;
    const inputMode = target.closest<HTMLElement>("[data-input-mode]")?.dataset.inputMode as InputMode | undefined;
    const levelCode = target.closest<HTMLElement>("[data-level-code]")?.dataset.levelCode;

    if (inputMode) {
      deps.setInputMode(inputMode);
      syncInputModes();
      return;
    }

    if (levelCode) {
      deps.onSelectLevel(levelCode);
      setOpen(false);
      return;
    }

    const action = target.closest<HTMLElement>("[data-action]")?.dataset.action;
    if (action === "resume") {
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
    // Before the first level the "Resume" item reads as "Start Game".
    setStartMode(start: boolean) {
      startMode = start;
      setResumeLabel();
    },
  };
}
