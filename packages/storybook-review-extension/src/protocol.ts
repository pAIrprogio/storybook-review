/**
 * The messages between a Storybook preview page and the extension's content
 * script, over `window.postMessage` in the preview iframe. The addon keeps a
 * copy of these shapes in `storybook-addon-review/src/screenshot.adapter.ts`;
 * change both together.
 *
 * @example
 * // page → extension
 * { channel: SCREENSHOT_CHANNEL, from: "page", kind: "capture", requestId: "r1" }
 * // extension → page
 * { channel: SCREENSHOT_CHANNEL, from: "extension", kind: "captured", requestId: "r1", dataUrl: "data:image/png;base64,…" }
 */

/** Tags every message of this protocol on the shared `message` event. */
export const SCREENSHOT_CHANNEL = "storybook-review/screenshot";

/** What the page asks: is the extension there, or a capture of the visible tab. */
export type PageMessage = {
	readonly channel: typeof SCREENSHOT_CHANNEL;
	readonly from: "page";
	readonly kind: "ping" | "capture";
	readonly requestId: string;
};

/** What the extension answers. */
export type ExtensionMessage = {
	readonly channel: typeof SCREENSHOT_CHANNEL;
	readonly from: "extension";
	readonly requestId: string;
} & (
	| { readonly kind: "pong"; readonly version: string }
	| { readonly kind: "captured"; readonly dataUrl: string }
	| { readonly kind: "failed"; readonly message: string }
);

/** Content script → service worker. */
export type CaptureRequest = { readonly kind: "capture" };

/** Service worker → content script. */
export type CaptureResponse =
	| { readonly kind: "captured"; readonly dataUrl: string }
	| { readonly kind: "failed"; readonly message: string };

/**
 * Whether `data` is a message the page sent on this protocol.
 *
 * @example
 * isPageMessage({ channel: SCREENSHOT_CHANNEL, from: "page", kind: "ping", requestId: "r1" }); // true
 * isPageMessage({ type: "webpackOk" }); // false
 */
export function isPageMessage(data: unknown): data is PageMessage {
	if (typeof data !== "object" || data === null) return false;
	const message = data as Record<string, unknown>;
	return (
		message.channel === SCREENSHOT_CHANNEL &&
		message.from === "page" &&
		(message.kind === "ping" || message.kind === "capture") &&
		typeof message.requestId === "string"
	);
}
