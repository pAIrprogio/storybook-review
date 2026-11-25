import type { CaptureRequest, CaptureResponse } from "./protocol";

/**
 * Service worker: captures the visible part of the tab a content script
 * asks from, as a PNG data URL. Captures run one at a time and retry
 * (up to 3 tries) when Chrome's limit (2 calls per second) refuses one.
 */

const RETRY_AFTER_MS = 600;
const MAX_ATTEMPTS = 3;
let queue: Promise<unknown> = Promise.resolve();

chrome.runtime.onMessage.addListener(
	(
		message: CaptureRequest,
		sender,
		sendResponse: (response: CaptureResponse) => void,
	) => {
		if (message?.kind !== "capture") return false;
		const task = queue.then(() => capture(sender.tab));
		queue = task.catch(() => undefined);
		task.then(sendResponse, (error: unknown) =>
			sendResponse({
				kind: "failed",
				message: error instanceof Error ? error.message : String(error),
			}),
		);
		return true; // answers asynchronously
	},
);

async function capture(
	tab: chrome.tabs.Tab | undefined,
): Promise<CaptureResponse> {
	if (tab === undefined) {
		return { kind: "failed", message: "the request did not come from a tab" };
	}
	// captureVisibleTab shoots the window's active tab: refuse when that is
	// another tab, rather than capture the wrong page.
	if (!tab.active) {
		return { kind: "failed", message: "the Storybook tab is not the active tab" };
	}
	for (let attempt = 1; ; attempt += 1) {
		try {
			return { kind: "captured", dataUrl: await shoot(tab.windowId) };
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			const isRateLimited = message.includes(
				"MAX_CAPTURE_VISIBLE_TAB_CALLS_PER_SECOND",
			);
			if (!isRateLimited || attempt === MAX_ATTEMPTS) throw error;
			await new Promise((resolve) => setTimeout(resolve, RETRY_AFTER_MS));
		}
	}
}

function shoot(windowId: number): Promise<string> {
	return chrome.tabs.captureVisibleTab(windowId, { format: "png" });
}
