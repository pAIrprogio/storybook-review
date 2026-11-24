import { join, normalize } from "node:path";
import type {
	Annotation,
	AnnotationResult,
	ElementDescriptor,
} from "./annotation.schema";
import {
	elementLabel,
	groupByStory,
	storyLabel,
} from "./annotation.value-object";

/**
 * The text the CLI prints for the agent, in the review contract:
 * `ANNOTATIONS` with numbered comments grouped by story, the approval line,
 * or `CANCELLED`. `projectDir` is the Storybook project folder relative to
 * where the CLI runs; stories file paths are printed relative to the same
 * place.
 *
 * @example
 * formatResult({ kind: "cancelled" }, ".");
 * // "CANCELLED: the user discarded the Storybook annotation session without sending comments.\n"
 * formatResult({ kind: "sent", annotations: [], general: "" }, "apps/web");
 * // "ANNOTATIONS for Storybook stories (apps/web)\nThe user reviewed the stories and approved them with no comments.\n"
 */
export function formatResult(
	result: AnnotationResult,
	projectDir: string,
): string {
	if (result.kind === "cancelled") {
		return "CANCELLED: the user discarded the Storybook annotation session without sending comments.\n";
	}
	const header = `ANNOTATIONS for Storybook stories (${projectDir})\n`;
	const general = result.general.trim();
	const groups = groupByStory(result.annotations);
	if (groups.length === 0 && general === "") {
		return `${header}The user reviewed the stories and approved them with no comments.\n`;
	}
	const count = result.annotations.length;
	const intro =
		`${count} comment(s) on ${groups.length} story(ies). ` +
		"Boxes are CSS px in the story canvas (page coordinates, scroll included). " +
		'A CSS path starts at #storybook-root (or body); " >> " enters the shadow root of the element before it.\n';
	let number = 0;
	const sections = groups.map((group) => {
		const storyHeader =
			`\n## ${storyLabel(group.story)}\n` +
			`Story ID: ${group.story.id} · File: ${normalize(join(projectDir, group.story.importPath))}\n`;
		const comments = group.annotations.map((annotation, index) => {
			number += 1;
			return formatAnnotation(annotation, number, index + 1);
		});
		return storyHeader + comments.join("");
	});
	const generalSection =
		general === "" ? "" : `\n### General comment\n${general}\n`;
	return header + intro + sections.join("") + generalSection;
}

function formatAnnotation(
	annotation: Annotation,
	number: number,
	pin: number,
): string {
	const { target } = annotation;
	const lines: string[] = [];
	switch (target.kind) {
		case "story":
			lines.push(`\n### ${number}. Whole story`);
			break;
		case "element":
			lines.push(
				`\n### ${number}. Element ${elementLabel(target.element)} (pin ${pin})`,
			);
			lines.push(...elementLines(target.element, ""));
			lines.push(
				`Box: ${boxText(target.element.box)} in a ${target.viewport.width}×${target.viewport.height} canvas`,
			);
			break;
		case "region":
			lines.push(`\n### ${number}. Region ${boxText(target.box)} (pin ${pin})`);
			lines.push(`Canvas: ${target.viewport.width}×${target.viewport.height}`);
			lines.push(`Inside: ${elementLabel(target.container)}`);
			lines.push(...elementLines(target.container, "Container "));
			break;
		default: {
			const unhandled: never = target;
			throw new Error(`Unhandled target: ${JSON.stringify(unhandled)}`);
		}
	}
	lines.push(`Globals: ${globalsText(annotation.globals)}`);
	if (Object.keys(annotation.args).length > 0) {
		lines.push(
			`Args changed from the story: ${clip(JSON.stringify(annotation.args), 500)}`,
		);
	}
	lines.push(`Comment: ${annotation.text.trim()}`);
	return `${lines.join("\n")}\n`;
}

function elementLines(element: ElementDescriptor, prefix: string): string[] {
	const lines = [`${prefix}CSS path: ${element.cssPath}`];
	if (element.testId !== null) {
		lines.push(
			`${prefix}Test ID: ${element.testId.value}${distanceText(element.testId.distance)}`,
		);
	}
	if (element.role !== null) {
		const name = element.role.name === null ? "" : ` "${element.role.name}"`;
		lines.push(
			`${prefix}Role: ${element.role.value}${name}${distanceText(element.role.distance)}`,
		);
	}
	if (element.text !== null) lines.push(`${prefix}Text: "${element.text}"`);
	return lines;
}

function distanceText(distance: number): string {
	if (distance === 0) return "";
	return ` (on an ancestor, ${distance} level${distance === 1 ? "" : "s"} up)`;
}

function boxText(box: {
	x: number;
	y: number;
	width: number;
	height: number;
}): string {
	return `${box.width}×${box.height} at (${box.x}, ${box.y})`;
}

function globalsText(globals: Annotation["globals"]): string {
	const entries = Object.entries(globals);
	if (entries.length === 0) return "(defaults)";
	return entries.map(([key, value]) => `${key}=${String(value)}`).join(", ");
}

function clip(text: string, limit: number): string {
	return text.length > limit ? `${text.slice(0, limit - 1)}…` : text;
}
