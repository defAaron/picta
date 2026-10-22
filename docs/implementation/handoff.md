# Handoff

**Finished:** Problem 1 — Local reading
**Next:** Problem 2 — Session and limits
**Do this next:** Give the browser a session cookie, and stop the budget dialog from offering more scenes than the server quota allows.

## Read

- docs/implementation/02-session-and-limits.md
- docs/implementation/README.md (global constraints only)
- src/app/reading-screen.tsx
- package.json

## Do not read

- docs/implementation/03-transcribe.md
- docs/implementation/04-illustrate.md
- docs/implementation/05-live-scenes-and-page-frame.md
- docs/implementation/06-security-pass.md
- docs/implementation/01-local-reading.md
- src/lib/pages.ts, src/lib/budget.ts, src/lib/reading-store.ts, and src/lib/types.ts
- docs/prd.md and docs/architecture.md

## Trust these

- `splitPaste(input: string): SplitResult` — trims, then refuses empty, over 20,000 characters, or more than 8 pages. A line that is only `---` starts a section. Paragraphs pack at 2,500.
- `joinPages(left, right)` — trims, joins with a blank line, and refuses a result over 5,000 characters.
- `splitPageAt(text, index)` — splits at a character offset. An empty side is `empty_side`.
- `estimateCredits(count)` — `count * 5`.
- `maxConfirmable({ isFirstConfirmation, pagesWithoutScene, sceneCreatesRemaining })` — the first confirmation is the lesser of the two counts; a later one uses `sceneCreatesRemaining`. Never negative.
- `nextBudget(budgetRemaining, count, isFirst)` — the first confirmation sets the budget to `count`; a later one adds `count`.
- `loadReading` / `saveReading` / `clearReading` — IndexedDB database `picta`, object store `reading`, key `current`.

## Do not redo

Pasting, reordering, joining, and splitting pages already works, and a confirmed budget stays after refresh. Confirmation does not call a server. There is no Illustrate button and no API route.
