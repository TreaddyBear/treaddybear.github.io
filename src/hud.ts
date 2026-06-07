import { bladeCount, settings } from "./config";
import { createStarMeter } from "./starMeter";
import { earnedStarsForRun, limitingFactor, nextStarOutOfReach } from "./scoring";
import type { LimitingFactor, StarMode } from "./scoring";

export type Hud = ReturnType<typeof createHud>;
type ResultReason = "complete" | "out-of-reach" | "time-up" | "maxed" | "offer" | "good-enough";
type GrassHelpResult = { cleared: number; remaining: number; onlyIsolated: boolean };

export type HudDeps = {
  score: HTMLDivElement;
  timer: HTMLDivElement;
  mistakes: HTMLDivElement;
  mistakeMeterFill: HTMLDivElement;
  celebration: HTMLDivElement;
  celebrationSeeds: HTMLDivElement;
  nextLevelButton: HTMLButtonElement;
  closeCelebrationButton: HTMLButtonElement;
  reportCardButton: HTMLButtonElement;
  finishRunButton: HTMLButtonElement;
  resultStars: HTMLDivElement;
  resultStats: HTMLDivElement;
  resultCoach: HTMLDivElement;
  timeup: HTMLDivElement;
  retryButton: HTMLButtonElement;
  loading: HTMLDivElement | null;
  settingsRoot: HTMLDetailsElement;
  getMowed: () => number;
  getMistakes: () => number;
  getFlowerMistakes: () => number;
  getFenceMistakes: () => number;
  getElapsedSeconds: () => number;
  isArmed: () => boolean;
  playFanfare: () => void;
  setCompletionLoop: (active: boolean) => void;
  clearIsolatedGrass: () => GrassHelpResult;
  onRequestHelp: () => GrassHelpResult;
  onRequestReset: () => void;
};

// The on-screen HUD: mow/mistake meters, the level-complete celebration card,
// the Next Level loading spinner, and mistakes-meter visibility. Reads the live
// counts through getters so it stays decoupled from grass/tulips.
export function createHud(deps: HudDeps) {
  let celebrationShown = false;
  let celebrationHideTimer = 0;
  let bestStars = 0;
  let currentResultReason: ResultReason | null = null;
  let softPromptShown = false;
  let lastMowedCount = deps.getMowed();
  let lastMowProgressSeconds = performance.now() / 1000;
  const starMeter = createStarMeter();
  const starMode: StarMode = 3;

  const formatTime = (seconds: number) => {
    const whole = Math.max(0, Math.floor(seconds));
    const minutes = Math.floor(whole / 60);
    const remainder = (whole % 60).toString().padStart(2, "0");
    return `${minutes}:${remainder}`;
  };

  const verdictFor = (
    factor: LimitingFactor,
    stars: number,
    grassPercent: number,
    flowerMistakes: number,
    fenceMistakes: number,
  ) => {
    if (stars >= starMode) {
      return "Immaculate. The neighbours are jealous.";
    }

    if (grassPercent >= 100 && factor === "none") {
      return "Clean cut. There is still a better route in there.";
    }

    if (factor === "mistakes") {
      if (flowerMistakes > 0 && fenceMistakes === 0) {
        return "Mind the flowers!";
      }

      if (fenceMistakes > 0 && flowerMistakes === 0) {
        return "Ease off the fence!";
      }

      if (flowerMistakes > 0 && fenceMistakes > 0) {
        return "Careful around flowers and fences.";
      }

      return "Clean up the mistakes.";
    }

    if (factor === "time") {
      return "A touch quicker!";
    }

    return "Mow a bit more!";
  };

  const coachFor = (
    factor: LimitingFactor,
    stars: number,
    grassPercent: number,
    mistakes: number,
    flowerMistakes: number,
    fenceMistakes: number,
  ) => {
    if (stars >= starMode && grassPercent >= 100 && mistakes === 0) {
      return "Nothing obvious to clean up. That was the tidy version.";
    }

    if (factor === "mistakes") {
      if (flowerMistakes > 0 && fenceMistakes === 0) {
        return "The flower bed was the expensive part. Give the brown bed a wider berth, then tighten up once the safe lane is clear.";
      }

      if (fenceMistakes > 0 && flowerMistakes === 0) {
        return "Fence crashes were the expensive part. Slow nudges are fine, but boost-speed hits cost the run and chew through the planks.";
      }

      if (flowerMistakes > 0 && fenceMistakes > 0) {
        return "Mistakes hurt fast. Give flower beds and fence lines a little more room, then speed up once the path is clear.";
      }

      return "Mistakes hurt fast. The report card could not pin them to one source, so treat the next run as a cleaner-control pass.";
    }

    if (factor === "time") {
      return "Your route is close. Try longer straight passes, fewer fence bumps, and use boost only when the mower is already lined up.";
    }

    return "There was still grass left on the lawn. Sweep the edges, corners, and the little remaining islands before ending the run.";
  };

  const renderResultDetails = (stars: number, grassPercent: number, elapsedSeconds: number, mistakes: number) => {
    deps.resultStars.replaceChildren();

    for (let i = 0; i < starMode; i += 1) {
      const star = document.createElement("span");
      star.className = i < stars ? "result-star-full" : "result-star-empty";
      star.textContent = i < stars ? "\u2605" : "\u2606";
      deps.resultStars.append(star);
    }

    deps.resultStats.replaceChildren();

    const rows = [
      ["Grass", `${Math.floor(grassPercent)}%`],
      ["Time", formatTime(elapsedSeconds)],
      ["Mistakes", `${mistakes}`],
    ];

    for (const [label, value] of rows) {
      const row = document.createElement("div");
      const labelEl = document.createElement("span");
      const valueEl = document.createElement("strong");

      labelEl.textContent = label;
      valueEl.textContent = value;
      row.append(labelEl, valueEl);
      deps.resultStats.append(row);
    }
  };

  const resultTitleFor = (
    reason: ResultReason,
    factor: LimitingFactor,
    stars: number,
    grassPercent: number,
    mistakes: number,
  ) => {
    if (reason === "offer") {
      return "Fine Work";
    }

    if (reason === "good-enough") {
      return "Good Enough";
    }

    if (reason === "maxed") {
      return "Three Stars";
    }

    if (reason === "time-up") {
      return "Not Fast Enough";
    }

    if (stars >= starMode && grassPercent >= 100) {
      return mistakes === 0 ? "Perfect Cut" : "Clean Cut";
    }

    if (reason === "out-of-reach") {
      if (stars < 1) {
        return "Oops";
      }

      if (factor === "mistakes") {
        return "Too Many Mistakes";
      }

      if (factor === "time") {
        return "Not Fast Enough";
      }

      if (factor === "grass") {
        return "Mow More Grass";
      }
    }

    return "Run Complete";
  };

  const offerSubtitleFor = (stars: number) => {
    if (stars >= 1) {
      return "Keep mowing, get a little help, or head to the next lawn.";
    }

    return "Give it another pass and clean up one thing at a time.";
  };

  const hideResultCard = () => {
    window.clearTimeout(celebrationHideTimer);
    celebrationShown = false;
    currentResultReason = null;
    deps.celebration.hidden = true;
    deps.celebration.dataset.result = "";
    deps.celebrationSeeds.replaceChildren();
    deps.resultCoach.hidden = true;
    deps.reportCardButton.textContent = "Report Card";
    deps.setCompletionLoop(false);
  };

  const requestHelpAndContinue = () => {
    const help = deps.onRequestHelp();
    hideResultCard();

    if (help.cleared > 0 && help.remaining === 0) {
      showResult("good-enough");
    }
  };

  const shouldOfferPrompt = (
    grassPercent: number,
    stars: number,
    elapsedSeconds: number,
    mistakes: number,
  ) => {
    if (softPromptShown || stars < 1 || !nextStarOutOfReach(stars, starMode, elapsedSeconds, mistakes)) {
      return false;
    }

    const remainingPercent = Math.max(0, 100 - grassPercent);
    if (remainingPercent > 20) {
      return false;
    }

    const now = performance.now() / 1000;
    const stallDelay = remainingPercent <= 10
      ? 10
      : 10 + (((remainingPercent - 10) / 10) * 10);

    return (now - lastMowProgressSeconds) >= stallDelay;
  };

  const showResult = (reason: ResultReason) => {
    if (celebrationShown) {
      return;
    }

    celebrationShown = true;
    currentResultReason = reason;
    softPromptShown ||= reason === "offer" || reason === "good-enough";
    window.clearTimeout(celebrationHideTimer);
    deps.celebrationSeeds.replaceChildren();
    deps.setCompletionLoop(false);
    const mowed = deps.getMowed();
    const grassPercent = (mowed / bladeCount) * 100;
    const elapsedSeconds = deps.getElapsedSeconds();
    const mistakes = deps.getMistakes();
    const flowerMistakes = deps.getFlowerMistakes();
    const fenceMistakes = deps.getFenceMistakes();
    const stars = Math.max(bestStars, earnedStarsForRun(grassPercent, elapsedSeconds, mistakes, starMode));
    const factor = limitingFactor(grassPercent, elapsedSeconds, mistakes, starMode);

    bestStars = stars;
    deps.celebration.dataset.result = reason;
    deps.celebration.querySelector("#celebrationTitle")!.textContent = resultTitleFor(reason, factor, stars, grassPercent, mistakes);
    deps.celebration.querySelector("#celebrationSubtitle")!.textContent = reason === "offer"
      ? offerSubtitleFor(stars)
      : reason === "good-enough"
        ? "The rest was just stray single blades. That lawn is done enough."
        : verdictFor(
          factor,
          stars,
          grassPercent,
          flowerMistakes,
          fenceMistakes,
        );
    renderResultDetails(stars, grassPercent, elapsedSeconds, mistakes);
    deps.resultCoach.textContent = coachFor(factor, stars, grassPercent, mistakes, flowerMistakes, fenceMistakes);
    deps.resultCoach.hidden = true;

    if (reason !== "offer") {
      deps.playFanfare();
      deps.setCompletionLoop(true);
    }

    const perfect = reason === "complete" && stars >= starMode && mistakes === 0;
    const unlockedNext = stars >= 1;
    deps.nextLevelButton.hidden = !perfect && !unlockedNext;
    deps.nextLevelButton.textContent = "Next Level";
    deps.reportCardButton.hidden = false;
    deps.reportCardButton.textContent = reason === "offer" ? "Help Me" : "Report Card";
    deps.closeCelebrationButton.hidden = perfect;
    deps.closeCelebrationButton.textContent = reason === "offer" ? "Keep Going" : "Retry";

    if (reason !== "offer") {
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
    }

    deps.celebration.hidden = false;
    (deps.nextLevelButton.hidden ? deps.reportCardButton : deps.nextLevelButton).focus();
  };

  return {
    isCelebrationVisible() {
      return !deps.celebration.hidden;
    },

    isTimeUpVisible() {
      return !deps.timeup.hidden;
    },

    // Shows remaining time as M:SS, going amber in the final stretch.
    setTime(remainingSeconds: number) {
      const whole = Math.max(0, Math.ceil(remainingSeconds));
      const minutes = Math.floor(whole / 60);
      const seconds = (whole % 60).toString().padStart(2, "0");
      deps.timer.textContent = `Time ${minutes}:${seconds}`;
      deps.timer.classList.toggle("urgent", remainingSeconds <= 15);
    },

    showTimeUp() {
      deps.timeup.hidden = false;
      deps.timeup.hidden = true;
      showResult("time-up");
    },

    hideTimeUp() {
      deps.timeup.hidden = true;
    },

    retry() {
      deps.timeup.hidden = true;
      deps.onRequestReset();
    },

    update() {
      const mowed = deps.getMowed();
      const grassPercent = (mowed / bladeCount) * 100;
      const percentage = mowed === bladeCount ? 100 : Math.floor(grassPercent);
      const elapsedSeconds = deps.getElapsedSeconds();
      const mistakes = deps.getMistakes();
      if (mowed > lastMowedCount) {
        lastMowedCount = mowed;
        lastMowProgressSeconds = performance.now() / 1000;
      }

      bestStars = Math.max(bestStars, earnedStarsForRun(grassPercent, elapsedSeconds, mistakes, starMode));
      starMeter.update(grassPercent, elapsedSeconds, mistakes, starMode);
      deps.finishRunButton.hidden = celebrationShown || percentage === 100 || bestStars < starMode;
      deps.score.hidden = !deps.isArmed();
      deps.score.textContent = deps.isArmed() ? "Armed" : "";

      deps.mistakes.textContent = `Mistakes: ${mistakes}`;
      deps.mistakeMeterFill.style.width = `${Math.min(100, mistakes * 12)}%`;

      if (celebrationShown) {
        return;
      }

      if (percentage === 100) {
        showResult("complete");
      } else if (bestStars >= starMode && settings.autoFinishOnMaxStars) {
        showResult("maxed");
      } else if (shouldOfferPrompt(grassPercent, bestStars, elapsedSeconds, mistakes)) {
        const cleanup = deps.clearIsolatedGrass();
        if (cleanup.cleared > 0) {
          lastMowedCount = deps.getMowed();
          lastMowProgressSeconds = performance.now() / 1000;
        }

        if (cleanup.cleared > 0 && cleanup.remaining === 0) {
          showResult("good-enough");
        } else {
          showResult("offer");
        }
      } else if (bestStars < 1 && nextStarOutOfReach(bestStars, starMode, elapsedSeconds, mistakes)) {
        showResult("out-of-reach");
      }
    },

    resetCelebration() {
      window.clearTimeout(celebrationHideTimer);
      celebrationShown = false;
      bestStars = 0;
      currentResultReason = null;
      softPromptShown = false;
      lastMowedCount = 0;
      lastMowProgressSeconds = performance.now() / 1000;
      deps.celebration.hidden = true;
      deps.celebration.dataset.result = "";
      deps.celebrationSeeds.replaceChildren();
      deps.resultStars.textContent = "";
      deps.resultStats.replaceChildren();
      deps.resultCoach.textContent = "";
      deps.resultCoach.hidden = true;
      deps.reportCardButton.textContent = "Report Card";
      deps.finishRunButton.hidden = true;
      deps.setCompletionLoop(false);
      starMeter.reset();
    },

    retryResult() {
      celebrationShown = false;
      bestStars = 0;
      currentResultReason = null;
      deps.celebration.hidden = true;
      deps.finishRunButton.hidden = true;
      deps.setCompletionLoop(false);
      deps.onRequestReset();
    },

    closeResultAction() {
      if (currentResultReason === "offer") {
        hideResultCard();
        return;
      }

      this.retryResult();
    },

    activatePrimaryAction() {
      if (!deps.nextLevelButton.hidden) {
        this.goToNextLevel();
        return;
      }

      if (currentResultReason === "offer") {
        requestHelpAndContinue();
        return;
      }

      this.retryResult();
    },

    activateAssistAction() {
      if (currentResultReason === "offer") {
        requestHelpAndContinue();
        return;
      }

      this.toggleReportCard();
    },

    toggleReportCard() {
      deps.resultCoach.hidden = !deps.resultCoach.hidden;
      deps.reportCardButton.textContent = deps.resultCoach.hidden ? "Report Card" : "Hide Report";
    },

    finishRun() {
      showResult("maxed");
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
    // protected flowers), but the star-scoring design keeps it visible on every
    // map so the HUD does not change shape between levels.
    syncMistakesVisibility() {
      deps.mistakes.style.display = "";
      const meter = document.querySelector<HTMLDivElement>("#mistakeMeter");

      if (meter) {
        meter.style.display = "";
      }
    },
  };
}
