import { settings } from "./config";

// Dev-only settings persistence + tuning UI. Tuning the panel and losing it on
// reload is maddening, so in dev:
//   - we snapshot the code defaults,
//   - load saved overrides from localStorage on startup (this module is imported
//     from grass.ts, so it evaluates during the import phase, before materials/
//     scene read settings),
//   - auto-save whatever the settings panel changes,
//   - inject a small toolbar (Tuned: N / Revert all / Commit) and a per-setting
//     "↺ default" button + highlight on every overridden control.
//
// "Commit" prints the changed values as config.ts-ready lines (and copies them)
// so a good tuning session can be pasted back as the real defaults; once the code
// default matches, the value is no longer a diff and clears itself from storage.
//
// Never touches a server; stripped entirely in production.

const KEY = "lawnDevSettings";
type Bag = Record<string, unknown>;

if (!import.meta.env.PROD) {
  const bag = settings as unknown as Bag;
  const defaults: Bag = { ...bag };

  try {
    const saved = JSON.parse(localStorage.getItem(KEY) ?? "{}") as Bag;
    for (const k of Object.keys(saved)) {
      if (k in bag) {
        bag[k] = saved[k];
      }
    }
  } catch {
    /* ignore corrupt storage */
  }

  const isOverridden = (k: string) => bag[k] !== defaults[k];
  const overriddenKeys = () => Object.keys(bag).filter(isOverridden);

  const save = () => {
    const diff: Bag = {};
    for (const k of overriddenKeys()) {
      diff[k] = bag[k];
    }
    localStorage.setItem(KEY, JSON.stringify(diff));
    return diff;
  };

  const commitText = () => {
    save();
    return overriddenKeys()
      .sort()
      .map((k) => `  ${k}: ${typeof bag[k] === "string" ? JSON.stringify(bag[k]) : String(bag[k])},`)
      .join("\n");
  };

  const dots = new Map<string, HTMLElement>();
  let refreshUI = () => {};

  const revertOne = (key: string, ctrl: HTMLElement) => {
    bag[key] = defaults[key];
    if (ctrl instanceof HTMLInputElement) {
      if (ctrl.type === "checkbox") {
        ctrl.checked = Boolean(defaults[key]);
      } else {
        ctrl.value = String(defaults[key]);
      }
    } else if (ctrl instanceof HTMLSelectElement) {
      ctrl.value = String(defaults[key]);
    }
    ctrl.dispatchEvent(new Event("input", { bubbles: true })); // let settingsUi apply it live
    save();
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
      .dev-ov button.primary{background:#6fbf2f;color:#10200d;border-color:#b6e84a}
      .dev-ov button:disabled{opacity:.4;cursor:default}
      .dev-commit{display:none;margin:4px 0 8px}
      .dev-commit textarea{width:100%;height:92px;background:#0f150b;color:#cfe8b0;border:1px solid #38491f;border-radius:6px;font:11px/1.4 monospace;padding:6px;box-sizing:border-box}
      #settings label.dev-changed{outline:1px solid rgba(255,207,51,.45);outline-offset:2px;border-radius:4px}
      .dev-revert{justify-self:start;margin-top:2px;border:1px solid #7a6a2a;background:#3a3320;color:#ffe487;border-radius:5px;font-size:11px;line-height:1.2;padding:2px 6px;cursor:pointer}
    `;
    document.head.append(style);

    const bar = document.createElement("div");
    bar.className = "dev-ov";
    const count = document.createElement("b");
    const revertAll = document.createElement("button");
    revertAll.textContent = "Revert all";
    const commit = document.createElement("button");
    commit.textContent = "Commit";
    commit.className = "primary";
    bar.append(count, revertAll, commit);

    const commitWrap = document.createElement("div");
    commitWrap.className = "dev-commit";
    const ta = document.createElement("textarea");
    ta.readOnly = true;
    commitWrap.append(ta);

    const summary = panel.querySelector(":scope > summary");
    summary?.after(commitWrap);
    summary?.after(bar);

    revertAll.addEventListener("click", () => {
      localStorage.removeItem(KEY);
      location.reload();
    });
    commit.addEventListener("click", () => {
      const text = commitText();
      ta.value = text || "(nothing changed from defaults)";
      commitWrap.style.display = "block";
      ta.select();
      navigator.clipboard?.writeText(text).catch(() => {});
      // eslint-disable-next-line no-console
      console.log(`// tuned settings (copied) — paste into config.ts \`settings\`:\n${text}`);
    });

    for (const ctrl of panel.querySelectorAll<HTMLElement>("input[id], select[id]")) {
      const key = ctrl.id;
      if (!(key in bag)) {
        continue;
      }
      const label = ctrl.closest("label");
      if (!label) {
        continue;
      }
      const dot = document.createElement("button");
      dot.type = "button";
      dot.className = "dev-revert";
      dot.textContent = "↺ default";
      dot.title = "Revert this setting to the code default";
      dot.style.display = "none";
      dot.addEventListener("click", (event) => {
        event.preventDefault();
        revertOne(key, ctrl);
      });
      label.append(dot);
      dots.set(key, dot);
    }

    refreshUI = () => {
      const keys = overriddenKeys();
      count.textContent = `Tuned: ${keys.length}`;
      revertAll.disabled = keys.length === 0;
      commit.disabled = keys.length === 0;
      for (const [key, dot] of dots) {
        const on = isOverridden(key);
        dot.style.display = on ? "inline-block" : "none";
        dot.closest("label")?.classList.toggle("dev-changed", on);
      }
    };

    let saveTimer = 0;
    const onChange = () => {
      refreshUI();
      window.clearTimeout(saveTimer);
      saveTimer = window.setTimeout(save, 300);
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
    commit() {
      const text = commitText();
      // eslint-disable-next-line no-console
      console.log(text);
      return text;
    },
    reset() {
      localStorage.removeItem(KEY);
      location.reload();
    },
    save,
  };
}
