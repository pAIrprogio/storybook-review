import {
	type CaptureRequest,
	type CaptureResponse,
	type ExtensionMessage,
	isPageMessage,
	SCREENSHOT_CHANNEL,
} from "./protocol";

/**
 * Content script, in every Storybook preview iframe on localhost: relays the
 * page's ping and capture requests to the service worker and posts the
 * answers back. Only messages from this same window are answered.
 */

window.addEventListener("message", (event) => {
	if (event.source !== window || event.origin !== window.location.origin) return;
	if (!isPageMessage(event.data)) return;
	const { requestId } = event.data;
	if (event.data.kind === "ping") {
		reply({
			channel: SCREENSHOT_CHANNEL,
			from: "extension",
			requestId,
			kind: "pong",
			version: chrome.runtime.getManifest().version,
		});
		return;
	}
	const request: CaptureRequest = { kind: "capture" };
	chrome.runtime
		.sendMessage<CaptureRequest, CaptureResponse>(request)
		.then((response) =>
			reply({ channel: SCREENSHOT_CHANNEL, from: "extension", requestId, ...response }),
		)
		.catch((error: unknown) =>
			reply({
				channel: SCREENSHOT_CHANNEL,
				from: "extension",
				requestId,
				kind: "failed",
				message: error instanceof Error ? error.message : String(error),
			}),
		);
});

function reply(message: ExtensionMessage): void {
	window.postMessage(message, window.location.origin);
}
