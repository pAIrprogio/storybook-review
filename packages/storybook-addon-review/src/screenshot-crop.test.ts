import { describe, expect, test } from "bun:test";
import { type CaptureGeometry, cropRect } from "./screenshot-crop.value-object";

const AT_2X: CaptureGeometry = {
	frame: { x: 100, y: 60, width: 400, height: 300 },
	topWidth: 800,
	image: { width: 1600, height: 1000 },
};

describe(cropRect, () => {
	test("given a box inside the iframe on a 2x display, when cropping, then it is offset by the iframe and scaled by 2", () => {
		// When
		const rect = cropRect({ x: 40, y: 30, width: 100, height: 50 }, AT_2X);

		// Then
		expect(rect).toEqual({ x: 280, y: 180, width: 200, height: 100 });
	});

	test("given a capture at 1x for a 2x page (headless), when cropping, then the scale comes from the image width", () => {
		// Given
		const geometry = { ...AT_2X, image: { width: 800, height: 500 } };

		// When
		const rect = cropRect({ x: 40, y: 30, width: 100, height: 50 }, geometry);

		// Then
		expect(rect).toEqual({ x: 140, y: 90, width: 100, height: 50 });
	});

	test("given a box partly scrolled out of the iframe, when cropping, then only its visible part is kept", () => {
		// When
		const rect = cropRect({ x: 350, y: -20, width: 100, height: 50 }, AT_2X);

		// Then
		expect(rect).toEqual({ x: 900, y: 120, width: 100, height: 60 });
	});

	test("given a box outside the iframe's viewport, when cropping, then there is nothing to crop", () => {
		// When
		const rect = cropRect({ x: 0, y: 400, width: 100, height: 50 }, AT_2X);

		// Then
		expect(rect).toBeNull();
	});
});
