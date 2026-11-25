import { readFileSync } from "node:fs";
import { defineConfig } from "vite";
import webExtension from "vite-plugin-web-extension";

/**
 * Builds the extension for one browser, `TARGET=chrome` (default) or
 * `TARGET=firefox`, into `dist/<target>/`. Chrome loads it unpacked
 * (chrome://extensions → Developer mode → Load unpacked); Firefox as a
 * temporary add-on (about:debugging → This Firefox → Load Temporary Add-on).
 *
 * @example
 * TARGET=firefox vite build   // dist/firefox/manifest.json, src/background.js, src/content.js
 */

const TARGETS = ["chrome", "firefox"] as const;
type Target = (typeof TARGETS)[number];

const target = (process.env.TARGET ?? "chrome") as Target;
if (!TARGETS.includes(target)) {
	throw new Error(`TARGET must be one of ${TARGETS.join(", ")}, got "${target}"`);
}

// The preview iframe Storybook serves; the content script runs nowhere else.
const STORYBOOK_PREVIEWS = [
	"http://localhost/iframe.html*",
	"http://127.0.0.1/iframe.html*",
];

const { version } = JSON.parse(readFileSync("package.json", "utf8")) as {
	version: string;
};

export default defineConfig({
	// Not minified: the code is tiny, and Mozilla reviews readable code
	// without asking for the sources.
	build: { outDir: `dist/${target}`, emptyOutDir: true, minify: false },
	plugins: [
		webExtension({
			browser: target,
			disableAutoLaunch: true,
			skipManifestValidation: true,
			watchFilePaths: ["package.json"],
			manifest: () => ({
				manifest_version: 3,
				name: "Storybook Review screenshots",
				description:
					"Lets the storybook-review addon screenshot the story you comment on, as you see it.",
				version,
				// Firefox runs MV3 background scripts as an event page, not a service worker.
				"{{chrome}}.background": { service_worker: "src/background.ts" },
				"{{firefox}}.background": { scripts: ["src/background.ts"] },
				"{{chrome}}.minimum_chrome_version": "116",
				"{{firefox}}.browser_specific_settings": {
					gecko: {
						id: "storybook-review-extension@pairprog.io",
						// 142: the first version with data_collection_permissions on desktop (140) and Android (142).
						strict_min_version: "142.0",
						// Screenshots only go to the Storybook dev server on localhost.
						data_collection_permissions: { required: ["none"] },
					},
				},
				content_scripts: [
					{
						matches: STORYBOOK_PREVIEWS,
						js: ["src/content.ts"],
						all_frames: true,
						run_at: "document_start",
					},
				],
				// captureVisibleTab needs <all_urls> or activeTab; localhost host
				// permissions are not enough (tested in Chromium, 2026-11-25), and
				// activeTab would need a click on the extension every session.
				host_permissions: ["<all_urls>"],
			}),
		}),
	],
});
