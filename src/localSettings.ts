import { levelCodes } from "./config";
import type { LevelCode } from "./config";
import type { InputMode } from "./input";

type LevelProgress = {
  bestStars: number;
};

type LocalSettings = {
  levels: Partial<Record<LevelCode, LevelProgress>>;
  preferences: {
    inputMode?: InputMode;
    lastLevelCode?: LevelCode;
    masterVolume?: number;
    muteOnBlur?: boolean;
    reverseSteerFlip?: boolean;
    showFps?: boolean;
    touchSplitControls?: boolean;
  };
};

const STORAGE_KEY = "lawnLocalSettings";

const emptySettings = (): LocalSettings => ({ levels: {}, preferences: {} });

function isLevelCode(value: string): value is LevelCode {
  return (levelCodes as readonly string[]).includes(value);
}

function isInputMode(value: unknown): value is InputMode {
  return value === "auto"
    || value === "keyboard"
    || value === "mouse"
    || value === "controller"
    || value === "touch";
}

function clamp01(value: unknown) {
  return Math.max(0, Math.min(1, Number(value) || 0));
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

    const preferences = parsed.preferences ?? {};

    if (isInputMode(preferences.inputMode)) {
      next.preferences.inputMode = preferences.inputMode;
    }

    if (typeof preferences.lastLevelCode === "string" && isLevelCode(preferences.lastLevelCode)) {
      next.preferences.lastLevelCode = preferences.lastLevelCode;
    }

    if (typeof preferences.masterVolume === "number") {
      next.preferences.masterVolume = clamp01(preferences.masterVolume);
    }

    if (typeof preferences.muteOnBlur === "boolean") {
      next.preferences.muteOnBlur = preferences.muteOnBlur;
    }

    if (typeof preferences.reverseSteerFlip === "boolean") {
      next.preferences.reverseSteerFlip = preferences.reverseSteerFlip;
    }

    if (typeof preferences.showFps === "boolean") {
      next.preferences.showFps = preferences.showFps;
    }

    if (typeof preferences.touchSplitControls === "boolean") {
      next.preferences.touchSplitControls = preferences.touchSplitControls;
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

export function getTouchSplitControls(defaultValue = false) {
  return loadLocalSettings().preferences.touchSplitControls ?? defaultValue;
}

export function setTouchSplitControls(value: boolean) {
  const settings = loadLocalSettings();
  settings.preferences.touchSplitControls = value;
  saveLocalSettings(settings);
}

export function getMenuPreferences() {
  return loadLocalSettings().preferences;
}

export function setMenuPreference<Key extends keyof LocalSettings["preferences"]>(
  key: Key,
  value: LocalSettings["preferences"][Key],
) {
  const settings = loadLocalSettings();
  settings.preferences[key] = value;
  saveLocalSettings(settings);
}
