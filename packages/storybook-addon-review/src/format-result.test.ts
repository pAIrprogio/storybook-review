import { describe, expect, test } from "bun:test";
import type { Annotation } from "./annotation.schema";
import { commentNumbers, formatResult } from "./format-result";

const FRAME_NODE = {
	id: "canvas-framenode--nested",
	title: "canvas/FrameNode",
	name: "Nested",
	importPath: "./src/canvas/frame-node.component.stories.tsx",
};

const NOTICE = {
	id: "app-startupnotice--connecting",
	title: "app/StartupNotice",
	name: "Connecting",
	importPath: "./src/app/startup-notice.component.stories.tsx",
};

const BUTTON = {
	cssPath: "#storybook-root > div > button:nth-of-type(2)",
	tag: "button",
	testId: { value: "frame-header", distance: 1 },
	role: { value: "button", name: "Fork", distance: 0 },
	text: "Fork",
	box: { x: 120, y: 40, width: 80, height: 24 },
};

function annotation(overrides: Partial<Annotation>): Annotation {
	return {
		id: "c1",
		story: NOTICE,
		target: { kind: "story" },
		text: "Add a retry button.",
		args: {},
		globals: { scheme: "light" },
		screenshotId: null,
		createdAt: 1,
		...overrides,
	};
}

describe(formatResult, () => {
	test("given comments on two stories, when formatting, then they are numbered in one sequence, grouped by story, with what each element comment points at and its screenshot", () => {
		// Given
		const annotations = [
			annotation({ id: "story", createdAt: 1 }),
			annotation({
				id: "element",
				story: FRAME_NODE,
				target: {
					kind: "element",
					element: BUTTON,
					viewport: { width: 1024, height: 640 },
				},
				text: "Rename to Branch.",
				globals: { scheme: "dark" },
				args: { title: "Plugin" },
				createdAt: 2,
			}),
		];

		// When
		const output = formatResult(
			{ kind: "sent", annotations, general: "Looks good overall." },
			"apps/web",
		);

		// Then
		expect(output).toBe(
			[
				"ANNOTATIONS for Storybook stories (apps/web)",
				'2 comment(s) on 2 story(ies). Boxes are CSS px in the story canvas (page coordinates, scroll included). A CSS path starts at #storybook-root (or body); " >> " enters the shadow root of the element before it.',
				"",
				"## app/StartupNotice › Connecting",
				"Story ID: app-startupnotice--connecting · File: apps/web/src/app/startup-notice.component.stories.tsx",
				"",
				"### 1. Whole story",
				"Globals: scheme=light",
				"Comment: Add a retry button.",
				"",
				"## canvas/FrameNode › Nested",
				"Story ID: canvas-framenode--nested · File: apps/web/src/canvas/frame-node.component.stories.tsx",
				"",
				'### 2. Element <button> "Fork" (pin 1)',
				"CSS path: #storybook-root > div > button:nth-of-type(2)",
				"Test ID: frame-header (on an ancestor, 1 level up)",
				'Role: button "Fork"',
				'Text: "Fork"',
				"Box: 80×24 at (120, 40) in a 1024×640 canvas",
				"Globals: scheme=dark",
				'Args changed from the story: {"title":"Plugin"}',
				"Comment: Rename to Branch.",
				"",
				"### General comment",
				"Looks good overall.",
				"",
			].join("\n"),
		);
	});

	test("given no comment and no general comment, when formatting, then the user approved", () => {
		// When
		const output = formatResult(
			{ kind: "sent", annotations: [], general: "  " },
			"apps/web",
		);

		// Then
		expect(output).toBe(
			"ANNOTATIONS for Storybook stories (apps/web)\nThe user reviewed the stories and approved them with no comments.\n",
		);
	});

	test("given a region, when formatting, then the region names its container", () => {
		// Given
		const region = annotation({
			id: "region",
			target: {
				kind: "region",
				box: { x: 10, y: 20, width: 200, height: 120 },
				container: { ...BUTTON, tag: "section", role: null, testId: null },
				viewport: { width: 800, height: 600 },
			},
		});

		// When
		const output = formatResult(
			{ kind: "sent", annotations: [region], general: "" },
			".",
		);

		// Then
		expect(output).toContain(
			[
				"### 1. Region 200×120 at (10, 20) (pin 1)",
				"Canvas: 800×600",
				'Inside: <section> "Fork"',
				"Container CSS path: #storybook-root > div > button:nth-of-type(2)",
				'Container Text: "Fork"',
				"Globals: scheme=light",
			].join("\n"),
		);
	});

	test("given a comment with a saved screenshot, when formatting, then its path follows the target", () => {
		// Given
		const shot = annotation({ id: "shot", screenshotId: "s-123456789" });

		// When
		const output = formatResult(
			{ kind: "sent", annotations: [shot], general: "" },
			".",
			new Map([["shot", "/tmp/storybook-review/a1-screenshots/comment-1.png"]]),
		);

		// Then
		expect(output).toContain(
			[
				"### 1. Whole story",
				"Screenshot: /tmp/storybook-review/a1-screenshots/comment-1.png (what the user saw when commenting)",
				"Globals: scheme=light",
			].join("\n"),
		);
	});

	test("given comments on two stories in mixed order, when numbering, then they follow the story groups", () => {
		// Given
		const annotations = [
			annotation({ id: "a1", story: NOTICE }),
			annotation({ id: "b1", story: FRAME_NODE }),
			annotation({ id: "a2", story: NOTICE }),
		];

		// When
		const numbers = commentNumbers(annotations);

		// Then
		expect([...numbers]).toEqual([
			["a1", 1],
			["a2", 2],
			["b1", 3],
		]);
	});

	test("given a cancelled session, when formatting, then the output starts with CANCELLED", () => {
		// When
		const output = formatResult({ kind: "cancelled" }, ".");

		// Then
		expect(output).toBe(
			"CANCELLED: the user discarded the Storybook annotation session without sending comments.\n",
		);
	});
});
