import type {
	Annotation,
	AnnotationTarget,
	ElementDescriptor,
	StoryRef,
} from "./annotation.schema";

/**
 * Pure functions on storybook-review comments, shared by the manager panel
 * and the CLI (`format-result.ts`), so both name a comment the
 * same way.
 */

/** The comments of one story, in the order the user wrote them. */
export type StoryAnnotations = {
	readonly story: StoryRef;
	readonly annotations: readonly Annotation[];
};

/**
 * Group comments by story: stories in the order they were first commented,
 * comments in the order they were written. A comment's 1-based position in
 * its group is its pin number.
 *
 * @example
 * groupByStory([b1, a1, b2]);
 * // [{ story: b, annotations: [b1, b2] }, { story: a, annotations: [a1] }]
 * groupByStory([]); // []
 */
export function groupByStory(
	annotations: readonly Annotation[],
): readonly StoryAnnotations[] {
	const ordered = annotations.toSorted((a, b) => a.createdAt - b.createdAt);
	const storyIds = [
		...new Set(ordered.map((annotation) => annotation.story.id)),
	];
	return storyIds.map((storyId) => {
		const ofStory = ordered.filter(
			(annotation) => annotation.story.id === storyId,
		);
		const [first] = ofStory;
		if (first === undefined) throw new Error(`No comment on story ${storyId}`);
		return { story: first.story, annotations: ofStory };
	});
}

/**
 * The pin number of each comment of `storyId`, by comment ID.
 *
 * @example
 * pinNumbers([a1, b1, a2], "a"); // Map { "a1" => 1, "a2" => 2 }
 * pinNumbers([a1], "missing");   // Map {}
 */
export function pinNumbers(
	annotations: readonly Annotation[],
	storyId: string,
): ReadonlyMap<string, number> {
	const group = groupByStory(annotations).find(
		(item) => item.story.id === storyId,
	);
	return new Map(
		(group?.annotations ?? []).map((annotation, index) => [
			annotation.id,
			index + 1,
		]),
	);
}

/**
 * A short label for what a comment is about.
 *
 * @example
 * targetLabel({ kind: "story" }); // "Whole story"
 * targetLabel({ kind: "element", element: button, viewport }); // '<button> "Fork"'
 * targetLabel({ kind: "region", box, container: section, viewport });
 * // 'Region 200×120 in <section> [frame-header]'
 */
export function targetLabel(target: AnnotationTarget): string {
	switch (target.kind) {
		case "story":
			return "Whole story";
		case "element":
			return elementLabel(target.element);
		case "region":
			return `Region ${target.box.width}×${target.box.height} in ${elementLabel(target.container)}`;
		default: {
			const unhandled: never = target;
			throw new Error(`Unhandled target: ${JSON.stringify(unhandled)}`);
		}
	}
}

/**
 * An element as `<tag>`, then its own test ID and its accessible name or text.
 *
 * @example
 * elementLabel({ tag: "button", testId: { value: "fork", distance: 0 }, role: { value: "button", name: "Fork", distance: 0 }, … });
 * // '<button> [fork] "Fork"'
 * elementLabel({ tag: "div", testId: null, role: null, text: null, … }); // "<div>"
 */
export function elementLabel(element: ElementDescriptor): string {
	const testId =
		element.testId?.distance === 0 ? ` [${element.testId.value}]` : "";
	const ownName = element.role?.distance === 0 ? element.role.name : null;
	const words = ownName ?? element.text;
	const quoted = words === null ? "" : ` "${clip(words, 40)}"`;
	return `<${element.tag}>${testId}${quoted}`;
}

/**
 * `Title › Name` of a story.
 *
 * @example
 * storyLabel({ id: "canvas-framenode--running", title: "canvas/FrameNode", name: "Running", importPath }); // "canvas/FrameNode › Running"
 */
export function storyLabel(story: StoryRef): string {
	return `${story.title} › ${story.name}`;
}

/**
 * The args whose value differs from the story's own, compared as JSON.
 *
 * @example
 * changedArgs({ title: "B", open: true }, { title: "A", open: true }); // { title: "B" }
 * changedArgs(undefined, undefined); // {}
 */
export function changedArgs(
	args: Record<string, unknown> | undefined,
	initialArgs: Record<string, unknown> | undefined,
): Record<string, unknown> {
	const initial = initialArgs ?? {};
	return Object.fromEntries(
		Object.entries(args ?? {}).filter(
			([key, value]) => JSON.stringify(value) !== JSON.stringify(initial[key]),
		),
	);
}

/**
 * The globals worth reporting: string, number and `true` values (an addon's
 * off switch or an object is left out).
 *
 * @example
 * reportedGlobals({ scheme: "dark", outline: false, backgrounds: {} }); // { scheme: "dark" }
 */
export function reportedGlobals(
	globals: Record<string, unknown>,
): Record<string, string | number | boolean> {
	return Object.fromEntries(
		Object.entries(globals).filter(
			(entry): entry is [string, string | number | true] => {
				const value = entry[1];
				return (
					(typeof value === "string" && value !== "") ||
					typeof value === "number" ||
					value === true
				);
			},
		),
	);
}

function clip(text: string, limit: number): string {
	return text.length > limit ? `${text.slice(0, limit - 1)}…` : text;
}
