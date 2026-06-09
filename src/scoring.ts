import { getActiveLevelCode, lawnLevels, scoring } from "./config";

// Pure star-scoring logic, ported from the design mockup. Internal points only:
// the HUD meter and the end-of-level verdict are derived from these; the raw
// numbers are never shown to the player. Most constants live in config.scoring;
// par is read from the active level's keyed settings.

export type StarMode = 3 | 5;
export type LimitingFactor = "grass" | "time" | "mistakes" | "none";
type NormalFacetRanks = {
  completion: number;
  time: number;
  mistakes: number;
  cap: number;
};

const thresholdsFor = (mode: StarMode) => scoring.thresholds[mode];
const parSeconds = () => lawnLevels.settings.parSeconds[getActiveLevelCode()];

// Points for finishing under par (negative when over par).
export const timePoints = (elapsedSeconds: number) =>
  Math.round(scoring.timePerSecond * (parSeconds() - elapsedSeconds));

// Points for the lawn mowed so far (0..100% -> 0..10000 by default).
export const grassPoints = (mowedPercent: number) =>
  Math.round(scoring.grassPerPercent * Math.max(0, Math.min(100, mowedPercent)));

// Mistakes: first costs mistakeBase, each later one a falloff fraction of the
// previous (so a stack of bumps can't punish you forever).
export const mistakePenalty = (count: number) => {
  let total = 0;
  for (let index = 0; index < count; index += 1) {
    total += scoring.mistakeBase * (scoring.mistakeFalloff ** index);
  }
  return Math.round(total);
};

export const totalScore = (mowedPercent: number, elapsedSeconds: number, mistakeCount: number) =>
  timePoints(elapsedSeconds) + grassPoints(mowedPercent) - mistakePenalty(mistakeCount);

// Score at t=0 with 0% mowed — the meter's baseline (its 0% point). Dawdling
// lets the time bonus decay, so the meter barely moves until you start mowing.
export const meterFloor = () => Math.round(scoring.timePerSecond * parSeconds());

export const earnedStars = (score: number, mode: StarMode) =>
  thresholdsFor(mode).filter((threshold) => score >= threshold).length;

const normalCompletionRank = (mowedPercent: number) => {
  if (mowedPercent >= scoring.normal.completePercent) {
    return 3;
  }
  if (mowedPercent >= scoring.normal.nearCompletePercent) {
    return 2;
  }
  if (mowedPercent >= scoring.normal.partialPercent) {
    return 1;
  }
  return 0;
};

const normalCompletionCap = (mowedPercent: number) => {
  if (mowedPercent >= scoring.normal.completePercent) {
    return 3;
  }
  if (mowedPercent >= scoring.normal.nearCompletePercent) {
    return 2;
  }
  return mowedPercent >= scoring.normal.partialPercent ? 2 : 0;
};

const normalTimeRank = (elapsedSeconds: number) => {
  const par = parSeconds();

  if (elapsedSeconds <= par * scoring.normal.threeStarTimeMultiplier) {
    return 3;
  }
  if (elapsedSeconds <= par * scoring.normal.twoStarTimeMultiplier) {
    return 2;
  }
  if (elapsedSeconds <= par * scoring.normal.oneStarTimeMultiplier) {
    return 1;
  }
  return 0;
};

const normalMistakeRank = (mistakeCount: number) => {
  if (mistakeCount <= 0) {
    return 3;
  }
  if (mistakeCount <= scoring.normal.twoMistakeLimit) {
    return 2;
  }
  if (mistakeCount <= scoring.normal.oneMistakeLimit) {
    return 1;
  }
  return 0;
};

const normalFacetRanks = (
  mowedPercent: number,
  elapsedSeconds: number,
  mistakeCount: number,
): NormalFacetRanks => ({
  completion: normalCompletionRank(mowedPercent),
  time: normalTimeRank(elapsedSeconds),
  mistakes: normalMistakeRank(mistakeCount),
  cap: normalCompletionCap(mowedPercent),
});

const normalStarsForRun = (mowedPercent: number, elapsedSeconds: number, mistakeCount: number) => {
  const ranks = normalFacetRanks(mowedPercent, elapsedSeconds, mistakeCount);

  if (ranks.cap === 0) {
    return 0;
  }

  const holisticStars = Math.floor((ranks.completion + ranks.time + ranks.mistakes) / 3);
  const completionFloor = mowedPercent >= scoring.normal.completePercent ? 1 : 0;

  return Math.max(completionFloor, Math.min(ranks.cap, holisticStars));
};

const masterStarsForRun = (mowedPercent: number, elapsedSeconds: number, mistakeCount: number) => {
  const stars = normalStarsForRun(mowedPercent, elapsedSeconds, mistakeCount);
  if (stars < 3) {
    return stars;
  }

  const clean = mistakeCount <= 0;
  if (!clean || mowedPercent < scoring.master.completePercent) {
    return 3;
  }

  const par = parSeconds();

  if (
    mowedPercent >= scoring.master.perfectPercent
    && elapsedSeconds <= par * scoring.master.fiveStarTimeMultiplier
  ) {
    return 5;
  }

  if (elapsedSeconds <= par * scoring.master.fourStarTimeMultiplier) {
    return 4;
  }

  return 3;
};

export const earnedStarsForRun = (
  mowedPercent: number,
  elapsedSeconds: number,
  mistakeCount: number,
  mode: StarMode,
  rules: "normal" | "master" = mode === 5 ? "master" : "normal",
) => {
  if (rules === "normal") {
    return Math.min(mode, normalStarsForRun(mowedPercent, elapsedSeconds, mistakeCount));
  }

  if (mode === 5) {
    return masterStarsForRun(mowedPercent, elapsedSeconds, mistakeCount);
  }

  return earnedStars(totalScore(mowedPercent, elapsedSeconds, mistakeCount), mode);
};

// Progress (0..1) within the current star's band — what the meter fill rides.
export const bandProgress = (score: number, earned: number, mode: StarMode) => {
  const thresholds = thresholdsFor(mode);
  if (earned >= mode) {
    return 1;
  }
  const prev = earned === 0 ? meterFloor() : thresholds[earned - 1];
  const next = thresholds[earned];
  return Math.max(0, Math.min(1, (score - prev) / (next - prev)));
};

// Best score still reachable if the rest of the lawn were mowed right now.
export const reachableCeiling = (elapsedSeconds: number, mistakeCount: number) =>
  timePoints(elapsedSeconds) + grassPoints(100) - mistakePenalty(mistakeCount);

// True once the next unearned star can no longer be reached — the run can end.
export const nextStarOutOfReach = (earned: number, mode: StarMode, elapsedSeconds: number, mistakeCount: number) => {
  if (earned >= mode) {
    return false;
  }
  if (mode === 3) {
    return earnedStarsForRun(100, elapsedSeconds, mistakeCount, mode) <= earned;
  }
  if (mode === 5) {
    return earnedStarsForRun(100, elapsedSeconds, mistakeCount, mode, "master") <= earned;
  }
  return reachableCeiling(elapsedSeconds, mistakeCount) < thresholdsFor(mode)[earned];
};

// What most held the run back from the next star, for a one-line verdict.
export const limitingFactor = (
  mowedPercent: number,
  elapsedSeconds: number,
  mistakeCount: number,
  mode: StarMode,
): LimitingFactor => {
  const earned = earnedStarsForRun(mowedPercent, elapsedSeconds, mistakeCount, mode);
  if (earned >= mode) {
    return "none";
  }

  if (mode === 3 || (mode === 5 && earned < 3)) {
    const ranks = normalFacetRanks(mowedPercent, elapsedSeconds, mistakeCount);
    const worstRank = Math.min(ranks.completion, ranks.time, ranks.mistakes);

    if (ranks.completion === worstRank) {
      return "grass";
    }
    if (ranks.mistakes === worstRank) {
      return "mistakes";
    }
    return "time";
  }

  if (mode === 5) {
    if (mistakeCount > 0) {
      return "mistakes";
    }
    if (mowedPercent < scoring.master.perfectPercent) {
      return "grass";
    }
    return "time";
  }

  const grassGap = grassPoints(100) - grassPoints(mowedPercent); // points left on the lawn
  const timeGap = Math.max(0, -timePoints(elapsedSeconds)); // points lost to being over par
  const mistakeGap = mistakePenalty(mistakeCount); // points lost to mistakes
  const worst = Math.max(grassGap, timeGap, mistakeGap);

  if (worst <= 0) {
    return "none";
  }
  if (worst === grassGap) {
    return "grass";
  }
  if (worst === mistakeGap) {
    return "mistakes";
  }
  return "time";
};
