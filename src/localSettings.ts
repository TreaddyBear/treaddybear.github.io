import { levelCodes } from "./config";
import type { LevelCode } from "./config";

type LevelProgress = {
  bestStars: number;
};

type LocalSettings = {
  levels: Partial<Record<LevelCode, LevelProgress>>;
};

const STORAGE_KEY = "lawnLocalSettings";

const emptySettings = (): LocalSettings => ({ levels: {} });

function isLevelCode(value: string): value is LevelCode {
  return (levelCodes as readonly string[]).includes(value);
}

export function loadLocalSettings(): LocalSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) as LocalSettings : emptySettings();
    const next = emptySettings();

    for (const [code, progress] of Object.entries(parsed.levels ?? {})) {
      if (!isLevelCode(code) || !progress) {
        continue;
      }

      const bestStars = Math.max(0, Math.min(3, Math.floor(Number(progress.bestStars) || 0)));
      if (bestStars > 0) {
        next.levels[code] = { bestStars };
      }
    }

    return next;
  } catch {
    return emptySettings();
  }
}

export function saveLocalSettings(settings: LocalSettings) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // Progress is nice-to-have; storage can fail in private or locked-down tabs.
  }
}

export function getLevelBestStars(code: LevelCode) {
  return loadLocalSettings().levels[code]?.bestStars ?? 0;
}

export function hasCompletedAnyLevel() {
  return levelCodes.some((code) => getLevelBestStars(code) > 0);
}

export function recordLevelStars(code: LevelCode, stars: number) {
  const clampedStars = Math.max(0, Math.min(3, Math.floor(stars)));

  if (clampedStars <= 0) {
    return;
  }

  const settings = loadLocalSettings();
  const current = settings.levels[code]?.bestStars ?? 0;

  if (clampedStars <= current) {
    return;
  }

  settings.levels[code] = { bestStars: clampedStars };
  saveLocalSettings(settings);
}
