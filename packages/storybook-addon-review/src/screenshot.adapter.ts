import type { Box } from "./annotation.schema";
import { cropRect } from "./screenshot-crop.value-object";

/**
 * The preview iframe's side of the Storybook Review extension
 * (`packages/storybook-review-extension`): ask whether it is installed, and
 * have it capture the visible tab. The message shapes copy the extension's
 * `src/protocol.ts`; change both together.
 */

const SCREENSHOT_CHANNEL = "storybook-review/screenshot";
// Firefox can start the content script after the preview's first scripts
// run, so the first pings can go unheard: ask again until this long.
const PING_EVERY_MS = 250;
const PING_FOR_MS = 3_000;
const CAPTURE_TIMEOUT_MS = 5_000;

type ExtensionReply =
	| { readonly kind: "pong"; readonly version: string }
	| { readonly kind: "captured"; readonly dataUrl: string }
	| { readonly kind: "failed"; readonly message: string };

/**
 * Whether the extension answers in this frame, pinging every 250 ms for up
 * to 3 s.
 *
 * @example
 * await isExtensionInstalled(); // true once the extension is loaded in Chrome or Firefox
 */
export async function isExtensionInstalled(): Promise<boolean> {
	for (let waited = 0; waited < PING_FOR_MS; waited += PING_EVERY_MS) {
		const reply = await ask("ping", PING_EVERY_MS);
		if (reply?.kind === "pong") return true;
	}
	return false;
}

/**
 * A PNG data URL of `box` (CSS px in this frame's viewport) as the user sees
 * it, or null without the extension, when the capture fails, or when the
 * box is off screen.
 *
 * @example
 * await captureBox(element.getBoundingClientRect()); // "data:image/png;base64,…"
 */
export async function captureBox(box: Box): Promise<string | null> {
	const frame = window.frameElement;
	const top = window.top;
	if (frame === null || top === null) return null;
	const reply = await ask("capture", CAPTURE_TIMEOUT_MS);
	if (reply?.kind !== "captured") return null;
	const image = await loadImage(reply.dataUrl);
	const frameRect = frame.getBoundingClientRect();
	const rect = cropRect(box, {
		// The iframe's content box: its border is not part of the canvas.
		frame: {
			x: frameRect.left + frame.clientLeft,
			y: frameRect.top + frame.clientTop,
			width: window.innerWidth,
			height: window.innerHeight,
		},
		topWidth: top.innerWidth,
		image: { width: image.naturalWidth, height: image.naturalHeight },
	});
	if (rect === null) return null;
	const canvas = document.createElement("canvas");
	canvas.width = rect.width;
	canvas.height = rect.height;
	const context = canvas.getContext("2d");
	if (context === null) return null;
	context.drawImage(
		image,
		rect.x,
		rect.y,
		rect.width,
		rect.height,
		0,
		0,
		rect.width,
		rect.height,
	);
	return canvas.toDataURL("image/png");
}

function ask(
	kind: "ping" | "capture",
	timeoutMs: number,
): Promise<ExtensionReply | null> {
	const requestId = crypto.randomUUID();
	return new Promise((resolve) => {
		const timer = setTimeout(() => finish(null), timeoutMs);
		function finish(reply: ExtensionReply | null) {
			clearTimeout(timer);
			window.removeEventListener("message", onMessage);
			resolve(reply);
		}
		function onMessage(event: MessageEvent) {
			if (event.source !== window) return;
			const data: unknown = event.data;
			if (typeof data !== "object" || data === null) return;
			const message = data as Record<string, unknown>;
			const isReply =
				message.channel === SCREENSHOT_CHANNEL &&
				message.from === "extension" &&
				message.requestId === requestId;
			if (isReply) finish(data as ExtensionReply);
		}
		window.addEventListener("message", onMessage);
		window.postMessage(
			{ channel: SCREENSHOT_CHANNEL, from: "page", kind, requestId },
			window.location.origin,
		);
	});
}

function loadImage(src: string): Promise<HTMLImageElement> {
	return new Promise((resolve, reject) => {
		const image = new Image();
		image.onload = () => resolve(image);
		image.onerror = () => reject(new Error("The capture is not an image"));
		image.src = src;
	});
}
