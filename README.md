# Picta

Picta turns a short stretch of a book into a reading you can see. You add up to 8 pages by pasting text or photographing the page. You choose how many of those pages get a scene, see the estimated Magic Hour credit cost, and confirm. A page stays text until you tap it. That tap makes one scene for the strongest moment on the page and places it beside the text. A photographed page can also show the same scene on the photo.

There is no account. The reading stays in this browser.

## Tech stack

- TypeScript, React, and Next.js (App Router) on a self-hosted Node process
- IndexedDB in the browser for the reading
- SQLite on the server for rate-limit counters
- Gemini 2.5 Flash for reading a page and writing the scene prompt
- Magic Hour (`z-image-turbo`) for the image
- Vitest for tests
