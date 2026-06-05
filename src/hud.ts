import { bladeCount, getActiveMap, settings } from "./config";

export type Hud = ReturnType<typeof createHud>;

export type HudDeps = {
  score: HTMLDivElement;
  meterFill: HTMLDivElement;
  mistakes: HTMLDivElement;
  mistakeMeterFill: HTMLDivElement;
  celebration: HTMLDivElement;
  celebrationSeeds: HTMLDivElement;
  nextLevelButton: HTMLButtonElement;
  loading: HTMLDivElement | null;
  settingsRoot: HTMLDetailsElement;
  getMowed: () => number;
  getMistakes: () => number;
  isArmed: () => boolean;
  playFanfare: () => void;
  setCompletionLoop: (active: boolean) => void;
  onRequestReset: () => void;
};

// The on-screen HUD: mow/mistake meters, the level-complete celebration card,
// the Next Level loading spinner, and mistakes-meter visibility. Reads the live
// counts through getters so it stays decoupled from grass/tulips.
export function createHud(deps: HudDeps) {
  let celebrationShown = false;
  let celebrationHideTimer = 0;

  const showCelebration = () => {
    celebrationShown = true;
    window.clearTimeout(celebrationHideTimer);
    deps.celebrationSeeds.replaceChildren();
    deps.playFanfare();
    deps.setCompletionLoop(true);

    for (let i = 0; i < 96; i += 1) {
      const seed = document.createElement("span");
      const angle = Math.random() * Math.PI * 2;
      const distance = 110 + (Math.random() * 420);
      const verticalLift = 40 + (Math.random() * 220);

      seed.className = "celebration-seed";
      seed.style.setProperty("--seed-x", `${Math.cos(angle) * distance}px`);
      seed.style.setProperty("--seed-y", `${(Math.sin(angle) * distance) - verticalLift}px`);
      seed.style.setProperty("--seed-delay", `${Math.random() * 0.7}s`);
      seed.style.setProperty("--seed-size", `${4 + (Math.random() * 9)}px`);
      seed.style.setProperty("--seed-hue", `${Math.floor(Math.random() * 360)}`);
      deps.celebrationSeeds.append(seed);
    }

    deps.celebration.hidden = false;
    deps.nextLevelButton.focus();
  };

  return {
    isCelebrationVisible() {
      return !deps.celebration.hidden;
    },

    update() {
      const mowed = deps.getMowed();
      const percentage = mowed === bladeCount ? 100 : Math.floor((mowed / bladeCount) * 100);
      deps.score.textContent = `Mowed: ${percentage}%`;
      if (deps.isArmed()) {
        deps.score.textContent += " | Armed";
      }
      deps.meterFill.style.width = `${(mowed / bladeCount) * 100}%`;

      const mistakes = deps.getMistakes();
      deps.mistakes.textContent = `Mistakes: ${mistakes}`;
      deps.mistakeMeterFill.style.width = `${Math.min(100, mistakes * 12)}%`;

      if (percentage === 100 && !celebrationShown) {
        showCelebration();
      }
    },

    resetCelebration() {
      window.clearTimeout(celebrationHideTimer);
      celebrationShown = false;
      deps.celebration.hidden = true;
      deps.celebrationSeeds.replaceChildren();
      deps.setCompletionLoop(false);
    },

    closeCelebration() {
      deps.celebration.hidden = true;
      deps.setCompletionLoop(false);
    },

    goToNextLevel() {
      const nextMap = settings.mapId === "main" ? "flower-court" : "main";
      settings.mapId = nextMap;
      const mapControl = deps.settingsRoot.querySelector<HTMLSelectElement>("#mapId");

      if (mapControl) {
        mapControl.value = nextMap;
      }

      // Building the next lawn (30k blades + dirt mask) blocks for a beat, which
      // on mobile looked like a dead button. Show a spinner and let it paint
      // before the synchronous regen runs.
      const loading = deps.loading;
      if (loading) {
        loading.hidden = false;
        requestAnimationFrame(() => requestAnimationFrame(() => {
          deps.onRequestReset();
          loading.hidden = true;
        }));
        return;
      }

      deps.onRequestReset();
    },

    // The mistakes meter only makes sense where mistakes are possible (maps with
    // protected flowers). On a plain mow-only map it is just hidden.
    syncMistakesVisibility() {
      const show = getActiveMap().flowerBeds.length > 0;
      deps.mistakes.style.display = show ? "" : "none";
      const meter = document.querySelector<HTMLDivElement>("#mistakeMeter");

      if (meter) {
        meter.style.display = show ? "" : "none";
      }
    },
  };
}
