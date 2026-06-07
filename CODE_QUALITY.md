# Code Quality Guidelines

These guidelines are intentionally small and practical. The goal is to keep the
project easy to edit by hand while it is still changing quickly.

## Line Length

- Prefer source and Markdown lines around 100 columns when editing files.
- Lines up to 120 columns are acceptable when wrapping would make the code
  harder to read.
- Long player-facing text is okay, but wrap it in source so each physical line
  stays readable.
- Prefer this style for long strings:

```ts
return (
  "Most of the trouble came from clipped flowers. Give the bed a little more " +
  "space at first, then trim closer once the nearby grass is clear."
);
```

- Avoid hiding long prose in one giant line. It makes copy harder to review,
  tune, and merge.
- When touching an existing long line nearby, wrap it unless doing so would make
  the change much riskier.

## Naming

- Avoid single-letter variables and bindings, including loop counters.
- For a normal single loop index, use `index` instead of `i` or a decorated
  name like `starIndex`.
- Use more specific names only when there are competing indexes or actual
  coordinates, such as nested `pixelX` / `pixelY` loops.
- Prefer names that describe the role of a value, not just its type.
- For DOM nodes, avoid vague suffixes like `El`. Use the element type when it
  helps:

```ts
const labelSpan = document.createElement("span");
const valueStrong = document.createElement("strong");
```

- If the role is already obvious, a plain name is fine:

```ts
const row = document.createElement("div");
```

- Do not make names huge for their own sake. The goal is to remove ambiguity,
  not to narrate every operation.

## Conditions

- If a condition has several parts, extract the part with the most meaning into
  a named boolean.
- Avoid piling negation directly onto a function call when a name would explain
  the intent.

Prefer:

```ts
const nextStarCannotBeReached = nextStarOutOfReach(
  stars,
  starMode,
  elapsedSeconds,
  mistakes,
);

if(softPromptShown || stars < 1 || !nextStarCannotBeReached) {
  return false;
}
```

Over:

```ts
if(softPromptShown || stars < 1 || !nextStarOutOfReach(stars, starMode, elapsedSeconds, mistakes)) {
  return false;
}
```

## Dependency Blobs

- Passing a small dependency object into a factory is okay.
- A giant `SomethingDeps` object is a code smell when it mixes unrelated
  concerns, especially DOM nodes, gameplay state, audio, settings, and callbacks.
- Do not refactor a dependency blob just to make it look nicer during a gameplay
  change. When it becomes painful, split it by responsibility, such as:
  `HudElements`, `HudStateReaders`, `HudActions`, and `HudAudio`.

## Spacing

- Use compact control-flow spacing in files following this standard:
  `if(condition)`, `for(const item of items)`, `while(condition)`,
  `switch(value)`, and `catch(error)`.
- Keep ordinary spaces around operators and before braces:

```ts
if(nextStarCannotBeReached && stars > 0) {
  return true;
}
```

- Some older files still use standard TypeScript spacing like `if (condition)`.
  Do not mix spacing styles casually inside one file. Convert a file with a
  mechanical formatting pass when it becomes one of the files living under the
  new standard.
- Indentation is still the repo's existing two spaces for now. A four-space
  experiment should be a separate mechanical pass, not mixed into gameplay or
  copy edits.

## Player-Facing Copy

- Keep helper text friendly and specific.
- Avoid score-system language like "penalty", "cost", "expensive", or "run"
  unless the UI is explicitly explaining rules.
- Prefer observations and next-step advice: what happened, where to look, and
  what to try next.
