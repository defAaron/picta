# Picta implementation plan

> **For the orchestrator:** Follow `.cursor/rules/problem-orchestration.mdc` and `docs/implementation/process.md`. Deliver one numbered problem, then stop. After it is finished, stagger the commits the way `process.md` describes: several commits per problem, never one. Do not use a plan that keeps going through later problems in the same turn.

**Goal:** A browser reading of up to 8 book pages, with a confirmed Magic Hour budget and one scene per tapped page.

**Architecture:** The browser keeps the reading in IndexedDB. A self-hosted Next.js Node process holds the API keys, calls Gemini 2.5 Flash and Magic Hour, and enforces abuse limits. Providers are mocked until Problem 5.

**Tech stack:** TypeScript, Next.js App Router on the Node.js runtime, React, Vitest, `fake-indexeddb`, `better-sqlite3`. No UI component library. No Tailwind.

## Global constraints

Every problem inherits these. Do not pick different numbers.

- Maximum 8 pages in one reading. A paste over 20,000 characters is refused. A page from a join is at most 5,000 characters. Automatic splits target 2,500 characters and break on a blank line. A line that is only `---` is a page break.
- One confirmed scene costs an estimate of 5 credits. The first confirmation sets `budgetRemaining`. A later confirmation adds to it. Confirmation does not call Magic Hour.
- `hasConfirmedBudget` is false until the first confirmation. Spent-to-zero is not the same as never confirmed.
- Gemini model id `gemini-3.8-flash`, `thinkingLevel` `low`, grounding off, tools off.
- Magic Hour: `model` `z-image-turbo`, `image_count` 1, `resolution` `640px`, `aspect_ratio` `1:1`, `style.tool` `general`. The image prompt is the model’s `imagePrompt`, 1–500 characters, never the raw page.
- Session scene cap 8 per 24 hours. IP scene cap 20 per 24 hours. Session Gemini cap 20 per hour. IP Gemini cap 60 per hour. One in-flight scene per session, released on acknowledge, render error, or after 5 minutes.
- Cookie name `picta_sid`. HttpOnly, SameSite=Lax, Secure only on HTTPS, 30 days.
- Ignore `X-Forwarded-For` unless `TRUSTED_PROXY=true`.
- Photos: `image/jpeg`, `image/png`, `image/webp`, maximum 8 MB, transcribed one at a time.
- Server stores no page text and no photo. The in-flight row may hold the scene prompt until that job ends.
- A typed Gemini key is sent as `X-Picta-Gemini-Key`. A blank Gemini key uses `GEMINI_API_KEY`. Magic Hour uses only `X-Picta-Magic-Hour-Key`. Keys stay in tab memory and are not stored.
- No accounts. One reading in IndexedDB database `picta`.
- On-page frame: centered, inset 8% from each side, lower 42% of the photo height, soft shadow. No perspective warp.
- Poll every 2 seconds. Stop the timer after 3 minutes and offer “Check again.”

## Problems

Deliver these in order. Each file is the only plan the implementing agents should open.

| Problem | File | What the user can test when it stops |
| --- | --- | --- |
| 1 | [01-local-reading.md](01-local-reading.md) | Paste an excerpt, fix the pages, confirm a credit estimate, refresh, and find it still there. |
| 2 | [02-session-and-limits.md](02-session-and-limits.md) | The budget dialog refuses a count the server quota does not allow. |
| 3 | [03-transcribe.md](03-transcribe.md) | A page photo becomes editable text, and a non-page photo is declined. |
| 4 | [04-illustrate.md](04-illustrate.md) | Tapping a page spends one local budget slot and shows a mocked scene. A second tap is blocked while it is in flight. |
| 5 | [05-live-scenes-and-page-frame.md](05-live-scenes-and-page-frame.md) | A real scene renders beside the page, and a photo page can show that scene on the photo. |
| 6 | [06-security-pass.md](06-security-pass.md) | No new feature. The security checks pass on the finished app. |

Problems 2 and 3 both depend on Problem 1 and touch different files, but they are still separate deliveries. Do not start 3 in the same turn as 2.

## Waves inside a problem

The problem file lists waves. Wave A runs first. When every agent in wave A has finished, start wave B. Agents in the same wave run at the same time.

## Current status

No problem has been started. The next agent reads [handoff.md](handoff.md).
