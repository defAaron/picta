# Problem 1: Local reading

> **For the orchestrator:** This is the only problem to deliver in this turn. Waves are below. Subagents do not commit.

**Goal:** A reader can paste up to 8 pages, fix them, confirm a credit estimate, refresh, and find the same reading.

**Out of scope:** API routes, cookies, photos, Gemini, Magic Hour, and an Illustrate button.

## Files

- Create: `package.json`, `tsconfig.json`, `next.config.ts`, `vitest.config.ts`, `.gitignore`, `.env.example`, `src/app/layout.tsx`, `src/app/page.tsx`, `src/app/globals.css`, `src/lib/types.ts`, `src/lib/pages.ts`, `src/lib/pages.test.ts`, `src/lib/budget.ts`, `src/lib/budget.test.ts`, `src/lib/reading-store.ts`, `src/lib/reading-store.test.ts`, `src/app/reading-screen.tsx`
- The repo already contains `docs/` and `.cursor/`. Do not delete them. `create-next-app` will refuse this directory because it is not empty, so write the scaffold files directly.

## Waves

**Wave A — one agent.** Scaffold and `src/lib/types.ts`. Files: package files, `src/app/layout.tsx`, `src/app/page.tsx`, `src/app/globals.css`, `src/lib/types.ts`. Do not edit the test files.

**Wave B — three agents at once, after wave A.**

- Agent pages: `src/lib/pages.ts`, `src/lib/pages.test.ts`
- Agent budget: `src/lib/budget.ts`, `src/lib/budget.test.ts`
- Agent store: `src/lib/reading-store.ts`, `src/lib/reading-store.test.ts`

**Wave C — one agent, after wave B.** `src/app/reading-screen.tsx` and wire it from `src/app/page.tsx`.

## Interfaces

```ts
export type Reading = {
  id: string
  createdAt: number
  hasConfirmedBudget: boolean
  budgetRemaining: number
  restoredProjectIds: string[]
  pages: Page[]
}

export type Page = {
  id: string
  text: string
  photo: Blob | null
  scene: Scene | null
}

export type Scene = {
  projectId: string
  moment: string
  imagePrompt: string
  creditsCharged: number
  status: "rendering" | "complete" | "download_failed"
  image: Blob | null
}

export type SplitResult =
  | { ok: true; pages: string[] }
  | { ok: false; reason: "empty" | "too_long" | "too_many_pages" }

export function splitPaste(input: string): SplitResult
export function joinPages(left: string, right: string):
  | { ok: true; text: string }
  | { ok: false; reason: "too_long" }
export function splitPageAt(text: string, index: number):
  | { ok: true; left: string; right: string }
  | { ok: false; reason: "empty_side" }

export const CREDITS_PER_SCENE = 5
export function estimateCredits(sceneCount: number): number
export function maxConfirmable(input: {
  isFirstConfirmation: boolean
  pagesWithoutScene: number
  sceneCreatesRemaining: number
}): number
export function nextBudget(budgetRemaining: number, count: number, isFirst: boolean): number

export function loadReading(): Promise<Reading | null>
export function saveReading(reading: Reading): Promise<void>
export function clearReading(): Promise<void>
```

`photo` and `scene` stay null in this problem. The fields exist so later problems do not change the record shape.

## Subproblem A1: Scaffold

`.gitignore` includes `.env`, `.env.local`, `.env*.local`, `data/`, and `*.sqlite`. `.env.example` exists and its values are empty:

```
GEMINI_API_KEY=
MAGIC_HOUR_API_KEY=
TRUSTED_PROXY=
```

`package.json` scripts: `dev` is `next dev`, `test` is `vitest run`. Dependencies: `next`, `react`, `react-dom`. Dev dependencies: `typescript`, `@types/react`, `@types/react-dom`, `@types/node`, `vitest`, `fake-indexeddb`. Install the current latest of each. Do not add Tailwind.

`vitest.config.ts` runs `src/**/*.test.ts` in the `node` environment.

`src/lib/types.ts` exports `Reading`, `Page`, and `Scene` exactly as written above.

`src/app/page.tsx` renders the reading screen. `layout.tsx` sets the document title to `Picta`.

## Subproblem B1: Page splitting

Write `src/lib/pages.test.ts` first and watch it fail, then implement `src/lib/pages.ts`.

Rules:

- Normalize `\r\n` to `\n`. Trim the whole paste.
- Longer than 20,000 characters returns `{ ok: false, reason: "too_long" }`.
- Empty after trim returns `{ ok: false, reason: "empty" }`.
- Split into sections on lines that are exactly `---`.
- A section of 2,500 characters or fewer is one page. Drop a section that is empty after trim.
- A longer section splits on `\n\n`. Pack whole paragraphs into a page until the next paragraph would make it longer than 2,500. Join packed paragraphs back with `\n\n`. A paragraph longer than 2,500 characters is its own page.
- More than 8 pages returns `{ ok: false, reason: "too_many_pages" }`.
- `joinPages` trims both sides, joins them with `\n\n`, and returns `too_long` when the result is longer than 5,000 characters.
- `splitPageAt` uses the index as a character offset. Either side empty after trim returns `empty_side`.

```ts
import { describe, expect, it } from "vitest"
import { joinPages, splitPageAt, splitPaste } from "./pages"

describe("splitPaste", () => {
  it("rejects an empty paste", () => {
    expect(splitPaste("  \n")).toEqual({ ok: false, reason: "empty" })
  })

  it("rejects more than 20000 characters", () => {
    expect(splitPaste("a".repeat(20001))).toEqual({ ok: false, reason: "too_long" })
  })

  it("keeps a short paste as one page", () => {
    expect(splitPaste("Hello.")).toEqual({ ok: true, pages: ["Hello."] })
  })

  it("splits on a line that is only ---", () => {
    expect(splitPaste("One\n---\nTwo")).toEqual({ ok: true, pages: ["One", "Two"] })
  })

  it("packs paragraphs that fit in 2500 characters", () => {
    const a = "a".repeat(2000)
    const b = "b".repeat(400)
    expect(splitPaste(`${a}\n\n${b}`)).toEqual({ ok: true, pages: [`${a}\n\n${b}`] })
  })

  it("starts a new page when the next paragraph would pass 2500", () => {
    const a = "a".repeat(2000)
    const b = "b".repeat(600)
    expect(splitPaste(`${a}\n\n${b}`)).toEqual({ ok: true, pages: [a, b] })
  })

  it("keeps one long paragraph together", () => {
    const block = "a".repeat(2501)
    expect(splitPaste(block)).toEqual({ ok: true, pages: [block] })
  })

  it("refuses a ninth page", () => {
    const text = Array.from({ length: 9 }, (_, i) => `Page ${i}`).join("\n---\n")
    expect(splitPaste(text)).toEqual({ ok: false, reason: "too_many_pages" })
  })
})

describe("joinPages", () => {
  it("joins with a blank line", () => {
    expect(joinPages("One", "Two")).toEqual({ ok: true, text: "One\n\nTwo" })
  })

  it("rejects a join over 5000 characters", () => {
    expect(joinPages("a".repeat(2500), "b".repeat(2500))).toEqual({
      ok: false,
      reason: "too_long",
    })
  })
})

describe("splitPageAt", () => {
  it("splits at the cursor", () => {
    expect(splitPageAt("abcdef", 3)).toEqual({ ok: true, left: "abc", right: "def" })
  })

  it("rejects a split that would leave an empty side", () => {
    expect(splitPageAt("abcdef", 0)).toEqual({ ok: false, reason: "empty_side" })
  })
})
```

Run: `npx vitest run src/lib/pages.test.ts`

## Subproblem B2: Budget

Write the tests first.

`estimateCredits(3)` is 15. `estimateCredits(0)` is 0.

`maxConfirmable` returns the lesser of `pagesWithoutScene` and `sceneCreatesRemaining` when `isFirstConfirmation` is true. Otherwise it returns `sceneCreatesRemaining`. It never returns a negative number.

`nextBudget(0, 2, true)` is 2. `nextBudget(1, 2, false)` is 3.

```ts
import { describe, expect, it } from "vitest"
import { estimateCredits, maxConfirmable, nextBudget } from "./budget"

describe("budget", () => {
  it("estimates 5 credits per scene", () => {
    expect(estimateCredits(3)).toBe(15)
  })

  it("caps the first confirmation by pages that have no scene", () => {
    expect(maxConfirmable({
      isFirstConfirmation: true,
      pagesWithoutScene: 2,
      sceneCreatesRemaining: 8,
    })).toBe(2)
  })

  it("lets a later confirmation use the server remainder", () => {
    expect(maxConfirmable({
      isFirstConfirmation: false,
      pagesWithoutScene: 0,
      sceneCreatesRemaining: 4,
    })).toBe(4)
  })

  it("sets the budget on the first confirmation and adds after that", () => {
    expect(nextBudget(0, 2, true)).toBe(2)
    expect(nextBudget(1, 2, false)).toBe(3)
  })
})
```

Run: `npx vitest run src/lib/budget.test.ts`

This problem's UI passes `sceneCreatesRemaining: 8` because the server quota does not exist yet.

## Subproblem B3: Reading store

Database name `picta`, object store `reading`, key `current`. `saveReading` replaces that one record. `clearReading` deletes it. `loadReading` returns null when it is missing.

The test file imports `fake-indexeddb/auto` before the store. Round-trip a reading with one page, `hasConfirmedBudget: true`, and `budgetRemaining: 2`. Then clear it and expect null.

Blobs are not used yet. Still store `photo: null` and `scene: null` without dropping the fields.

Run: `npx vitest run src/lib/reading-store.test.ts`

## Subproblem C1: Reading screen

One screen, plain CSS, no component library.

- Empty state: a textarea and an "Add pages" button.
- "Add pages" runs `splitPaste`. On failure, show the reason in a sentence and leave the current reading unchanged. On success, append those pages until the reading would pass 8 pages; if it would, add nothing and say the excerpt is too long.
- Each page shows its text in a textarea. Buttons: move earlier, move later, join with next, split at the textarea selection. Join and split call the functions above. Hide join when it would fail. Hide split when the selection would fail or when the reading already has 8 pages.
- "Start over" asks `window.confirm`, then `clearReading`.
- Budget: a number input and the sentence `About N credits`. N comes from `estimateCredits`. Confirm is disabled when the number is below 1 or above `maxConfirmable`. Confirming saves `hasConfirmedBudget: true` and the new `budgetRemaining`. It does not add a scene.
- On load, `loadReading`. Every successful edit calls `saveReading`. A refresh shows the same pages and the same budget.

There is no Illustrate control in this problem.

## Security checks

No routes. Still confirm `.gitignore` covers `.env` and `data/`, and `.env.example` has no real keys.

## Done when

`npm test` passes, and a manual pass can paste two pages separated by `---`, confirm 1 scene, refresh, and see both pages and a remaining budget of 1.
