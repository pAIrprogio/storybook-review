// The manager bundles this file with the classic JSX transform
// (`React.createElement`), so `React` must be in scope as a value.
import * as React from "react";
import { AddonPanel, ToggleButton } from "storybook/internal/components";
import { STORY_RENDERED } from "storybook/internal/core-events";
import {
	type API,
	addons,
	controlOrMetaKey,
	shortcutToHumanString,
	types,
} from "storybook/manager-api";
import { z } from "zod";
import { ReviewPanel } from "./review-panel.component";
import {
	type AnnotationTarget,
	annotationTargetSchema,
	REVIEW_ADDON_ID,
	REVIEW_EVENTS,
	REVIEW_PANEL_ID,
	REVIEW_TOOL_ID,
	type SessionKey,
	type StoryRef,
} from "./annotation.schema";
import {
	changedArgs,
	pinNumbers,
	reportedGlobals,
} from "./annotation.value-object";
import {
	createReviewStore,
	type ReviewState,
	type ReviewStore,
} from "./annotations.store";
import type { CanvasPin, CanvasState } from "./canvas-overlay.store";
import {
	checkSession,
	readSession,
	tabStorage,
} from "./session-client.adapter";

/**
 * Manager entry of the storybook-review addon: the Review panel, the toolbar button that starts picking,
 * and the channel wiring with the canvas overlay (`canvas-overlay.store.ts`).
 */

/** ⌘⇧C (Ctrl+Shift+C off macOS) toggles picking; the overlay mirrors it. */
const PICK_SHORTCUT = [controlOrMetaKey(), "shift", "C"];
const PICK_SHORTCUT_LABEL = shortcutToHumanString(PICK_SHORTCUT);

const pickedSchema = z.object({
	storyId: z.string(),
	target: annotationTargetSchema,
});

// The addon shows only while an agent listens: in a tab the CLI opened (its
// URL carries the session, and the tab keeps it in sessionStorage). Anywhere
// else it adds no panel, button or shortcut, so no comment is written for
// nobody to read.
const session = readSession();
if (session !== null) {
	// Start with the sidebar and the Review panel shown, so the user can
	// comment and move between stories at once.
	addons.setConfig({
		showNav: true,
		showPanel: true,
		selectedPanel: REVIEW_PANEL_ID,
	});
	addons.register(REVIEW_ADDON_ID, (api) => register(api, session));
}

function register(api: API, session: SessionKey): void {
	const store = createReviewStore(session, tabStorage());
	checkSession(session).then((sessionStatus) =>
		store.update((state) => ({ ...state, sessionStatus })),
	);

	const sendCanvasState = () => {
		const storyId = api.getUrlState().storyId ?? null;
		api.emit(REVIEW_EVENTS.canvasState, canvasStateOf(store.get(), storyId));
	};
	store.subscribe(sendCanvasState);
	api.on(STORY_RENDERED, sendCanvasState);

	const openPanel = () => {
		api.togglePanel(true);
		api.setSelectedPanel(REVIEW_PANEL_ID);
	};
	const startDraft = (storyId: string, target: AnnotationTarget) => {
		const story = storyRefOf(api, storyId);
		if (story === null) return;
		const entry = api.getData(storyId);
		const hasArgs = entry !== undefined && entry.type !== "docs";
		store.update((state) => ({
			...state,
			focusedId: null,
			draft: {
				kind: "new",
				story,
				target,
				args: hasArgs ? changedArgs(entry.args, entry.initialArgs) : {},
				globals: reportedGlobals(api.getGlobals()),
			},
		}));
		openPanel();
	};

	api.on(REVIEW_EVENTS.picked, (payload: unknown) => {
		const picked = pickedSchema.safeParse(payload);
		if (picked.success) startDraft(picked.data.storyId, picked.data.target);
	});
	api.on(REVIEW_EVENTS.pickCancelled, () =>
		store.update((state) => ({ ...state, picking: false })),
	);
	api.on(REVIEW_EVENTS.pinSelected, (id: unknown) => {
		if (typeof id !== "string") return;
		store.update((state) => ({ ...state, focusedId: id }));
		openPanel();
	});

	const commentOnStory = () => {
		const storyId = api.getUrlState().storyId;
		if (storyId !== undefined) startDraft(storyId, { kind: "story" });
	};
	// Picking is a mode: it stays on across picks, and toggling it keeps the
	// comment being written. A pick while one is open moves it to the new target.
	const togglePicking = () =>
		store.update((state) => ({ ...state, picking: !state.picking }));

	api.setAddonShortcut(REVIEW_ADDON_ID, {
		label: "Comment on an element or a region",
		defaultShortcut: PICK_SHORTCUT,
		actionName: "pickElementOrRegion",
		showInMenu: false,
		action: () => {
			if (api.getUrlState().viewMode === "story") togglePicking();
		},
	});

	addons.add(REVIEW_PANEL_ID, {
		type: types.PANEL,
		title: "Review",
		render: ({ active }) => (
			<AddonPanel active={active === true}>
				<ReviewPanel
					store={store}
					api={api}
					onCommentOnStory={commentOnStory}
					onTogglePicking={togglePicking}
					pickShortcutLabel={PICK_SHORTCUT_LABEL}
				/>
			</AddonPanel>
		),
	});

	addons.add(REVIEW_TOOL_ID, {
		type: types.TOOL,
		title: "Comment on an element",
		match: ({ viewMode }) => viewMode === "story",
		render: () => <PickTool store={store} onToggle={togglePicking} />,
	});
}

function PickTool({
	store,
	onToggle,
}: {
	readonly store: ReviewStore;
	readonly onToggle: () => void;
}) {
	const state = React.useSyncExternalStore(store.subscribe, store.get);
	return (
		<ToggleButton
			key={REVIEW_TOOL_ID}
			padding="small"
			variant="ghost"
			pressed={state.picking}
			ariaLabel="Comment on an element or a region"
			tooltip={`Comment on an element (click) or a region (drag) · ${PICK_SHORTCUT_LABEL}`}
			onClick={onToggle}
		>
			<CommentIcon />
			{state.annotations.length > 0 ? ` ${state.annotations.length}` : null}
		</ToggleButton>
	);
}

function CommentIcon() {
	return (
		<svg
			width="14"
			height="14"
			viewBox="0 0 14 14"
			fill="none"
			aria-hidden="true"
		>
			<path
				d="M2 2.5h10a.5.5 0 0 1 .5.5v6a.5.5 0 0 1-.5.5H6.5L3.5 12V9.5H2a.5.5 0 0 1-.5-.5V3a.5.5 0 0 1 .5-.5Z"
				stroke="currentColor"
				strokeLinejoin="round"
			/>
			<path d="M7 4.5v3M5.5 6h3" stroke="currentColor" strokeLinecap="round" />
		</svg>
	);
}

function storyRefOf(api: API, storyId: string): StoryRef | null {
	const entry = api.getData(storyId);
	if (entry === undefined || entry === null) return null;
	return {
		id: entry.id,
		title: entry.title,
		name: entry.name,
		importPath: entry.importPath,
	};
}

/** The pins the canvas shows for `storyId`: its saved comments and the draft. */
function canvasStateOf(
	state: ReviewState,
	storyId: string | null,
): CanvasState {
	if (storyId === null) return { storyId, picking: state.picking, pins: [] };
	const numbers = pinNumbers(state.annotations, storyId);
	const editedId = state.draft?.kind === "edit" ? state.draft.id : null;
	const saved = state.annotations.flatMap((annotation): CanvasPin[] => {
		const { target } = annotation;
		if (annotation.story.id !== storyId || target.kind === "story") return [];
		const isFocused =
			annotation.id === state.focusedId || annotation.id === editedId;
		return [
			{
				id: annotation.id,
				label: String(numbers.get(annotation.id) ?? ""),
				target,
				state: isFocused ? "focused" : "saved",
			},
		];
	});
	const draft = state.draft;
	const draftPins: CanvasPin[] =
		draft?.kind === "new" &&
		draft.story.id === storyId &&
		draft.target.kind !== "story"
			? [{ id: "draft", label: "+", target: draft.target, state: "draft" }]
			: [];
	return { storyId, picking: state.picking, pins: [...saved, ...draftPins] };
}
