import { z } from "zod";

/**
 * What the storybook-review addon, its server routes and the
 * `storybook-review` CLI (`cli.ts`) exchange. Every value is parsed with these schemas where it crosses a
 * boundary: the HTTP routes, `sessionStorage`, the CLI's poll.
 */

/** The addon's ID; the panel and the tool IDs derive from it. */
export const REVIEW_ADDON_ID = "pairprog/storybook-review";

/** The manager panel that lists and edits the comments. */
export const REVIEW_PANEL_ID = `${REVIEW_ADDON_ID}/panel`;

/** The toolbar button that starts picking an element or a region. */
export const REVIEW_TOOL_ID = `${REVIEW_ADDON_ID}/tool`;

/** Prefix of the HTTP routes the preset adds to the Storybook dev server. */
export const REVIEW_ROUTE = "/__storybook-review";

/**
 * Query parameter that carries `<sessionId>.<token>` to the manager page. The
 * CLI adds it to the URL it opens.
 */
export const REVIEW_QUERY_PARAM = "review";

/** The value `GET <REVIEW_ROUTE>/ping` answers, so the CLI knows the addon runs. */
export const REVIEW_PING = "storybook-review/1";

/**
 * The global the canvas overlay sets in the preview iframe, `{ dispose }`,
 * so a hot reload removes the previous overlay before adding its own.
 */
export const OVERLAY_GLOBAL = "__storybookReview";

/** Channel events between the manager and the preview iframe. */
export const REVIEW_EVENTS = {
	/** manager → preview: pick mode and the pins of the current story. */
	canvasState: `${REVIEW_ADDON_ID}/canvas-state`,
	/** preview → manager: the user clicked an element or dragged a region. */
	picked: `${REVIEW_ADDON_ID}/picked`,
	/** preview → manager: the user left pick mode (Escape). */
	pickCancelled: `${REVIEW_ADDON_ID}/pick-cancelled`,
	/** preview → manager: the user clicked a pin. */
	pinSelected: `${REVIEW_ADDON_ID}/pin-selected`,
} as const;

/** A rectangle in CSS pixels, in the story canvas's page coordinates. */
export const boxSchema = z.object({
	x: z.number(),
	y: z.number(),
	width: z.number(),
	height: z.number(),
});

/** A rectangle in CSS pixels, in the story canvas's page coordinates. */
export type Box = z.infer<typeof boxSchema>;

/** The size of the story canvas (the preview iframe) when the user picked. */
export const viewportSchema = z.object({
	width: z.number(),
	height: z.number(),
});

/** The size of the story canvas (the preview iframe) when the user picked. */
export type Viewport = z.infer<typeof viewportSchema>;

/**
 * A value found on the element or on its nearest ancestor that has one:
 * `distance` 0 is the element itself, 1 its parent, and so on (shadow hosts
 * count as parents).
 */
const nearestSchema = z.object({
	value: z.string(),
	distance: z.number().int().nonnegative(),
});

/**
 * Enough to find an element of a story again. `cssPath` is a chain of CSS
 * selectors, one per shadow root, joined by ` >> `: the first runs from
 * `#storybook-root` (or `body` for a portal), each next one inside the
 * previous match's shadow root.
 */
export const elementDescriptorSchema = z.object({
	cssPath: z.string(),
	tag: z.string(),
	testId: nearestSchema.nullable(),
	role: nearestSchema.extend({ name: z.string().nullable() }).nullable(),
	text: z.string().nullable(),
	box: boxSchema,
});

/** Enough to find an element of a story again. */
export type ElementDescriptor = z.infer<typeof elementDescriptorSchema>;

/**
 * What a comment is about: the story as a whole, one element, or a dragged
 * region (with the smallest element that contains it).
 */
export const annotationTargetSchema = z.discriminatedUnion("kind", [
	z.object({ kind: z.literal("story") }),
	z.object({
		kind: z.literal("element"),
		element: elementDescriptorSchema,
		viewport: viewportSchema,
	}),
	z.object({
		kind: z.literal("region"),
		box: boxSchema,
		container: elementDescriptorSchema,
		viewport: viewportSchema,
	}),
]);

/** What a comment is about. */
export type AnnotationTarget = z.infer<typeof annotationTargetSchema>;

/** A picked element or region, before the manager adds the story. */
export type CanvasTarget = Exclude<AnnotationTarget, { kind: "story" }>;

/**
 * The story a comment belongs to. `importPath` is the stories file relative
 * to the Storybook project folder (`./src/chat/message-composer.component.stories.tsx`).
 */
export const storyRefSchema = z.object({
	id: z.string(),
	title: z.string(),
	name: z.string(),
	importPath: z.string(),
});

/** The story a comment belongs to. */
export type StoryRef = z.infer<typeof storyRefSchema>;

/**
 * One comment. `args` holds only the args the user changed from the story's
 * own; `globals` the toolbar values (`scheme`) when the comment was made.
 */
export const annotationSchema = z.object({
	id: z.string(),
	story: storyRefSchema,
	target: annotationTargetSchema,
	text: z.string(),
	args: z.record(z.string(), z.unknown()),
	globals: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])),
	createdAt: z.number(),
});

/** One comment on a story, an element or a region. */
export type Annotation = z.infer<typeof annotationSchema>;

/** What the user sends: every comment, or the decision to discard them. */
export const annotationResultSchema = z.discriminatedUnion("kind", [
	z.object({
		kind: z.literal("sent"),
		annotations: z.array(annotationSchema),
		general: z.string(),
	}),
	z.object({ kind: z.literal("cancelled") }),
]);

/** What the user sends: every comment, or the decision to discard them. */
export type AnnotationResult = z.infer<typeof annotationResultSchema>;

/** A session's ID and the secret the CLI made for it. */
export const sessionKeySchema = z.object({
	id: z.string().regex(/^[a-f0-9]{8,64}$/),
	token: z.string().regex(/^[a-f0-9]{16,128}$/),
});

/** A session's ID and the secret the CLI made for it. */
export type SessionKey = z.infer<typeof sessionKeySchema>;

/** Body of `POST <REVIEW_ROUTE>/result`, sent by the manager. */
export const resultRequestSchema = sessionKeySchema.extend({
	result: annotationResultSchema,
});

/** `GET <REVIEW_ROUTE>/session`: whether the user has sent yet. */
export const sessionStatusSchema = z.object({
	status: z.enum(["open", "sent"]),
});

/**
 * The CLI's own record of a session, `session.json` in the session folder:
 * where the Storybook runs and, when the CLI started it, its process ID.
 */
export const cliSessionSchema = sessionKeySchema.extend({
	port: z.number().int().positive(),
	url: z.string(),
	storybookPid: z.number().int().positive().nullable(),
	/** The Storybook project folder, relative to where the CLI runs (`.`, `apps/web`). */
	projectDir: z.string(),
});

/** The CLI's own record of a session. */
export type CliSession = z.infer<typeof cliSessionSchema>;

/** The part of Storybook's `/index.json` the CLI reads to find a story. */
export const storyIndexSchema = z.object({
	entries: z.record(
		z.string(),
		z.object({
			id: z.string(),
			title: z.string(),
			name: z.string(),
			type: z.string(),
			importPath: z.string(),
		}),
	),
});

/** The comments the manager keeps for one session, in `sessionStorage`. */
export const savedAnnotationsSchema = z.object({
	annotations: z.array(annotationSchema),
	general: z.string(),
});

/** The comments the manager keeps for one session, in `sessionStorage`. */
export type SavedAnnotations = z.infer<typeof savedAnnotationsSchema>;

/**
 * Read `<sessionId>.<token>` from the `review` query parameter; null when
 * it is missing or malformed.
 *
 * @example
 * parseSessionParam("a1b2c3d4e5f6.00112233445566778899aabbccddeeff");
 * // { id: "a1b2c3d4e5f6", token: "00112233445566778899aabbccddeeff" }
 * parseSessionParam("nope"); // null
 */
export function parseSessionParam(param: string | null): SessionKey | null {
	if (param === null) return null;
	const [id, token] = param.split(".");
	const parsed = sessionKeySchema.safeParse({ id, token });
	return parsed.success ? parsed.data : null;
}
