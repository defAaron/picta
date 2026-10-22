# Problem 5: Live scenes and the page frame

> **For the orchestrator:** Deliver only this problem. This is the first problem allowed to call Magic Hour, and only after the tests pass with a mock.

**Goal:** With a Magic Hour key, a tap renders a real 640px scene and a photographed page can show that scene on the photo. Without the key, Problem 4’s simulated scene still works.

**Depends on:** Problem 4. The scene routes, the mock client, and the Illustrate control exist.

## Files

- Modify: `src/lib/magic-hour.ts` to add the live client beside the mock
- Modify: `src/app/api/scenes/route.ts` and `src/app/api/scenes/[projectId]/route.ts` to choose the client
- Create: `src/lib/compose.ts`, `src/lib/compose.test.ts`, `src/app/on-page-view.tsx`
- Modify: `src/app/reading-screen.tsx` to open the on-page view and to drop the simulated label when the scene is real
- Create: `src/lib/magic-hour.live.test.ts` only if it uses a fake `fetch`. Do not put a live call in the test suite.

## Waves

**Wave A — two agents.**

- Agent magic hour: live client and fake-fetch tests. Do not edit the reading screen.
- Agent compose: `src/lib/compose.ts`, its test, and `src/app/on-page-view.tsx`. Do not edit the scene routes.

**Wave B — one agent.** Wire the client choice into the routes and add the “See it on the page” button on the reading screen.

## Live client

```ts
export function createLiveMagicHourClient(apiKey: string, fetchImpl?: typeof fetch): MagicHourClient
```

`create` POSTs `https://api.magichour.ai/v1/ai-image-generator` with `Authorization: Bearer <key>` and this JSON:

```json
{
  "image_count": 1,
  "model": "z-image-turbo",
  "aspect_ratio": "1:1",
  "resolution": "640px",
  "style": { "prompt": "<imagePrompt>", "tool": "general" }
}
```

It returns `id` as `projectId` and `credits_charged` as `creditsCharged`. Status 402 becomes a thrown error the route maps to 402 `{ "error": "insufficient_credits" }`. The route then rolls back the scene window and clears the in-flight row, the same way a generic create failure already does.

`get` calls `GET /v1/image-projects/{id}`.

- `queued` and `rendering` map to `{ status: "rendering" }`.
- `error` and `canceled` map to `{ status: "error" }`.
- `complete` downloads the file from the details payload’s download URL on the server and returns the bytes. A missing download URL throws, and the route responds 502 `{ "error": "download_failed" }` without clearing the row.

The fake-fetch test asserts the JSON fields above and asserts the bearer token is the argument, not a hardcoded key.

## Which client

If `MAGIC_HOUR_API_KEY` is non-empty, the routes use the live client. Otherwise they use `createMockMagicHourClient`. The response of POST includes `"simulated": true` only for the mock. The UI shows `Simulated scene` only when `simulated` is true.

A missing Gemini key still returns 502 from the existing Gemini client. Do not catch that and silently simulate a prompt.

## On-page view

`composePage(photo: ImageBitmap, scene: ImageBitmap): Promise<Blob>` draws the photo at its natural size and paints the scene:

- centered horizontally
- inset 8% of the photo width from each side
- height 42% of the photo height
- top edge at 50% of the photo height
- a soft shadow

The function returns a PNG blob. The test can use a small offscreen canvas if the test environment has `OffscreenCanvas`. If it does not, keep the geometry in a pure function and test that:

```ts
export function sceneFrame(photoWidth: number, photoHeight: number): {
  x: number
  y: number
  width: number
  height: number
}
```

`sceneFrame(1000, 2000)` returns `{ x: 80, y: 1160, width: 840, height: 840 }`. The frame is the lower 42% of the photo: `y` is `photoHeight - height`.

The view is a button, `See it on the page`, on a page that has both a photo and a complete scene. It draws into a canvas. Pasted pages do not show the button. There is no perspective warp.

## UI failure copy

Use the sentences already implied by the routes:

- 402: `Picta is out of image credits.`
- 502 on create: `Couldn't start the scene.`
- refunded status: remove the image and restore the slot
- download failure: `Check again`, and do not restore the slot

## Security checks

Run the checklist in `docs/implementation/process.md`.

- The live URL appears only in `src/lib/magic-hour.ts`.
- The key is read from `process.env.MAGIC_HOUR_API_KEY` inside server code. Search `src/app` for that string in client components and expect no matches. The reading screen must not mention the env var.
- Fake-fetch tests do not use a real key. Use the literal `test-key`.

## Done when

`npm test` passes with no network. With a key in `.env.local` (not committed), one tap produces a real image and the simulated label is absent. Without the key, the simulated scene from Problem 4 still appears. A photographed page with a finished scene opens the framed view.
