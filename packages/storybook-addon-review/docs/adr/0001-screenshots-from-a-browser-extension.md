---
status: accepted
date: 2026-11-24
deciders: project owner
rejected: [modern-screenshot, html-to-image, getDisplayMedia, HTML-in-Canvas]
---

# Screenshots from a browser extension

**Accepted 2026-11-24.** **The storybook-annotate addon takes each comment's screenshot in the user's own browser, at the moment the comment is added, through a small browser extension.** The extension's service worker calls `tabs.captureVisibleTab`; the canvas overlay asks for the capture over `postMessage`, hides its own outline and pins for that frame, and crops the PNG to the picked element or region, or to the visible canvas for a whole-story comment. The screenshot is the pixels the user saw, in the state they reached by interacting with the story. When the extension is not installed, the Annotate panel says so and links to its install steps, and the CLI falls back to today's headless capture after Send. We accept a one-time install of an unpacked extension, and that the capture covers only the visible part of the tab.

The addon keeps its own ADR series, numbered from 0001. [ADR 0002](./0002-no-headless-screenshot-fallback.md) replaces the headless fallback described here.

**Related**
- Decisions: [ADR 0002](./0002-no-headless-screenshot-fallback.md) (drops the headless fallback below)
- Code: [canvas-overlay.store.ts](../../src/canvas-overlay.store.ts), [manager.tsx](../../src/manager.tsx), [cli.ts](../../src/cli.ts)
- Skill: [storybook-review](../../../../plugins/storybook-review/skills/storybook-review/SKILL.md)
- Origin: written in AI Board (ADR 0012, Storybook for component review), before the addon moved to its own repo

## Context

- After Send, the CLI opens each commented story's `iframe.html` in headless Chromium (Playwright) and screenshots the element by its CSS path, or the region by its box.
- That page is a fresh render. A state the user reached by interacting is gone: an open `<details>`, an open menu, typed text, a scrolled container.
- On 2026-11-23 a session with four element comments took about 50 s between Send and output: three elements sat inside a `<details>` the user had opened, the fresh render had it closed, and each `element.screenshot()` waited out the 15 s timeout. All three came back "not captured".
- The user reviews in their everyday Chrome. A page cannot read its own pixels; only an extension, a capture prompt or an automation protocol can.

## Decision drivers

- The agent sees exactly what the user commented on, interactive state included.
- The user stays in their own browser and profile.
- No prompt or banner on every session.
- Send returns the comments within a second or two.
- The plugin can be extracted from this repo without dragging AI Board along.

## Options considered

| Option | What it is |
|---|---|
| **Browser extension** (chosen) | An unpacked extension calls `tabs.captureVisibleTab` when the overlay asks, at comment time. |
| Automated window | The CLI opens Storybook in a visible browser it drives (Playwright with installed Chrome on a dedicated profile, or its bundled Chromium) and screenshots each pick live. |
| Screen Capture API | `getDisplayMedia` with `preferCurrentTab`, cropped by Element Capture or Region Capture. |
| DOM-to-image library | modern-screenshot or html-to-image redraw the picked subtree into a canvas at comment time. |
| Pasted screenshot | The user takes a system screenshot and pastes it into the comment box. |
| Headless capture after Send, fixed | Keep the current flow, open closed `<details>` ancestors, and fall back to the old box at once when the element stays hidden. |
| HTML-in-Canvas | `drawElementImage` draws live DOM into a canvas. |

## Comparison

| | Real pixels, interactive state | User's own browser and profile | Per-session friction | Install | Browsers |
|---|---|---|---|---|---|
| **Browser extension** | Yes | Yes | None | Load unpacked once | Chrome; Firefox (temporary add-on unless signed); Safari after Xcode packaging |
| Automated window | Yes | No (separate profile or Chromium) | A second window | None | Chrome, Chromium |
| Screen Capture API | Yes | Yes | Prompt on every page load, sharing banner throughout | None | Cropping APIs in Chrome only |
| DOM-to-image library | No (redrawn; shadow DOM, canvas and some CSS come out wrong) | Yes | None | A dependency | All |
| Pasted screenshot | Yes | Yes | A manual step per comment | None | All |
| Headless capture, fixed | Only `<details>`; other state lost | Yes | None | None | All |
| HTML-in-Canvas | Yes | Yes | None | None | Not shipped (behind a Chrome flag, *unverified* 2026-11-24) |

## Evidence

- 2026-11-24, measured: Send to CLI exit takes 2.1 s with one element comment on a warm Storybook (0.5 s poll, about 1 s per headless screenshot, 0.2 s to stop Storybook). The 50 s session above is the timeout path, not the normal one.
- `tabs.captureVisibleTab` returns a PNG or JPEG data URL of the visible area of the active tab; Chrome rate-limits it to 2 calls per second (`MAX_CAPTURE_VISIBLE_TAB_CALLS_PER_SECOND`).
- Chrome 136 and later ignore `--remote-debugging-port` on the default profile, so an automated window cannot use the user's everyday profile.
- Release Firefox loads an unsigned extension only as a temporary add-on, removed on restart.

## Recommendation

Browser extension. It is the only option that gives real pixels in the user's own browser with no per-session friction.

## Consequences

- A new folder, `apps/web/.storybook/annotate/extension/`, holds a Manifest V3 extension (manifest, service worker, content script). The user loads it once from `chrome://extensions` (Developer mode, Load unpacked).
- The canvas overlay hides its hover outline, drag box and pins for the captured frame, then restores them.
- Only the visible viewport is captured: an element partly off screen is cropped to its visible part. Crops convert CSS px to device px (`devicePixelRatio`, browser zoom).
- A picked comment whose target moves (a pick while a comment is open) is captured again.
- PNGs leave the tab at comment time, through the preset's local-only routes, not through `sessionStorage` (its quota is about 5 MB).
- A whole-story comment gets a screenshot of the visible canvas (the preview iframe's box), with the extension or with the fallback.
- The CLI writes the PNGs it received into the session folder and prints their paths as today. It screenshots after Send only the comments that arrived without one (extension missing), in headless Chromium as today, and marks those as re-rendered, so the agent knows the state may differ from what the user saw.
- The extension answers a ping from the overlay. With no answer, the Annotate panel shows a notice with a link to the install steps (`extension/README.md`: Developer mode, Load unpacked, the folder path), and comments are still added.

## Revisit triggers

- HTML-in-Canvas can draw elements outside its canvas: the overlay can then draw the picked element itself, with no extension. Reaching Baseline is not enough (see Spike results).
- Chrome restricts `captureVisibleTab` for unpacked extensions or `localhost` pages.
- The plugin is extracted and published: the extension then needs a store listing or signed builds.

## Spikes

- Whether host permissions for `http://localhost/*` and `http://127.0.0.1/*` are enough for `captureVisibleTab` without `<all_urls>` or a user gesture on the extension (`activeTab`).
- How many animation frames the overlay must wait after hiding its outline before the capture no longer shows it.
- Crop accuracy at browser zoom other than 100% and on non-Retina displays.

## Unverified or volatile

- HTML-in-Canvas status (Chrome flag or origin trial) as of 2026-11-24.
- The exact permission `captureVisibleTab` needs in Manifest V3 (see Spikes).

## Sources

- Chrome `tabs.captureVisibleTab`: https://developer.chrome.com/docs/extensions/reference/api/tabs#method-captureVisibleTab
- Chrome remote debugging change (Chrome 136): https://developer.chrome.com/blog/remote-debugging-port
- Firefox temporary add-ons: https://extensionworkshop.com/documentation/develop/temporary-installation-in-firefox/

## Spike results (2026-11-25)

Tested in Playwright's Chromium with the unpacked extension (`packages/storybook-review-extension`, built with vite-plugin-web-extension) against the playground Storybook.

- **Permission:** host permissions for `http://localhost/*` and `http://127.0.0.1/*` are refused: "Either the '<all_urls>' or 'activeTab' permission is required." The extension asks for `<all_urls>`. Its content script still runs only on `http://localhost/iframe.html*` and `http://127.0.0.1/iframe.html*`; those patterns match any port.
- **Frames to wait:** hiding the overlay and waiting 2 animation frames leaves no outline, pin or banner in the capture.
- **Crop scale:** headless Chromium captures at 1× even with a device scale factor of 2, so the crop scale is the image width divided by the top window's width, not `devicePixelRatio`. This also covers browser zoom: at 75% and 150% (set with `chrome.tabs.setZoom`), crops of an element, a region and the whole canvas are their CSS boxes × the zoom, to the pixel. Not yet checked in headed Chrome on a Retina display.
- **`activeTab` instead of `<all_urls>`** (Chromium 159, action run through the DevTools protocol's `Extensions.triggerAction`): capture is refused until the user clicks the extension's toolbar icon. After one click it keeps working through story and component switches and a same-origin reload, and stops on a move to another origin. That is one click per review session, since the CLI opens a new tab each time. **Kept `<all_urls>`**: no per-session step, which is a decision driver above, at the cost of Chrome's "read and change all your data on all websites" warning at install. The content script still runs only on Storybook previews on localhost.
- **HTML-in-Canvas** (2026-11-25): `drawElementImage` is available without a flag in Chrome 158, and the canvas attribute is now `content="drawable"`. It only draws descendants of the canvas doing the drawing; for any other element Chrome refuses: "The element can only be drawn into its nearest ancestor `<canvas>`." Using it would mean rendering every story inside a canvas, so it cannot capture the story as it is.
- **OS screenshot from the dev server** (dropped 2026-11-25): the preset would run `screencapture` and locate the canvas with on-screen markers. It needs macOS Screen Recording granted to each app that starts Storybook (terminal, IDE, agent app). Without the grant, `screencapture` fails silently, with no prompt. The grant lets the app record the whole screen, a broader permission than the extension's `<all_urls>`. Dropped before measuring crop accuracy.
- **Firefox** (161, loaded as a temporary add-on through WebDriver BiDi): the same code works once built with a background script instead of a service worker, plus a `gecko` add-on ID. Crops match their CSS boxes to the pixel, and no extra site-permission step was needed for the temporary add-on. The content script can start after the preview's first scripts, so the overlay pings every 250 ms for up to 3 s rather than once.
- **Distribution:** the tag workflow attaches the Chrome zip and a Firefox `.xpi` to each GitHub release. Mozilla signs the `.xpi` as an unlisted add-on (`web-ext sign`), so Firefox keeps it after a restart. 1.0.3 was signed by hand on addons.mozilla.org.
- **Rate limit:** two captures less than a second apart can hit `MAX_CAPTURE_VISIBLE_TAB_CALLS_PER_SECOND`; the service worker retries up to 3 times, 600 ms apart.
- **Paths:** the extension lives in `packages/storybook-review-extension/`, not `apps/web/.storybook/annotate/extension/` as written above. Screenshots go to `<tmp>/storybook-review/<session id>-screenshots/comment-<n>.png`.
