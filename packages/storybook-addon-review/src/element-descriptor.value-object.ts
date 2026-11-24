import type { Box, ElementDescriptor } from "./annotation.schema";

/**
 * Describe a DOM element of the story canvas so an agent can find it again:
 * a CSS path through shadow roots, the nearest `data-testid`, the nearest
 * ARIA role with its accessible name, a text snippet and the bounding box.
 * Runs in the preview iframe.
 */

/** Joins the CSS selector of each shadow scope in a `cssPath`. */
export const SHADOW_SEPARATOR = " >> ";

const STORY_ROOT_SELECTOR = "#storybook-root";
const TEXT_LIMIT = 120;
const NAME_LIMIT = 80;

/**
 * Describe `element` as it is now.
 *
 * @example
 * describeElement(document.querySelector("#storybook-root button")!);
 * // { cssPath: "#storybook-root > div > button:nth-of-type(2)", tag: "button",
 * //   testId: { value: "frame-header", distance: 1 },
 * //   role: { value: "button", name: "Fork", distance: 0 },
 * //   text: "Fork", box: { x: 120, y: 40, width: 80, height: 24 } }
 */
export function describeElement(element: Element): ElementDescriptor {
	return {
		cssPath: cssPathOf(element),
		tag: element.localName,
		testId: nearestTestId(element),
		role: nearestRole(element),
		text: textOf(element),
		box: pageBoxOf(element),
	};
}

/**
 * Find the element a `cssPath` names, or null when the story no longer
 * has it. Each segment after the first is looked up in the previous match's
 * shadow root.
 *
 * @example
 * findByCssPath("#storybook-root > div"); // the story's first div
 * findByCssPath("#storybook-root > ab-markdown >> div > p"); // inside the block
 * findByCssPath("#storybook-root > nav"); // null when there is no nav
 */
export function findByCssPath(cssPath: string): Element | null {
	const [first = "", ...rest] = cssPath.split(SHADOW_SEPARATOR);
	const [top = "", ...steps] = first.split(STEP_SEPARATOR);
	let match = walkSteps(safeQuery(document, top), steps);
	for (const segment of rest) {
		const shadowRoot = match?.shadowRoot ?? null;
		if (shadowRoot === null) return null;
		const [head = "", ...tail] = segment.split(STEP_SEPARATOR);
		const start = Array.from(shadowRoot.children).find((child) =>
			safeMatches(child, head),
		);
		match = walkSteps(start ?? null, tail);
	}
	return match;
}

const STEP_SEPARATOR = " > ";

/** Descend from `start` through its children, one selector step at a time. */
function walkSteps(
	start: Element | null,
	steps: readonly string[],
): Element | null {
	return steps.reduce<Element | null>(
		(parent, step) =>
			parent === null
				? null
				: (Array.from(parent.children).find((child) =>
						safeMatches(child, step),
					) ?? null),
		start,
	);
}

function safeMatches(element: Element, selector: string): boolean {
	try {
		return element.matches(selector);
	} catch {
		return false;
	}
}

/**
 * The element's bounding box in page coordinates (scroll included), rounded
 * to whole CSS pixels.
 *
 * @example
 * pageBoxOf(element); // { x: 16, y: 16, width: 320, height: 48 }
 */
export function pageBoxOf(element: Element): Box {
	const rect = element.getBoundingClientRect();
	return roundBox({
		x: rect.left + window.scrollX,
		y: rect.top + window.scrollY,
		width: rect.width,
		height: rect.height,
	});
}

/**
 * Round a box to whole CSS pixels.
 *
 * @example
 * roundBox({ x: 1.4, y: 2.6, width: 10.5, height: 3 }); // { x: 1, y: 3, width: 11, height: 3 }
 */
export function roundBox(box: Box): Box {
	return {
		x: Math.round(box.x),
		y: Math.round(box.y),
		width: Math.round(box.width),
		height: Math.round(box.height),
	};
}

/**
 * The deepest element under a viewport point, descending into open shadow
 * roots; elements for which `isIgnored` is true (the overlay) are skipped.
 *
 * @example
 * deepElementFromPoint(120, 40, isOverlay); // the <span> inside a block's button
 */
export function deepElementFromPoint(
	x: number,
	y: number,
	isIgnored: (element: Element) => boolean,
): Element | null {
	let element =
		document.elementsFromPoint(x, y).find((item) => !isIgnored(item)) ?? null;
	while (element?.shadowRoot) {
		const inner = element.shadowRoot.elementsFromPoint(x, y)[0];
		if (inner === undefined || inner === element) break;
		element = inner;
	}
	return element;
}

/**
 * The parent element, crossing a shadow root to its host.
 *
 * @example
 * composedParent(spanInsideBlock); // the block's host element at the top of its shadow tree
 */
export function composedParent(element: Element): Element | null {
	if (element.parentElement !== null) return element.parentElement;
	const root = element.getRootNode();
	return root instanceof ShadowRoot ? root.host : null;
}

function safeQuery(scope: ParentNode, selector: string): Element | null {
	try {
		return scope.querySelector(selector);
	} catch {
		return null;
	}
}

function cssPathOf(element: Element): string {
	const segments: string[] = [];
	let current: Element = element;
	for (;;) {
		const root = current.getRootNode();
		if (root instanceof ShadowRoot) {
			segments.unshift(pathWithin(current, null));
			current = root.host;
			continue;
		}
		const storyRoot = document.querySelector(STORY_ROOT_SELECTOR);
		const isInStory = storyRoot !== null && storyRoot.contains(current);
		segments.unshift(
			isInStory
				? pathWithin(current, storyRoot, STORY_ROOT_SELECTOR)
				: pathWithin(current, document.body, "body"),
		);
		return segments.join(SHADOW_SEPARATOR);
	}
}

/**
 * Selector steps from `top` (exclusive, written as `topSelector`) down to
 * `element`; with `top` null, from the top of the element's shadow tree.
 */
function pathWithin(
	element: Element,
	top: Element | null,
	topSelector?: string,
): string {
	if (element === top) return topSelector ?? element.localName;
	const steps: string[] = [];
	let current: Element | null = element;
	while (current !== null && current !== top) {
		steps.unshift(stepOf(current));
		current = current.parentElement;
	}
	if (topSelector !== undefined) steps.unshift(topSelector);
	return steps.join(STEP_SEPARATOR);
}

function stepOf(element: Element): string {
	const tag = CSS.escape(element.localName);
	const siblings =
		element.parentElement?.children ?? element.parentNode?.childNodes;
	const sameTag = Array.from(siblings ?? []).filter(
		(sibling) =>
			sibling instanceof Element && sibling.localName === element.localName,
	);
	if (sameTag.length <= 1) return tag;
	return `${tag}:nth-of-type(${sameTag.indexOf(element) + 1})`;
}

function nearestTestId(element: Element): ElementDescriptor["testId"] {
	let current: Element | null = element;
	let distance = 0;
	while (current !== null) {
		const testId = current.getAttribute("data-testid");
		if (testId !== null) return { value: testId, distance };
		current = composedParent(current);
		distance += 1;
	}
	return null;
}

function nearestRole(element: Element): ElementDescriptor["role"] {
	let current: Element | null = element;
	let distance = 0;
	while (current !== null && current !== document.body) {
		const role = roleOf(current);
		if (role !== null) {
			return { value: role, name: accessibleNameOf(current, role), distance };
		}
		current = composedParent(current);
		distance += 1;
	}
	return null;
}

const IMPLICIT_ROLES: Record<string, string> = {
	article: "article",
	aside: "complementary",
	button: "button",
	dialog: "dialog",
	fieldset: "group",
	footer: "contentinfo",
	form: "form",
	h1: "heading",
	h2: "heading",
	h3: "heading",
	h4: "heading",
	h5: "heading",
	h6: "heading",
	header: "banner",
	hr: "separator",
	li: "listitem",
	main: "main",
	nav: "navigation",
	ol: "list",
	output: "status",
	progress: "progressbar",
	summary: "button",
	table: "table",
	td: "cell",
	textarea: "textbox",
	th: "columnheader",
	tr: "row",
	ul: "list",
};

const INPUT_ROLES: Record<string, string> = {
	button: "button",
	checkbox: "checkbox",
	radio: "radio",
	range: "slider",
	reset: "button",
	search: "searchbox",
	submit: "button",
};

// Roles whose accessible name comes from their content (WAI-ARIA 1.2, §5.2.8.6).
const NAMED_FROM_CONTENT = new Set([
	"button",
	"cell",
	"checkbox",
	"columnheader",
	"heading",
	"link",
	"menuitem",
	"option",
	"radio",
	"switch",
	"tab",
	"treeitem",
]);

function roleOf(element: Element): string | null {
	const explicit = element.getAttribute("role")?.trim().split(/\s+/)[0];
	if (explicit !== undefined && explicit !== "") return explicit;
	const tag = element.localName;
	if (tag === "a") return element.hasAttribute("href") ? "link" : null;
	if (tag === "img") return element.getAttribute("alt") === "" ? null : "img";
	if (tag === "select") {
		return element.hasAttribute("multiple") ? "listbox" : "combobox";
	}
	if (tag === "input") {
		const type = element.getAttribute("type") ?? "text";
		return type === "hidden" ? null : (INPUT_ROLES[type] ?? "textbox");
	}
	if (tag === "section") {
		return element.hasAttribute("aria-label") ||
			element.hasAttribute("aria-labelledby")
			? "region"
			: null;
	}
	return IMPLICIT_ROLES[tag] ?? null;
}

function accessibleNameOf(element: Element, role: string): string | null {
	const label = element.getAttribute("aria-label");
	if (label !== null && label.trim() !== "") return clip(label, NAME_LIMIT);
	const labelledBy = labelledByText(element);
	if (labelledBy !== "") return clip(labelledBy, NAME_LIMIT);
	const fieldLabel = fieldLabelText(element);
	if (fieldLabel !== "") return clip(fieldLabel, NAME_LIMIT);
	const alt = element.getAttribute("alt") ?? element.getAttribute("title");
	if (alt !== null && alt.trim() !== "") return clip(alt, NAME_LIMIT);
	if (NAMED_FROM_CONTENT.has(role)) return textOf(element, NAME_LIMIT);
	return null;
}

function labelledByText(element: Element): string {
	const ids = element.getAttribute("aria-labelledby")?.split(/\s+/) ?? [];
	const root = element.getRootNode();
	const scope =
		root instanceof ShadowRoot || root instanceof Document ? root : document;
	return ids
		.map((id) => scope.getElementById(id)?.textContent ?? "")
		.join(" ")
		.trim();
}

function fieldLabelText(element: Element): string {
	const isField =
		element instanceof HTMLInputElement ||
		element instanceof HTMLTextAreaElement ||
		element instanceof HTMLSelectElement;
	if (!isField) return "";
	const labels = Array.from(element.labels ?? []).map(
		(label) => label.textContent ?? "",
	);
	const text = labels.join(" ").trim();
	if (text !== "") return text;
	return element.getAttribute("placeholder") ?? "";
}

function textOf(element: Element, limit = TEXT_LIMIT): string | null {
	const light =
		element instanceof HTMLElement ? element.innerText : element.textContent;
	const shadow = element.shadowRoot?.textContent ?? "";
	const text = collapse(light ?? "") || collapse(shadow);
	return text === "" ? null : clip(text, limit);
}

function collapse(text: string): string {
	return text.replace(/\s+/g, " ").trim();
}

function clip(text: string, limit: number): string {
	const collapsed = collapse(text);
	return collapsed.length > limit
		? `${collapsed.slice(0, limit - 1)}…`
		: collapsed;
}
