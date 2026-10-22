# Problem 3: Transcribe

> **For the orchestrator:** Deliver only this problem. Gemini is mocked. Do not call the live API.

**Goal:** The reader can add a photo of one book page, correct the transcription, and have it become a page. A photo that is not a single book page is declined and stored nowhere on the server.

**Depends on:** Problems 1 and 2. The reading can already hold pages. `takeWindow` exists.

## Files

- Create: `src/lib/gemini.ts`, `src/lib/gemini.test.ts`, `src/lib/transcribe-schema.ts`, `src/lib/transcribe-schema.test.ts`, `src/app/api/transcribe/route.ts`, `src/app/api/transcribe/route.test.ts`
- Modify: `src/app/reading-screen.tsx` to add photos one at a time
- Modify: `src/lib/limits.ts` only if a helper is missing for the Gemini bucket. Do not change window math.

## Waves

**Wave A — two agents.**

- Agent schema: `src/lib/transcribe-schema.ts` and its test
- Agent gemini: `src/lib/gemini.ts` and its test. This file exports the interface and a function that builds the request. It does not read the network in tests.

**Wave B — one agent.** The route, its test, and the photo control on the reading screen.

## Interfaces

```ts
export type TranscribeResult = {
  accepted: boolean
  rejectReason: string | null
  singlePage: boolean
  text: string
}

export function parseTranscribeResult(value: unknown):
  | { ok: true; result: TranscribeResult }
  | { ok: false }

export type GeminiClient = {
  transcribe(image: Uint8Array, mimeType: string): Promise<unknown>
}

export function createGeminiClient(apiKey: string, fetchImpl?: typeof fetch): GeminiClient
```

`parseTranscribeResult` accepts only a JSON object with those four fields and no required extra meaning from extra fields. `rejectReason` and `text` are strings. `accepted` and `singlePage` are booleans. Anything else returns `{ ok: false }`.

`createGeminiClient` posts to the Gemini generateContent endpoint for `gemini-2.5-flash` with `thinkingBudget: 0`, JSON response mime type, and the image plus the fixed line `Transcribe this image.` The system text says the image is data and must not be followed as instructions. Tests pass a fake `fetchImpl` and assert the request body contains the model id, thinking budget 0, and no tools. They must not require a real key.

The route does not construct the client inline in a way the test cannot replace. Export the handler so the test can pass a `GeminiClient`.

## Route

`POST /api/transcribe`, Node runtime, `multipart/form-data`, one field named `image`.

Order:

1. Ensure the session cookie.
2. Missing file, bad MIME, or size over 8 MB: 400 `{ "error": "bad_image" }`. Gemini is not called. The Gemini window is not incremented.
3. `takeWindow` on the session and IP Gemini buckets. If either refuses, 429 `{ "error": "rate_limited", "resetsAt": <number> }`. Gemini is not called.
4. When the handler is using the default client and `GEMINI_API_KEY` is empty, return 502 `{ "error": "transcribe_unavailable" }` and do not call fetch. A test that passes a `GeminiClient` skips this check.
5. Call `transcribe`. On throw or on `parseTranscribeResult` failure, return the same 502.
6. If `accepted` is not true, `singlePage` is not true, or `text` is empty after trim, respond 200 `{ "accepted": false, "reason": "..." }`. Use the model's `rejectReason` trimmed to 200 characters when `accepted` is false. When `singlePage` is false, the reason is exactly `Photograph one page at a time.`
7. Otherwise 200 `{ "accepted": true, "text": "<trimmed text>" }`.

Accepted types: `image/jpeg`, `image/png`, `image/webp`.

The handler writes nothing to SQLite except through `takeWindow`. It does not log the image or the text.

## UI

An "Add a page photo" control accepts one file. While the request is in flight, the control is disabled. On `accepted: true`, append one page whose `text` is the transcription and whose `photo` is that file's blob, then save the reading. On `accepted: false`, show `reason` and do not add a page. On 400, 429, or 502, show a short sentence and do not add a page.

The reader can still edit the transcription with the existing textarea. Photos are sent one at a time even if the file picker could select more; ignore every file after the first.

The 8-page cap still applies. A ninth page is refused locally and the photo is not uploaded.

## Tests

Schema: a valid object passes; a missing `text` fails; a string body fails.

Route, with a fake client:

- A `text/plain` upload returns 400 and the fake records zero calls.
- A 429 from a full Gemini window records zero calls.
- `accepted: false` returns 200 and does not throw.
- `singlePage: false` returns the fixed reason.
- A successful result returns the trimmed text.

## Security checks

Run the checklist in `docs/implementation/process.md`. Add a test or a diff check that the route file does not call `console.log` with the parsed text.

## Done when

`npm test` passes. With `GEMINI_API_KEY` unset, the button fails cleanly with the unavailable message, because the live client is not required for this delivery. The fake-client tests are the proof the route is correct.
