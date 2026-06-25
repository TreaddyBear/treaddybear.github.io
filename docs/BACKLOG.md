# Backlog

Two sections: dev-experience fixes to do **at the machine**, then a catalogue of
**unaddressed issues** in the game and engine. Neither section duplicates items
already tracked in `MAP_FORMAT_TODO.md` — those are cross-referenced, not repeated.

---

## Part 1 — When you're home: dev-experience setup

These are blockers or near-blockers for remote sessions. The root causes of
tonight's screenshot failure are documented here so the fixes are obvious.

---

### 1. Fix Vite host binding (2 min — highest priority)

**Problem.** `vite.config.ts` has no explicit `server.host`. Vite defaults to
`localhost`, which on Windows resolves to `::1` (IPv6) rather than `127.0.0.1`.
Any tool that opens `http://127.0.0.1:5173` gets a connection refused. Any script
that parses Vite's stdout for the bound address also gets ANSI escape codes
(`\x1b[32m`, etc.) wrapping the port number, so a naive port-detection regex
silently fails and the script either hangs or uses a wrong port.

**Fix.** In `vite.config.ts`, add:
```ts
export default defineConfig({
  base: "./",
  server: { host: "127.0.0.1" },   // ← add this line
  plugins: [tuneWriter()],
});
```

This makes `pnpm dev` listen on `127.0.0.1:5173`, which every tool reaches
without ambiguity. Strip ANSI codes in any port-parsing script:
```js
const clean = rawLine.replace(/\x1b\[[0-9;]*m/g, "");
const port  = clean.match(/:(\d+)/)?.[1];
```

---

### 2. Kill orphaned `node.exe` dev-server processes

**Problem.** When a background dev-server process is started from a Bash tool
call and the shell exits, Vite continues running invisibly. The next attempt to
bind port 5173 silently fails (EADDRINUSE). You can be fooled into thinking
the dev server is unresponsive when it is actually a prior corpse holding the port.

**Fix (run at the start of any screenshot session):**
```powershell
taskkill /F /IM node.exe /T   # kills all Node processes — adjust if you have others running
```

Or, more surgical:
```powershell
netstat -ano | findstr :5173   # find the PID holding the port
taskkill /PID <pid> /F
```

---

### 3. Build `pnpm shot` — a single-process screenshot script

**Why it was hard tonight.** The capture-engine attempts died because:
- the dev-server was not yet alive when the script connected (race condition)
- Playwright was not installed (`npx playwright install chromium` needed)
- the Vite IPv6 binding made `localhost:5173` unreachable

**The clean design.** A single Node script (`tools/capture-engine.cjs` was
started tonight — it is untracked and mostly working). The script should:

1. **Spawn Vite as a child process** with `host: 127.0.0.1` (or just point at an
   already-running server via `GAME_URL` env var).
2. **Strip ANSI and parse the `Local:` line** from Vite's stdout to get the
   actual bound address; do NOT poll a fixed port.
3. **Wait until Vite is actually ready** — poll `GET http://127.0.0.1:<port>/`
   until it returns 200 (typically < 2 s after the "ready" log line).
4. **Launch Chromium with SwiftShader WebGL** via CDP or Playwright (see below).
   `--use-gl=angle --use-angle=swiftshader --ignore-gpu-blocklist --enable-webgl`
   are the flags that give a software WebGL context on a machine without a display.
5. **Navigate, wait for the canvas, capture** `Page.captureScreenshot` via CDP or
   `page.screenshot()` via Playwright, save to `map-exports/debug/engine_<level>.png`.
6. **Kill Vite and exit.** Hold a reference to the spawned process; `proc.kill()`
   on completion or SIGINT.

Two approaches for the browser layer; pick one:
- **CDP direct (zero install)** — `tools/capture-engine.cjs` uses Node 24's
  built-in `WebSocket` + raw CDP HTTP. No `npm install` needed. Works today.
  Downside: more boilerplate (~150 lines).
- **Playwright (one-time install)** — `tools/capture-engine.mjs` uses
  `playwright`; needs `pnpm add -D playwright && npx playwright install chromium`.
  Cleaner API. Better for waiting on DOM states.

`capture-engine.cjs` is the recommended path for CI or remote sessions where
installing packages is awkward. Add to `package.json`:
```json
"shot": "node tools/capture-engine.cjs"
```

---

### 4. The reliable remote-review path already exists: `pnpm viz`

`pnpm bake && pnpm viz` runs entirely headless — no browser, no display, no Vite.
It produces 39 PNGs in `map-exports/debug/` including per-type density heatmaps,
summed T-field, and instance scatter plots at 20 px/m. This is the correct path
for reviewing vegetation changes remotely. The in-engine screenshot (`pnpm shot`)
is additional, not a replacement.

**Workflow for remote review:**
1. Edit map source and/or sampler.
2. `pnpm bake && pnpm viz` — ~5 s, completely offline.
3. Commit the updated `lawn-maps.baked.json` and note paths to PNGs.
4. Review PNGs out-of-band (share via git diff or copy to a shared folder).

No server, no browser, no port issues.

---

### 5. Expose a static serve for the baked artifact (optional quality-of-life)

The baked JSON and debug PNGs are already committed. A `pnpm serve` alias
(e.g. `npx serve map-exports`) lets anyone browse the artifact without Vite.
Not strictly necessary — the PNGs are the review artifact — but useful if you
want to inspect `lawn-maps.baked.json` in a browser JSON viewer remotely.

---

## Part 2 — Unaddressed issues (game + engine)

Items already tracked in `MAP_FORMAT_TODO.md` are noted by section reference.
Items below are **additional findings** from a code audit + doc review.

Severity key: **High** = visible bug or data loss risk; **Med** = functional gap
or correctness issue; **Low** = cosmetic or future-risk; **Doc** = spec/decision
only, no code change required.

---

### A. Vegetation engine — new findings (not in MAP_FORMAT_TODO.md)

**A1. Tulip renderer bypasses `bakedInstances` entirely** — `src/tulips.ts:65`
`place()` reads `getActiveMap().flowerBeds` (old flat array) and calls
`randomPointInArea` with `Math.random()`. The `tulip` type IS in the flowers tier
of `vegetation-sampler.ts`, so baked instances are generated at `pnpm bake` time
but are silently discarded at runtime. Additionally, `src/fieldFlowers.ts`'s
`BAKED_TO_VARIANT` map (line 22) does not include `"tulip"`, so even if the
flowers renderer tried to use them, it would skip them. Tulip placement is still
non-deterministic. **Med.**

**A2. Flower visual properties remain non-deterministic in the baked path** —
`src/fieldFlowers.ts:183–188`: even in the baked branch, `yaw`, `height`, and
`petalCount` use `Math.random()`. Positions are stable across loads; individual
flower appearance is not. For a save-state that tracks mowed/not-mowed, positions
are all that matter — but any future "same flower every time" requirement needs
these seeded. **Low.**

**A3. Clover-flower white bunches are always non-deterministic** —
`src/fieldFlowers.ts:190` calls `addCloverFlowerBunches()` even in the baked
path. That function uses `Math.random()` for all bunch placement and relies on
`map.cloverPatches` (old flat array). White flower bunches in clover zones shuffle
every load. **Low.**

**A4. Dandelion kind (`seed` vs `yellow`) determined by `inst.index % 3`** —
`src/dandelions.ts:379`. The index is the array position in `bakedInstances`, not
a stable ID. Adding or removing any upstream dandelion instance shifts every index
below it, silently swapping which dandelions are seed-puffs and which are yellow
flowers. Low priority until save-state is implemented, but the approach is fragile.
**Low.**

**A5. Attract camera reads old flat arrays for POI selection** —
`src/attractCamera.ts` uses `map.vegetationAreas`, `map.cloverPatches`, and
`map.flowerFields` to find points of interest for shot construction. These are the
flat arrays targeted for removal in `MAP_FORMAT_TODO.md` Bucket 1. When those
arrays are retired, the attract camera's POI lookup goes blind (it would default to
center-of-map shots). Port POI selection to `bakedInstances` or an `sampleMapArea`
sweep before retiring the flat arrays. **Med — prerequisite dependency on Bucket 1.**

**A6. `foliageDensityAt` density-squared response below density=1** —
`VEGETATION_POPULATION.md §3` documents a known kink: for `density < 1`, instance
count scales as `density²` (both grid spacing and acceptance rate shrink together),
while for `density > 1` it scales linearly (only grid densifies). The proposed fix
is a [0, 2] headroom remapping that eliminates the kink. Not yet in
`MAP_FORMAT_TODO.md`. Affects all runtime-fallback placement; baked path uses
Bridson with variable radius so the kink does not apply there. **Low — baked path
is unaffected.**

---

### B. Validator / spec — new findings

**B1. No `falloff > inradius` validator check for height features** —
`src/mapValidator.ts` checks `falloff > 0` and `height >= 0` but not
`falloff <= shape_inradius`. An authored hill with `falloff` exceeding the shape's
inradius silently fails to reach `height` at its peak. `OPEN_QUESTIONS.md §2`
documents this and proposes Option B1 (add a non-fatal warning) vs B2 (doc only).
T's decision still open; neither is in `MAP_FORMAT_TODO.md`'s validator checkbox.
**Low (no authored maps currently affected) / Doc.**

---

### C. Game / gameplay — known gaps

These were surfaced in a prior session and live in memory under
`lawn-game-remaining-work.md` but are not written into any doc file:

**C1. Star meter is hidden** — `src/starMeter.ts` exists and has the animation
logic, but the `#starMeter` DOM element is not visible during gameplay. **Med.**

**C2. Accident ×-vs-star disambiguation** — destroying a tulip counts as a
mistake; the design distinguishes a star-earning result from an accidental ×, but
the scoring path or HUD presentation has a known open issue. **Med.**

**C3. Touch steering not implemented** — `src/input.ts` handles keyboard/gamepad;
no touch input path exists. The game is unplayable on mobile. **Med.**

**C4. Boost** — a planned speed-up mechanic is not implemented. **Low (feature).**

---

### D. Code hygiene — minor

**D1. `tools/capture-engine.{cjs,mjs}` are untracked** — two partial screenshot
scripts from tonight's session (visible in `git status`). The `.cjs` file is the
better foundation (zero install). Either finish and commit one, or `git clean`
both and restart from scratch at the machine with host binding fixed first.

**D2. No root-level README** — the project has `docs/`, `MAP_FORMAT_TODO.md`, and
`ARCHITECTURE.md`, but no `README.md`. A new contributor has no starting point.
Minimal entry point: project purpose, prerequisites (`pnpm`, Node 24), `pnpm bake`
and `pnpm viz` commands.

---

### Cross-reference: items already in MAP_FORMAT_TODO.md

The following are tracked there and not duplicated above:

| MAP_FORMAT_TODO.md section | Item |
|---|---|
| Bucket 1 | Retire legacy flat arrays (`segments`, `cloverPatches`, `flowerBeds`, `flowerFields`) |
| Bucket 1 | Remove `normalizeLevel` from production path |
| Bucket 1 | Remove `spacing` and `grassKeep` shims from `RuntimeMap` |
| Bucket 1 | Visual in-game check: outer-grass patchiness + conceal-hill shape |
| Bucket 2 | Spec: `edgeFalloff` curve + role/mowable snap (three clarifying sentences) |
| Bucket 2 | Spec: terrain `height` definition (Option A1 vs A2) |
| Vegetation | Engine wiring: wire `bakedInstances` into flower/clover/dandelion renderers (dandelion + clover + field-flowers done; tulip not — see A1 above) |

---

*Written 2026-06-25. Code audit against commit `42f7a35`. No runtime behavior was modified.*
