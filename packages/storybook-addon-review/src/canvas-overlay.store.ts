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

/** Payload of `REVIEW_EVENTS.picked`. */
export type PickedPayload = {
	readonly storyId: string;
	readonly target: CanvasTarget;
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
	};

	const onStoryRendered = (storyId: string) => {
		renderedStoryId = storyId;
		renderPins();
	};

	const emitPicked = (target: CanvasTarget) => {
		if (renderedStoryId === null) return;
		const payload: PickedPayload = { storyId: renderedStoryId, target };
		channel.emit(REVIEW_EVENTS.picked, payload);
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
			emitPicked(regionTarget(rectBetween(start, event), isOverlay));
			return;
		}
		const element = deepElementFromPoint(
			event.clientX,
			event.clientY,
			isOverlay,
		);
		if (element === null) return;
		emitPicked({
			kind: "element",
			element: describeElement(element),
			viewport: viewportNow(),
		});
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
	channel.on(STORY_RENDERED, onStoryRendered);

	const dispose = () => {
		cancelAnimationFrame(frame);
		window.removeEventListener("keydown", onKeyDown, true);
		channel.off(REVIEW_EVENTS.canvasState, onCanvasState);
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

function positionAt(element: HTMLElement, box: Box): void {
	element.style.translate = `${box.x}px ${box.y}px`;
	element.style.width = `${box.width}px`;
	element.style.height = `${box.height}px`;
}

// The overlay is a shadow tree, so the story's styles never reach it. It
// uses the design system's tokens, which inherit through the shadow
// boundary and follow the story's colour scheme.
const OVERLAY_HTML = `
<style>
	:host { position: absolute; inset: 0 auto auto 0; width: 0; height: 0; z-index: 2147483647; }
	[hidden] { display: none !important; }
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
