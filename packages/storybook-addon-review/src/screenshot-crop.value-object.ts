import type { Box } from "./annotation.schema";

/**
 * Where a box of the story canvas sits in a capture of the whole tab.
 * `captureVisibleTab` shoots the top window, so a box in the preview
 * iframe's viewport is moved by the iframe's offset, clipped to what the
 * iframe shows, and scaled to the image's pixels. The scale comes from the
 * image itself (image width / top window width), which covers the device
 * pixel ratio and browser zoom alike.
 */

/** Where the canvas was when the tab was captured, in the top window's CSS px. */
export type CaptureGeometry = {
	/** The preview iframe's content box in the top window's viewport. */
	readonly frame: Box;
	/** The top window's viewport width (`window.top.innerWidth`). */
	readonly topWidth: number;
	/** The captured image's size in pixels. */
	readonly image: { readonly width: number; readonly height: number };
};

/**
 * The image pixels showing `box` (CSS px in the iframe's viewport), or null
 * when nothing of it is visible.
 *
 * @example
 * cropRect(
 *   { x: 40, y: 30, width: 100, height: 50 },
 *   { frame: { x: 100, y: 60, width: 400, height: 300 }, topWidth: 800, image: { width: 1600, height: 1000 } },
 * ); // { x: 280, y: 180, width: 200, height: 100 }
 * cropRect({ x: 500, y: 0, width: 10, height: 10 }, geometry); // null: right of the iframe
 */
export function cropRect(box: Box, geometry: CaptureGeometry): Box | null {
	const { frame, topWidth, image } = geometry;
	if (topWidth <= 0) return null;
	const scale = image.width / topWidth;
	const left = frame.x + Math.max(box.x, 0);
	const top = frame.y + Math.max(box.y, 0);
	const right = frame.x + Math.min(box.x + box.width, frame.width);
	const bottom = frame.y + Math.min(box.y + box.height, frame.height);
	const x = Math.max(0, Math.round(left * scale));
	const y = Math.max(0, Math.round(top * scale));
	const width = Math.min(image.width, Math.round(right * scale)) - x;
	const height = Math.min(image.height, Math.round(bottom * scale)) - y;
	if (width <= 0 || height <= 0) return null;
	return { x, y, width, height };
}
