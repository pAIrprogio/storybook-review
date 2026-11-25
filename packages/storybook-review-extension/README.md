# Storybook Review screenshots

A small browser extension for Chrome and Firefox that works with [`@pairprog/storybook-addon-review`](../storybook-addon-review). With it, each comment you add in a review session carries a screenshot of what you saw: the picked element, the dragged region, or the visible canvas for a whole-story comment. The screenshot keeps the state the story was in when you commented, such as an open menu or text you typed. Without it, comments still go to the agent, but without screenshots.

## Install

Download the file for your browser from the [latest release](https://github.com/pAIrprogio/storybook-review/releases/latest): `storybook-review-extension-chrome-<version>.zip` or `storybook-review-extension-firefox-<version>.xpi`.

**Chrome** (and other Chromium browsers):

1. Unzip it into a folder you keep. Chrome loads the extension from that folder each time it starts.
2. Open `chrome://extensions` and turn on **Developer mode** (top right).
3. Click **Load unpacked** and pick the unzipped folder.

**Firefox:** open the `.xpi` in Firefox (drag it onto a window, or File → Open File) and confirm the install. Mozilla signs it, so it stays installed after a restart.

Once it is loaded, the Review panel stops showing "Comments go without screenshots" in the next review session.

## What it can do

- **Runs on:** only Storybook preview frames on `http://localhost/iframe.html*` and `http://127.0.0.1/iframe.html*`, on any port.
- **Captures:** only when the review overlay asks, and only the active tab.
- **Permission:** it asks for access to all websites (`<all_urls>`). Chrome shows this as "read and change all your data on all websites". The browser's capture call needs either that or `activeTab`, and `activeTab` would mean clicking the extension in every session. `localhost` site permissions alone are refused (tested 2026-11-25).

## Develop

```bash
bun run build            # dist/chrome and dist/firefox
bun run build:firefox    # one target
bun run dev              # rebuilds dist/chrome on save; reload the extension in chrome://extensions
```

Built with [vite-plugin-web-extension](https://vite-plugin-web-extension.aklinker1.io/); the manifest for both browsers lives in `vite.config.ts`. Chrome gets a background service worker; Firefox gets a background script, plus an add-on ID. The page ↔ extension messages are in `src/protocol.ts`, and the addon keeps a copy of them in `storybook-addon-review/src/screenshot.adapter.ts`.

The extension's version follows the repo's release version. The tag workflow (`.github/workflows/publish.yml`) checks that it matches, has addons.mozilla.org sign the Firefox build (unlisted, with the `AMO_JWT_ISSUER` and `AMO_JWT_SECRET` repo secrets), then attaches the Chrome zip and the signed `.xpi` to the GitHub release. A version can be signed only once, so every release tag needs a new version.
