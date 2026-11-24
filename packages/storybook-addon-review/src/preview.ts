import { installCanvasOverlay } from "./canvas-overlay.store";

/**
 * Preview annotations of the storybook-review addon: put the pick and pin
 * overlay on the story canvas once, before the first story renders.
 *
 * @example
 * beforeAll(); // the canvas gets <storybook-review-overlay> and window.__storybookReview
 */
export const beforeAll = (): void => {
	installCanvasOverlay();
};
