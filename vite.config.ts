import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { defineConfig, type Plugin } from "vite";

// Dev-only endpoint that bakes the dev panel's COMMITTED values into the
// `settings` defaults in src/config.ts. Active only under `vite serve`
// (apply: "serve"), so it is completely absent from the production build and on
// gh-pages — there is no server there to hit, and the client falls back to the
// manual Copy button.
//
// Safety: it is purely additive/edit-in-place and non-destructive. It rewrites
// the value literal for explicitly-listed keys only, on lines of the exact form
// `  key: <value>,`. A key is patched only when it matches exactly one such line;
// anything unknown, shorthand (e.g. `playerSpeed,`), or ambiguous is SKIPPED and
// reported back, never guessed. The result is an ordinary git diff you review
// before committing — nothing is deleted, and localStorage is never touched.
function tuneWriter(): Plugin {
  const configPath = fileURLToPath(new URL("./src/config.ts", import.meta.url));
  const serialize = (value: unknown) =>
    typeof value === "string" ? JSON.stringify(value) : String(value);
  // Escape regex metacharacters so dotted committed keys (e.g.
  // "lawnLevels.settings.parSeconds.beginner") are matched literally and can
  // never act as wildcards. Such nested keys have no flat `key: value` line, so
  // they are simply skipped + reported rather than risk a wrong match.
  const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

  return {
    name: "tune-writer",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use("/__tune/save", (req, res) => {
        if (req.method !== "POST") {
          res.statusCode = 405;
          res.end("POST only");
          return;
        }

        let body = "";
        req.on("data", (chunk) => { body += chunk; });
        req.on("end", () => {
          try {
            const committed = JSON.parse(body || "{}") as Record<string, unknown>;
            let source = readFileSync(configPath, "utf8");
            const written: string[] = [];
            const skipped: string[] = [];

            for (const [key, value] of Object.entries(committed)) {
              // One `  key: <value>,` line (value has no comma in this config).
              const safeKey = escapeRe(key);
              const lineRe = new RegExp(`^(\\s*${safeKey}:\\s*)([^,\\n]*)(,)`, "m");
              const occurrences = source.match(new RegExp(`^\\s*${safeKey}:`, "gm"));

              if (!lineRe.test(source) || (occurrences && occurrences.length !== 1)) {
                skipped.push(key);
                continue;
              }

              source = source.replace(lineRe, `$1${serialize(value)}$3`);
              written.push(key);
            }

            writeFileSync(configPath, source);
            res.statusCode = 200;
            res.setHeader("Content-Type", "application/json");
            res.end(JSON.stringify({ written, skipped }));
          } catch (error) {
            res.statusCode = 500;
            res.end(String(error));
          }
        });
      });
    },
  };
}

export default defineConfig({
  base: "./",
  plugins: [tuneWriter()],
});
