# Picta — Product Requirements

**Status:** v1 spec, approved direction  
**Date:** 2026-10-22

Picta turns a short stretch of a book into a reading you can see. You bring a few pages, as pasted text or as photos of the physical page. You decide how many of those pages get a scene, you see the Magic Hour credit cost, and you confirm. After that, a page stays text until you illustrate it. The scene then sits beside that page. If the page came from a photo, you can also open the same scene placed on that photo.

## Problem

Some readers follow a story more easily when they can see the moment. They already have the book. They do not have a picture for the page they are on, and they do not want a whole novel redrawn. They want one honest scene for the page in front of them, next to the words, without spending image credits on pages they never asked to see.

## Product summary

Picta is a single-browser reading tool.

1. You start a reading from pasted text, page photos, or a mix of both, up to 8 pages.
2. You check the text. Photos are transcribed so you can fix a bad read.
3. You say how many pages you want scenes for. Picta shows an estimate of about 5 Magic Hour credits per page and waits for a confirmation. Confirmation does not generate anything.
4. You tap a page. Picta picks the strongest visual moment on that page and generates one scene.
5. The scene appears beside that page’s text. You can scroll back through the reading, including pages you left as text.
6. A photographed page can also show the scene placed on the original photo.

There is no account. The reading lives in this browser. A refresh keeps it. A different browser starts empty.

## Who it is for

A person reading a short excerpt — a few pages of a novel, a story, or a chapter — who wants pictures for some of those pages. v1 is built for one reader at a time on their own machine’s browser. It is not a library, a classroom product, or a multi-user service.

## What v1 is

A reading has up to 8 pages. A page is the unit you illustrate. One confirmed page in the budget equals one scene. The app chooses the moment; you do not write the image prompt.

| Choice | v1 behavior |
| --- | --- |
| How you read | A digital chapter. Each page is text. A finished scene sits beside it. |
| Second view | The same scene, placed on the original photo, for pages that have a photo. |
| How a scene starts | You tap one page. |
| What the tap means | One scene for that whole page, based on its strongest visual moment. |
| How spending is controlled | You name a page count, see the credit estimate, and confirm. Taps spend that budget. |
| How long it lasts | This browser only. Refresh keeps the current reading. |
| Input size | At most 8 pages per reading. A typical reading is 5–8 pages. |

## Main flows

### Start a reading

The empty state offers two actions: paste text, and add page photos. Both can feed the same reading until it reaches 8 pages.

**Paste.** You paste an excerpt. Picta splits it into pages (see Page rules). If the excerpt is longer than 8 pages, Picta refuses it and asks for a shorter excerpt. You can edit a page’s text, join two neighboring pages, split a page at the cursor, and reorder pages.

**Photos.** You add pictures of pages, one page per picture. Each picture is read into text. You can correct that text. A picture that is not a single book page is declined, with a short reason, and does not become a page. You can reorder pages.

Starting over replaces the current reading. Picta asks before it deletes what is already stored in the browser.

### Confirm a budget

When at least one page exists, you choose how many scenes to budget. The number is at least 1, and it cannot exceed the scenes this browser is still allowed to create today.

Picta shows:

- the page count you entered
- about 5 credits per scene
- the estimated total (`count × 5`)
- a line that the real charge is whatever Magic Hour reports, and that a failed render is refunded by Magic Hour

You confirm or cancel. Cancel leaves every page as text. The first confirmation sets the budget to that page count. A later confirmation adds to whatever budget is left. Neither one requests an image.

The first confirmation also cannot be higher than the number of pages that have no scene. A later confirmation can add taps for those pages, or for replacing a scene, up to the daily remainder. Replacing the reading does not reset that daily allowance.

### Illustrate a page

Each page without a scene has an Illustrate control. The tap:

- does nothing to Magic Hour while a confirmation is still missing
- if the budget is already used up, opens the budget step again so you can add more pages
- if another scene is already generating, waits; only one scene is generated at a time
- otherwise creates one scene for that page

While the image is rendering, the page shows that it is working. When it finishes, the scene appears beside the text, with a one-sentence caption naming the moment that was chosen.

Illustrating a page that already has a scene asks you first. Replacing the scene spends another page from the budget. If the budget is empty, the budget step comes up before the replacement starts.

### Read

You scroll the pages in order. Pages you have not illustrated stay text. Pages you have illustrated keep their scene when you scroll away and come back. On a wide window the scene sits beside the page text. On a narrow window it sits under the text.

### See it on the page

A page that has both a photo and a finished scene offers “See it on the page.” That view shows the photograph with the scene placed on it, in a frame toward the bottom of the photo, inset from the edges, with a soft shadow so it reads as sitting on the paper.

v1 does not warp the scene into the page’s perspective, find the margins, or avoid printed words automatically. Pasted pages do not have this view.

## Page rules

A reading holds 1 to 8 pages.

**From a photo.** One accepted photo is one page, in the order you added it. A picture of two full pages is declined. You photograph one page at a time. A little of the facing page in the frame is still one page.

**From pasted text.**

1. A paste longer than 20,000 characters is refused.
2. A line that is only `---` starts a new page.
3. A section of 2,500 characters or fewer is one page.
4. A longer section breaks on blank lines, packing paragraphs until a page reaches about 2,500 characters. A single paragraph longer than 2,500 characters is still one page.
5. Empty pages are dropped.
6. More than 8 pages after the split is refused.

After the split, you may edit the words. You may join a page with the next one when the result would be 5,000 characters or fewer. You may split a page at the cursor. You may move a page earlier or later. The reading must stay within 8 pages.

You review the pages before the budget step so a bad photo transcription can be fixed before any scene is spent.

## Functional requirements

1. Paste text and page photos can both become pages of one reading.
2. A photo is transcribed before it counts as a page. You can edit the transcription.
3. Unreadable photos, photos that are not a book page, and photos of two full pages never become a page.
4. The budget step shows an estimate and requires confirmation before the first scene, and again before a tap that would pass the confirmed count.
5. Confirmation alone creates no scene.
6. One tap creates at most one scene, for one page, for one moment on that page.
7. The scene is shown beside that page’s text and kept when you scroll.
8. Photographed pages with a scene can show the scene on the original photo.
9. Refresh restores the current reading, including text, photos, budget, and finished scenes.
10. A different browser, or a cleared site storage, starts with no reading.
11. Replacing the reading requires confirmation.
12. Only one scene generates at a time.
13. A failed Magic Hour render restores that page’s budget slot. A failed download after a successful render does not. You can retry the download.
14. Input that fails the safety checks never starts an image job.

## Safety

Book text and page photos are untrusted data. They are not instructions to Picta.

Picta refuses a photo or a page when:

- it is empty, unreadable, or not a page of prose
- the page has no concrete visual moment (a contents page, a blank page, a page of pure argument with nothing to depict)
- illustrating it would sexualize a minor
- the text is being used to steer the image system into something other than a scene from the page
- the image prompt would need to copy a known existing illustration, name a living artist’s style, or put words and logos into the picture

The reader sees a plain-language reason. The page stays text.

Picta also refuses oversized pastes, oversized images, unsupported file types, and readings that would grow past 8 pages. Those checks happen before a model is called.

The image vendor receives a short scene description written for that page. It does not receive the raw page, the photo, or the conversation.

## Credits and limits

Two different limits exist, and both apply.

**The budget you confirm** protects Magic Hour credits. It is the page count you agreed to, times about 5 credits. It lives in the browser. Taps spend it. You can raise it only by confirming a new estimate.

**The server limits** protect the shared Gemini and Magic Hour accounts from a modified browser. This browser can create at most 8 scenes in a rolling day. An IP address can create at most 20. Gemini calls are capped per browser and per IP as well. The budget step cannot offer more scenes than the server still allows.

Clearing the site cookie starts a new server allowance for that browser. The IP limit remains, so clearing storage is not a way to drain the image account. Starting a second reading the same day does not raise the 8-scene allowance.

Exact server numbers, model names, and request shapes are in the architecture doc.

## What you see when something fails

| Situation | What happens |
| --- | --- |
| Photo is not a usable book page | The photo is not added. The reason is shown. |
| Excerpt is longer than 8 pages | Nothing is added. You are asked to shorten it. |
| Page cannot be illustrated | The page stays text. The reason is shown. No credit is spent. |
| Budget is used up | The estimate step opens again. No image is requested until you confirm more pages. |
| Daily scene limit is used up | Illustrate is unavailable until the window resets. The time is shown. |
| Another scene is already rendering | The new tap waits. It does not start a second job. |
| Image render fails | The page returns to text. The budget slot is restored. |
| Render finishes but the file does not save | The slot stays spent. You can try the download again. |
| Gemini or Magic Hour is unreachable | The page is unchanged. A spent slot is restored only when no image job was accepted. |

## Out of scope for v1

- Accounts, sign-in, and a library of past books
- Uploading a whole book, or more than 8 pages in one reading
- Generating a scene for every page without a tap
- Letting you write or edit the image prompt
- Perspective-matched printing, margin detection, or covering no words on the photo
- Sharing a reading, exporting a PDF, or collaborative reading
- Mobile native apps
- Taking payment, or letting each reader use their own Magic Hour key
- Automatic style matching to a particular illustrator or film

## Success criteria

v1 is complete when a reader can do all of the following in one browser:

1. Build a reading of up to 8 pages from a paste, from photos, or from both, and fix the text before spending anything.
2. Confirm a credit estimate and see that no scene exists until a page is tapped.
3. Illustrate a chosen page, see one scene beside that page, scroll away, and find it still there after refresh.
4. Open the on-page view for a photographed page that has a scene.
5. Get stopped, with a new estimate, when a tap would exceed the confirmed budget.
6. Be declined, with no image job, when the photo or the page fails the safety checks.

## Assumptions

- Magic Hour’s `z-image-turbo` model remains available on the free plan at about 5 credits for one 640px image. The estimate uses 5. The charge shown after a job is the value Magic Hour returns.
- Gemini 2.5 Flash remains free for text and image input. On that free tier, Google may use inputs to improve its products. Page text and page photos are sent to Gemini. They are not sent to Magic Hour.
- Readers accept that the on-page view is a frame placed on the photo, not a scene printed into the paper.
