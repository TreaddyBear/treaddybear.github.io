import { lawnLevels, levelCodes, normalizeLevelCode, settings } from "./config";

// Dev-only settings persistence + per-setting tuning UI. In dev:
//   - snapshot the code defaults,
//   - load saved overrides from localStorage on startup (imported from grass.ts,
//     so it runs during import, before the scene reads settings),
//   - auto-save whatever the settings panel changes,
//   - per overridden control, show "↺ default" (revert) and "⬆ commit".
//
// "Commit" flags THAT specific value for a human/Claude to bake into config.ts as
// the new default. A control only offers Commit while its current value hasn't
// been committed yet. Committed-but-not-yet-in-code values are listed in a
// "pending" box (and copied) so they can be pasted into config.ts. Once the code
// default matches a committed value, it stops being an override AND drops out of
// pending automatically. Never touches a server; stripped in production.

const OVERRIDE_KEY = "lawnDevSettings";
const COMMIT_KEY = "lawnDevCommitted";
type Bag = Record<string, unknown>;
type TuneTarget = {
  defaultValue: unknown;
  get: () => unknown;
  set: (value: unknown) => void;
};

if (!import.meta.env.PROD) {
  const bag = settings as unknown as Bag;
  const tuneTargets = new Map<string, TuneTarget>();

  for (const key of Object.keys(bag)) {
    tuneTargets.set(key, {
      defaultValue: bag[key],
      get: () => bag[key],
      set: (value) => {
        bag[key] = value;
      },
    });
  }

  for (const code of levelCodes) {
    const key = `lawnLevels.settings.parSeconds.${code}`;
    tuneTargets.set(key, {
      defaultValue: lawnLevels.settings.parSeconds[code],
      get: () => lawnLevels.settings.parSeconds[code],
      set: (value) => {
        lawnLevels.settings.parSeconds[code] = Number(value);
      },
    });
  }

  const loadBag = (key: string): Bag => {
    try {
      return JSON.parse(localStorage.getItem(key) ?? "{}") as Bag;
    } catch {
      return {};
    }
  };

  const overrides = loadBag(OVERRIDE_KEY);
  for (const k of Object.keys(overrides)) {
    const target = tuneTargets.get(k);

    if (target) {
      target.set(overrides[k]);
    }
  }

  // Committed values already baked into the code default (or no longer real
  // settings) are dropped, so "pending" only shows what still needs baking.
  const committed = loadBag(COMMIT_KEY);
  for (const k of Object.keys(committed)) {
    const target = tuneTargets.get(k);

    if (!target || committed[k] === target.defaultValue) {
      delete committed[k];
    }
  }

  const fmt = (v: unknown) => (typeof v === "string" ? JSON.stringify(v) : String(v));
  const getControlKey = (ctrl: HTMLElement) => {
    if (ctrl.dataset.levelCode && ctrl.dataset.levelSetting) {
      const levelCode = normalizeLevelCode(ctrl.dataset.levelCode);
      return `lawnLevels.settings.${ctrl.dataset.levelSetting}.${levelCode}`;
    }

    return ctrl.id;
  };
  const isOverridden = (k: string) => {
    const target = tuneTargets.get(k);
    return Boolean(target && target.get() !== target.defaultValue);
  };
  const isCommitted = (k: string) => {
    const target = tuneTargets.get(k);
    return Boolean(target && k in committed && committed[k] === target.get());
  };

  const saveOverrides = () => {
    const diff: Bag = {};
    for (const k of tuneTargets.keys()) {
      if (isOverridden(k)) {
        diff[k] = tuneTargets.get(k)!.get();
      }
    }
    localStorage.setItem(OVERRIDE_KEY, JSON.stringify(diff));
  };
  const saveCommitted = () => localStorage.setItem(COMMIT_KEY, JSON.stringify(committed));
  const pendingLines = () => Object.keys(committed).sort().map((k) => `  ${k}: ${fmt(committed[k])},`).join("\n");

  const dots = new Map<string, { revert: HTMLElement; commit: HTMLElement }>();
  let refreshUI = () => {};

  const applyLive = (ctrl: HTMLElement) => ctrl.dispatchEvent(new Event("input", { bubbles: true }));

  const revertOne = (key: string, ctrl: HTMLElement) => {
    const target = tuneTargets.get(key);

    if (!target) {
      return;
    }

    target.set(target.defaultValue);
    if (ctrl instanceof HTMLInputElement) {
      if (ctrl.type === "checkbox") {
        ctrl.checked = Boolean(target.defaultValue);
      } else {
        ctrl.value = String(target.defaultValue);
      }
    } else if (ctrl instanceof HTMLSelectElement) {
      ctrl.value = String(target.defaultValue);
    }
    applyLive(ctrl);
    saveOverrides();
    refreshUI();
  };

  const commitOne = (key: string) => {
    const target = tuneTargets.get(key);

    if (!target) {
      return;
    }

    committed[key] = target.get();
    saveCommitted();
    refreshUI();
  };

  const buildUI = () => {
    const panel = document.querySelector<HTMLDetailsElement>("#settings");
    if (!panel) {
      return;
    }

    const style = document.createElement("style");
    style.textContent = `
      .dev-ov{display:flex;gap:6px;align-items:center;flex-wrap:wrap;margin:6px 0 4px;padding:6px 8px;border:1px solid #4a5d2e;border-radius:8px;background:rgba(40,55,28,.6);font-size:12px;color:#cfe0bb}
      .dev-ov b{color:#d8f5b0;margin-right:auto}
      .dev-ov button{border:1px solid #5a6f36;background:#2a3a1c;color:#e8f0dd;border-radius:7px;padding:3px 9px;font-size:12px;font-weight:700;cursor:pointer}
      .dev-ov button:disabled{opacity:.4;cursor:default}
      .dev-pending{display:none;margin:4px 0 8px}
      .dev-pending textarea{width:100%;height:92px;background:#0f150b;color:#cfe8b0;border:1px solid #38491f;border-radius:6px;font:11px/1.4 monospace;padding:6px;box-sizing:border-box}
      #settings label.dev-changed{outline:1px solid rgba(255,207,51,.45);outline-offset:2px;border-radius:4px}
      .dev-acts{grid-column:1/-1;display:flex;gap:4px;margin-top:3px}
      .dev-acts button{border-radius:5px;font-size:11px;line-height:1.2;padding:2px 7px;cursor:pointer;font-weight:700}
      .dev-revert{border:1px solid #7a6a2a;background:#3a3320;color:#ffe487}
      .dev-commit{border:1px solid #4a7a2a;background:#234016;color:#bff09a}
    `;
    document.head.append(style);

    const bar = document.createElement("div");
    bar.className = "dev-ov";
    const count = document.createElement("b");
    const revertAll = document.createElement("button");
    revertAll.textContent = "Revert all";
    bar.append(count, revertAll);

    const pendingWrap = document.createElement("div");
    pendingWrap.className = "dev-pending";
    const ta = document.createElement("textarea");
    ta.readOnly = true;
    pendingWrap.append(ta);

    const summary = panel.querySelector(":scope > summary");
    summary?.after(pendingWrap);
    summary?.after(bar);

    revertAll.addEventListener("click", () => {
      localStorage.removeItem(OVERRIDE_KEY);
      location.reload();
    });

    for (const ctrl of panel.querySelectorAll<HTMLElement>("input[id], select[id]")) {
      const key = getControlKey(ctrl);
      if (!tuneTargets.has(key)) {
        continue;
      }
      const label = ctrl.closest("label");
      if (!label) {
        continue;
      }
      const acts = document.createElement("div");
      acts.className = "dev-acts";
      acts.style.display = "none";
      const revert = document.createElement("button");
      revert.type = "button";
      revert.className = "dev-revert";
      revert.textContent = "↺ default";
      revert.addEventListener("click", (e) => { e.preventDefault(); revertOne(key, ctrl); });
      const commit = document.createElement("button");
      commit.type = "button";
      commit.className = "dev-commit";
      commit.textContent = "⬆ commit";
      commit.title = "Flag this exact value to become the code default";
      commit.addEventListener("click", (e) => { e.preventDefault(); commitOne(key); });
      acts.append(revert, commit);
      label.append(acts);
      dots.set(key, { revert: acts, commit });
    }

    refreshUI = () => {
      const overridden = Array.from(tuneTargets.keys()).filter(isOverridden);
      count.textContent = `Tuned: ${overridden.length}`;
      revertAll.disabled = overridden.length === 0;
      for (const [key, { revert, commit }] of dots) {
        const on = isOverridden(key);
        revert.style.display = on ? "flex" : "none";
        commit.style.display = on && !isCommitted(key) ? "inline-block" : "none";
        revert.closest("label")?.classList.toggle("dev-changed", on);
      }
      const lines = pendingLines();
      ta.value = lines;
      pendingWrap.style.display = lines ? "block" : "none";
      if (lines) {
        navigator.clipboard?.writeText(lines).catch(() => {});
      }
    };

    let saveTimer = 0;
    const onChange = () => {
      refreshUI();
      window.clearTimeout(saveTimer);
      saveTimer = window.setTimeout(saveOverrides, 300);
    };
    panel.addEventListener("input", onChange);
    panel.addEventListener("change", onChange);
    refreshUI();
  };

  if (document.readyState === "loading") {
    window.addEventListener("DOMContentLoaded", buildUI);
  } else {
    buildUI();
  }

  (window as unknown as { tune: unknown }).tune = {
    pending() {
      const lines = pendingLines();
      // eslint-disable-next-line no-console
      console.log(lines || "(nothing committed)");
      return lines;
    },
    reset() {
      localStorage.removeItem(OVERRIDE_KEY);
      location.reload();
    },
  };
}
