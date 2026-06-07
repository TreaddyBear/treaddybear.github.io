import { settings } from "./config";

// Dev-only settings persistence. Tuning the panel and losing it on reload is
// painful, so in dev we:
//   - snapshot the code defaults,
//   - load any saved overrides from localStorage on startup (before anything
//     reads settings — this module is imported from grass.ts, so it evaluates
//     during the import phase, ahead of material/scene construction),
//   - auto-save whatever the settings panel changes,
//   - expose window.tune for commit/reset.
//
// Never touches the server and is stripped in production (import.meta.env.PROD).
// `tune.commit()` prints the changed values as config-ready lines so a good
// tuning session can be pasted back into config.ts and made the real default.

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

  const diffFromDefaults = (): Bag => {
    const diff: Bag = {};
    for (const k of Object.keys(bag)) {
      if (bag[k] !== defaults[k]) {
        diff[k] = bag[k];
      }
    }
    return diff;
  };

  const save = () => {
    const diff = diffFromDefaults();
    localStorage.setItem(KEY, JSON.stringify(diff));
    return diff;
  };

  let timer = 0;
  const scheduleSave = () => {
    window.clearTimeout(timer);
    timer = window.setTimeout(save, 400);
  };
  const attach = () => document.querySelector("#settings")?.addEventListener("input", scheduleSave);
  if (document.readyState === "loading") {
    window.addEventListener("DOMContentLoaded", attach);
  } else {
    attach();
  }

  (window as unknown as { tune: unknown }).tune = {
    // Print the changed values as config.ts-ready lines to paste back as defaults.
    commit() {
      const diff = save();
      const lines = Object.keys(diff)
        .sort()
        .map((k) => `  ${k}: ${typeof diff[k] === "string" ? JSON.stringify(diff[k]) : String(diff[k])},`);
      // eslint-disable-next-line no-console
      console.log(`// ${lines.length} tuned setting(s) — paste into config.ts \`settings\`:\n${lines.join("\n")}`);
      return diff;
    },
    // Forget all overrides and reload to the code defaults.
    reset() {
      localStorage.removeItem(KEY);
      location.reload();
    },
    save,
  };
}
