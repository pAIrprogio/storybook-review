import { STORY_RENDERED } from "storybook/internal/core-events";
import { addons } from "storybook/preview-api";
import {
	REVIEW_EVENTS,
	type Box,
	type CanvasTarget,
	OVERLAY_GLOBAL,
	type Viewport,
} from "./annotation.schema";
import {
	composedParent,
	deepElementFromPoint,
	describeElement,
	findByCssPath,
	pageBoxOf,
	roundBox,
} from "./element-descriptor.value-object";
import { captureBox, isExtensionInstalled } from "./screenshot.adapter";

/**
 * The storybook-review overlay on the story canvas (preview iframe): pick
 * mode (hover outline, click an element, drag a region) and the numbered
 * pins of the current story's comments. The manager owns the comments and
 * sends a `CanvasState`; the overlay sends back what the user picked.
 */

/** How a pin is drawn: a saved comment, the one being written, or the selected one. */
export type PinState = "saved" | "draft" | "focused";

/** One numbered pin on the canvas. */
export type CanvasPin = {
	readonly id: string;
	readonly label: string;
	readonly target: CanvasTarget;
	readonly state: PinState;
};

/** What the manager tells the canvas: pick mode and the current story's pins. */
export type CanvasState = {
	readonly storyId: string | null;
	readonly picking: boolean;
	readonly pins: readonly CanvasPin[];
};

/** Payload of `REVIEW_EVENTS.picked`. `shotId` names its screenshot, if one follows. */
export type PickedPayload = {
	readonly storyId: string;
	readonly target: CanvasTarget;
	readonly shotId: string;
};

const HOST_TAG = "storybook-review-overlay";
const DRAG_THRESHOLD_PX = 5;

type PlacedPin = { readonly element: HTMLElement; readonly box: () => Box };

/**
 * Add the overlay to the preview document once; a second call replaces the
 * first (hot reload). Returns a function that removes it.
 *
 * @example
 * const remove = installCanvasOverlay();
 * remove(); // overlay, listeners and global gone
 */
export function installCanvasOverlay(): () => void {
	const previous = Reflect.get(window, OVERLAY_GLOBAL);
	if (isDisposable(previous)) previous.dispose();

	const channel = addons.getChannel();
	const host = document.createElement(HOST_TAG);
	const shadow = host.attachShadow({ mode: "open" });
	shadow.innerHTML = OVERLAY_HTML;
	document.body.append(host);
	const part = (name: string): HTMLElement => {
		const element = shadow.querySelector<HTMLElement>(`[data-part="${name}"]`);
		if (element === null) throw new Error(`Overlay part ${name} is missing`);
		return element;
	};
	const pinsLayer = part("pins");
	const pickLayer = part("pick");
	const hoverBox = part("hover");
	const hoverLabel = part("hover-label");
	const dragBox = part("drag");

	let state: CanvasState = { storyId: null, picking: false, pins: [] };
	let renderedStoryId: string | null = null;
	let placed: PlacedPin[] = [];
	let frame = 0;
	let dragStart: { x: number; y: number } | null = null;
	let isDragging = false;

	const isOverlay = (element: Element) => element === host;
	const extensionInstalled = isExtensionInstalled();
	let isStatusSent = false;

	// Hide what the overlay draws for the captured frame, so the screenshot
	// shows the story as the user saw it. The transparent pick layer stays,
	// so a click during the capture still picks instead of reaching the story.
	const captureAndSend = async (box: Box, shotId: string) => {
		if (!(await extensionInstalled)) return;
		host.toggleAttribute("data-capturing", true);
		await nextFrames(2);
		const dataUrl = await captureBox(box).catch(() => null);
		host.toggleAttribute("data-capturing", false);
		if (dataUrl !== null) channel.emit(REVIEW_EVENTS.screenshot, { shotId, dataUrl });
	};

	const renderPins = () => {
		const isCurrent =
			state.storyId !== null && state.storyId === renderedStoryId;
		const pins = isCurrent ? state.pins : [];
		placed = pins.map((pin) =>
			placePin(pin, (id) => channel.emit(REVIEW_EVENTS.pinSelected, id)),
		);
		pinsLayer.replaceChildren(...placed.map((item) => item.element));
		cancelAnimationFrame(frame);
		if (placed.length > 0) frame = requestAnimationFrame(tick);
	};

	const tick = () => {
		for (const item of placed) positionAt(item.element, item.box());
		frame = requestAnimationFrame(tick);
	};

	const endDrag = () => {
		dragBox.hidden = true;
		dragStart = null;
		isDragging = false;
	};

	const setPicking = (picking: boolean) => {
		pickLayer.hidden = !picking;
		if (!picking) {
			hoverBox.hidden = true;
			endDrag();
		}
	};

	const onCanvasState = (next: CanvasState) => {
		state = next;
		setPicking(next.picking);
		renderPins();
		// The manager listens once it sends a state: tell it about the extension.
		if (!isStatusSent) {
			isStatusSent = true;
			extensionInstalled.then((installed) =>
				channel.emit(REVIEW_EVENTS.extensionStatus, installed),
			);
		}
	};

	const onCaptureStory = (shotId: unknown) => {
		if (typeof shotId !== "string") return;
		const viewport = { x: 0, y: 0, width: window.innerWidth, height: window.innerHeight };
		void captureAndSend(viewport, shotId);
	};

	const onStoryRendered = (storyId: string) => {
		renderedStoryId = storyId;
		renderPins();
	};

	const emitPicked = (target: CanvasTarget, visibleBox: Box) => {
		if (renderedStoryId === null) return;
		const shotId = crypto.randomUUID();
		const payload: PickedPayload = { storyId: renderedStoryId, target, shotId };
		channel.emit(REVIEW_EVENTS.picked, payload);
		void captureAndSend(visibleBox, shotId);
	};

	const onPointerMove = (event: PointerEvent) => {
		if (dragStart !== null) {
			const distance = Math.hypot(
				event.clientX - dragStart.x,
				event.clientY - dragStart.y,
			);
			isDragging = isDragging || distance > DRAG_THRESHOLD_PX;
		}
		if (isDragging && dragStart !== null) {
			hoverBox.hidden = true;
			dragBox.hidden = false;
			positionAt(dragBox, rectBetween(dragStart, event));
			return;
		}
		const element = deepElementFromPoint(
			event.clientX,
			event.clientY,
			isOverlay,
		);
		hoverBox.hidden = element === null;
		if (element === null) return;
		const rect = element.getBoundingClientRect();
		positionAt(hoverBox, {
			x: rect.left,
			y: rect.top,
			width: rect.width,
			height: rect.height,
		});
		hoverLabel.textContent = hoverLabelOf(element);
		// Near the top edge the label goes inside the outline, where it shows.
		hoverBox.toggleAttribute("data-label-inside", rect.top < 20);
	};

	const onPointerDown = (event: PointerEvent) => {
		event.preventDefault();
		pickLayer.setPointerCapture(event.pointerId);
		dragStart = { x: event.clientX, y: event.clientY };
		isDragging = false;
	};

	const onPointerUp = (event: PointerEvent) => {
		if (dragStart === null) return;
		const start = dragStart;
		const wasDragging = isDragging;
		// Picking stays on after a pick, until the user turns it off.
		endDrag();
		if (wasDragging) {
			const rect = rectBetween(start, event);
			emitPicked(regionTarget(rect, isOverlay), rect);
			return;
		}
		const element = deepElementFromPoint(
			event.clientX,
			event.clientY,
			isOverlay,
		);
		if (element === null) return;
		const rect = element.getBoundingClientRect();
		emitPicked(
			{
				kind: "element",
				element: describeElement(element),
				viewport: viewportNow(),
			},
			{ x: rect.left, y: rect.top, width: rect.width, height: rect.height },
		);
	};

	const onKeyDown = (event: KeyboardEvent) => {
		// The manager runs the pick shortcut (`manager.tsx`); here it only
		// stops the browser's own ⌘⇧C, DevTools' inspect element.
		if (isPickShortcut(event)) {
			event.preventDefault();
			return;
		}
		if (event.key !== "Escape" || pickLayer.hidden) return;
		event.preventDefault();
		setPicking(false);
		channel.emit(REVIEW_EVENTS.pickCancelled);
	};

	pickLayer.addEventListener("pointermove", onPointerMove);
	pickLayer.addEventListener("pointerdown", onPointerDown);
	pickLayer.addEventListener("pointerup", onPointerUp);
	window.addEventListener("keydown", onKeyDown, true);
	channel.on(REVIEW_EVENTS.canvasState, onCanvasState);
	channel.on(REVIEW_EVENTS.captureStory, onCaptureStory);
	channel.on(STORY_RENDERED, onStoryRendered);

	const dispose = () => {
		cancelAnimationFrame(frame);
		window.removeEventListener("keydown", onKeyDown, true);
		channel.off(REVIEW_EVENTS.canvasState, onCanvasState);
		channel.off(REVIEW_EVENTS.captureStory, onCaptureStory);
		channel.off(STORY_RENDERED, onStoryRendered);
		host.remove();
		Reflect.deleteProperty(window, OVERLAY_GLOBAL);
	};
	Reflect.set(window, OVERLAY_GLOBAL, { dispose });
	return dispose;
}

function isDisposable(value: unknown): value is { dispose: () => void } {
	return (
		typeof value === "object" &&
		value !== null &&
		"dispose" in value &&
		typeof value.dispose === "function"
	);
}

function placePin(pin: CanvasPin, onSelect: (id: string) => void): PlacedPin {
	const element = document.createElement("div");
	element.className = `pin ${pin.state} ${pin.target.kind}`;
	const badge = document.createElement("button");
	badge.type = "button";
	badge.className = "badge";
	badge.textContent = pin.label;
	badge.title = "Show this comment";
	badge.addEventListener("click", () => onSelect(pin.id));
	element.append(badge);
	const box = pinBox(pin.target);
	positionAt(element, box());
	return { element, box };
}

function pinBox(target: CanvasTarget): () => Box {
	if (target.kind === "region") return () => target.box;
	return () => {
		const live = findByCssPath(target.element.cssPath);
		return live === null ? target.element.box : pageBoxOf(live);
	};
}

function regionTarget(
	rect: Box,
	isOverlay: (element: Element) => boolean,
): CanvasTarget {
	const box = roundBox({
		...rect,
		x: rect.x + window.scrollX,
		y: rect.y + window.scrollY,
	});
	const center = deepElementFromPoint(
		rect.x + rect.width / 2,
		rect.y + rect.height / 2,
		isOverlay,
	);
	let container: Element = center ?? document.body;
	while (!containsBox(pageBoxOf(container), box)) {
		const parent = composedParent(container);
		if (parent === null) break;
		container = parent;
	}
	return {
		kind: "region",
		box,
		container: describeElement(container),
		viewport: viewportNow(),
	};
}

function containsBox(outer: Box, inner: Box): boolean {
	return (
		outer.x <= inner.x &&
		outer.y <= inner.y &&
		outer.x + outer.width >= inner.x + inner.width &&
		outer.y + outer.height >= inner.y + inner.height
	);
}

function rectBetween(start: { x: number; y: number }, end: PointerEvent): Box {
	return {
		x: Math.min(start.x, end.clientX),
		y: Math.min(start.y, end.clientY),
		width: Math.abs(end.clientX - start.x),
		height: Math.abs(end.clientY - start.y),
	};
}

function viewportNow(): Viewport {
	return { width: window.innerWidth, height: window.innerHeight };
}

function hoverLabelOf(element: Element): string {
	const testId = element.getAttribute("data-testid");
	return testId === null
		? element.localName
		: `${element.localName} [${testId}]`;
}

function nextFrames(count: number): Promise<void> {
	return new Promise((resolve) => {
		const step = (left: number) =>
			left === 0 ? resolve() : requestAnimationFrame(() => step(left - 1));
		step(count);
	});
}

function positionAt(element: HTMLElement, box: Box): void {
	element.style.translate = `${box.x}px ${box.y}px`;
	element.style.width = `${box.width}px`;
	element.style.height = `${box.height}px`;
}

// The overlay is a shadow tree, so the story's styles never reach it. It
// defines its own tokens on :host (the accent is Storybook's secondary
// colour, as on the panel's pins) and follows the OS colour scheme.
const OVERLAY_HTML = `
<style>
	:host {
		position: absolute; inset: 0 auto auto 0; width: 0; height: 0; z-index: 2147483647;
		--ab-color-accent: #029cfd; --ab-color-accent-fg: #fff; --ab-color-accent-subtle: rgb(2 156 253 / 0.35); --ab-color-focus: #0071c2;
		--ab-color-fg: #2e3438; --ab-color-border: hsl(212 50% 30% / 0.15); --ab-color-surface-raised: #fff;
		--ab-shadow-overlay: 0 2px 6px rgb(0 0 0 / 0.18);
		--ab-border-width: 1px; --ab-border-width-strong: 2px;
		--ab-radius-1: 3px; --ab-radius-2: 4px; --ab-radius-full: 999px;
		--ab-space-1: 4px; --ab-space-2: 8px; --ab-space-3: 10px; --ab-space-5: 20px;
		--ab-text-xs: 12px; --ab-font-weight-medium: 500; --ab-font-weight-semibold: 700;
		--ab-font-sans: "Nunito Sans", -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif;
		--ab-font-mono: ui-monospace, Menlo, Monaco, "Courier New", monospace;
	}
	@media (prefers-color-scheme: dark) {
		:host { --ab-color-fg: #c9cdcf; --ab-color-border: hsl(0 0% 100% / 0.1); --ab-color-surface-raised: #222425; --ab-color-focus: #7cc4fa; }
	}
	[hidden] { display: none !important; }
	:host([data-capturing]) :is(.pins, .banner, .hover, .drag) { visibility: hidden; }
	.pins { position: absolute; inset: 0 auto auto 0; }
	.pin, .hover, .drag { position: absolute; inset: 0 auto auto 0; box-sizing: border-box; pointer-events: none; border-radius: var(--ab-radius-2); }
	.pin { outline: var(--ab-border-width) dashed var(--ab-color-accent); outline-offset: 1px; }
	.pin.focused, .pin.draft { outline-style: solid; outline-width: var(--ab-border-width-strong); background: color-mix(in srgb, var(--ab-color-accent-subtle) 40%, transparent); }
	.badge {
		position: absolute; inset: calc(-1 * var(--ab-space-3)) auto auto calc(-1 * var(--ab-space-3));
		min-width: var(--ab-space-5); height: var(--ab-space-5); padding: 0 var(--ab-space-1);
		border: 0; border-radius: var(--ab-radius-full); pointer-events: auto; cursor: pointer;
		background: var(--ab-color-accent); color: var(--ab-color-accent-fg); box-shadow: var(--ab-shadow-overlay);
		font: var(--ab-font-weight-semibold) var(--ab-text-xs) / 1 var(--ab-font-sans);
	}
	.badge:focus-visible { outline: var(--ab-border-width-strong) solid var(--ab-color-focus); outline-offset: 2px; }
	.pick { position: fixed; inset: 0; cursor: crosshair; background: transparent; touch-action: none; }
	.hover, .drag { position: fixed; }
	.hover { outline: var(--ab-border-width-strong) solid var(--ab-color-accent); background: color-mix(in srgb, var(--ab-color-accent-subtle) 30%, transparent); }
	.drag { outline: var(--ab-border-width-strong) dashed var(--ab-color-accent); background: color-mix(in srgb, var(--ab-color-accent-subtle) 40%, transparent); }
	.hover-label {
		position: absolute; inset: auto auto 100% 0; margin-bottom: var(--ab-space-1); padding: 0 var(--ab-space-1);
		border-radius: var(--ab-radius-1); white-space: nowrap;
		background: var(--ab-color-accent); color: var(--ab-color-accent-fg);
		font: var(--ab-font-weight-medium) var(--ab-text-xs) / 1.5 var(--ab-font-mono);
	}
	.hover[data-label-inside] .hover-label { inset: 0 auto auto 0; margin: 0; }
	.banner {
		position: fixed; inset: var(--ab-space-2) 50% auto auto; translate: 50% 0; pointer-events: none;
		padding: var(--ab-space-1) var(--ab-space-3); border-radius: var(--ab-radius-full);
		border: var(--ab-border-width) solid var(--ab-color-border);
		background: var(--ab-color-surface-raised); color: var(--ab-color-fg); box-shadow: var(--ab-shadow-overlay);
		font: var(--ab-font-weight-medium) var(--ab-text-xs) / 1.5 var(--ab-font-sans);
	}
</style>
<div class="pins" data-part="pins"></div>
<div class="pick" data-part="pick" hidden>
	<div class="banner">Click an element or drag a region to comment · Esc to cancel</div>
	<div class="hover" data-part="hover" hidden><span class="hover-label" data-part="hover-label"></span></div>
	<div class="drag" data-part="drag" hidden></div>
</div>
`;

/** ⌘⇧C on macOS, Ctrl+Shift+C elsewhere: the manager's `PICK_SHORTCUT`. */
function isPickShortcut(event: KeyboardEvent): boolean {
	const isMac = /Mac|iPhone|iPad/.test(navigator.platform);
	const primary = isMac ? event.metaKey : event.ctrlKey;
	return primary && event.shiftKey && !event.altKey && event.code === "KeyC";
}
