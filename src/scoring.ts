import { scoring } from "./config";

// Pure star-scoring logic, ported from the design mockup. Internal points only:
// the HUD meter and the end-of-level verdict are derived from these; the raw
// numbers are never shown to the player. All constants live in config.scoring.

export type StarMode = 3 | 5;
export type LimitingFactor = "grass" | "time" | "mistakes" | "none";

const thresholdsFor = (mode: StarMode) => scoring.thresholds[mode];

// Points for finishing under par (negative when over par).
export const timePoints = (elapsedSeconds: number) =>
  Math.round(scoring.timePerSecond * (scoring.parSeconds - elapsedSeconds));

// Points for the lawn mowed so far (0..100% -> 0..10000 by default).
export const grassPoints = (mowedPercent: number) =>
  Math.round(scoring.grassPerPercent * Math.max(0, Math.min(100, mowedPercent)));

// Mistakes: first costs mistakeBase, each later one a falloff fraction of the
// previous (so a stack of bumps can't punish you forever).
export const mistakePenalty = (count: number) => {
  let total = 0;
  for (let i = 0; i < count; i += 1) {
    total += scoring.mistakeBase * (scoring.mistakeFalloff ** i);
  }
  return Math.round(total);
};

export const totalScore = (mowedPercent: number, elapsedSeconds: number, mistakeCount: number) =>
  timePoints(elapsedSeconds) + grassPoints(mowedPercent) - mistakePenalty(mistakeCount);

// Score at t=0 with 0% mowed — the meter's baseline (its 0% point). Dawdling
// lets the time bonus decay, so the meter barely moves until you start mowing.
export const meterFloor = () => Math.round(scoring.timePerSecond * scoring.parSeconds);

export const earnedStars = (score: number, mode: StarMode) =>
  thresholdsFor(mode).filter((threshold) => score >= threshold).length;

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
  return reachableCeiling(elapsedSeconds, mistakeCount) < thresholdsFor(mode)[earned];
};

// What most held the run back from the next star, for a one-line verdict.
export const limitingFactor = (
  mowedPercent: number,
  elapsedSeconds: number,
  mistakeCount: number,
  mode: StarMode,
): LimitingFactor => {
  const earned = earnedStars(totalScore(mowedPercent, elapsedSeconds, mistakeCount), mode);
  if (earned >= mode) {
    return "none";
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
