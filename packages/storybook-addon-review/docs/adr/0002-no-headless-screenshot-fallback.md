---
status: accepted
date: 2026-11-24
deciders: project owner
supersedes: the headless fallback in 0001
---

# No headless screenshot fallback

**Accepted 2026-11-24.** **The CLI no longer takes screenshots with Playwright.** Until the browser extension of [ADR 0001](./0001-screenshots-from-a-browser-extension.md) ships, comments arrive without a screenshot. Each element or region comment still carries its CSS path, test ID, role and accessible name, text and box. Once the extension ships, it is the only source of screenshots: without it, comments arrive without one. This replaces 0001's fallback to "today's headless capture after Send".

**Related**
- Decisions: [ADR 0001](./0001-screenshots-from-a-browser-extension.md) (screenshots from a browser extension)
- Code: [cli.ts](../../src/cli.ts), [format-result.ts](../../src/format-result.ts), [canvas-overlay.store.ts](../../src/canvas-overlay.store.ts)

## Context

- The fallback opened each commented story in headless Chromium after Send. It needed Playwright and a downloaded Chromium in every project that installs the addon.
- 0001 already records why those screenshots were often wrong: a fresh render loses the state the user reached, and an element inside a closed `<details>` timed out.
- The addon left AI Board to be published on npm for any Storybook project.

## Decision

- Playwright is not a dependency of the package, not even an optional one.
- The CLI output has no `Screenshot:` line.
- The canvas overlay's global keeps only `dispose`; the `find(cssPath)` hook existed only for the headless capture.

## Consequences

- Installing the addon downloads no browser.
- Until the extension ships, the agent works from the element description alone.
- The extension's capture is the next piece of work on screenshots.
