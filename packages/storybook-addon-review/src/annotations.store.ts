import {
	type Annotation,
	type AnnotationTarget,
	type SavedAnnotations,
	type SessionKey,
	type StoryRef,
	savedAnnotationsSchema,
} from "./annotation.schema";

/**
 * The manager's state for storybook-review: every comment across stories,
 * the comment being written, pick mode, and the link to the agent's session.
 * Comments are saved to `sessionStorage` per session, so they survive a
 * reload and moving between stories.
 */

/** The comment being written: a new one on a target, or an edit. */
export type Draft =
	| {
			readonly kind: "new";
			readonly story: StoryRef;
			readonly target: AnnotationTarget;
			readonly args: Annotation["args"];
			readonly globals: Annotation["globals"];
			readonly screenshotId: string | null;
	  }
	| { readonly kind: "edit"; readonly id: string };

/** Whether the comments can reach the agent. */
export type SessionStatus =
	| { readonly kind: "none" }
	| { readonly kind: "checking" }
	| { readonly kind: "open" }
	| { readonly kind: "closed"; readonly reason: string };

/** Where the Send or Discard request is. */
export type SendStatus =
	| { readonly kind: "idle" }
	| { readonly kind: "sending" }
	| { readonly kind: "done"; readonly outcome: "sent" | "cancelled" }
	| { readonly kind: "failed"; readonly message: string };

/** Whether the screenshot extension answers in the preview. */
export type ExtensionStatus = "unknown" | "installed" | "missing";

/** The whole manager-side state. */
export type ReviewState = {
	readonly session: SessionKey | null;
	readonly sessionStatus: SessionStatus;
	readonly annotations: readonly Annotation[];
	readonly general: string;
	readonly draft: Draft | null;
	readonly picking: boolean;
	readonly focusedId: string | null;
	readonly sendStatus: SendStatus;
	readonly extension: ExtensionStatus;
};

/** A framework-free observable over `ReviewState`. */
export type ReviewStore = {
	readonly get: () => ReviewState;
	readonly subscribe: (listener: () => void) => () => void;
	readonly update: (change: (state: ReviewState) => ReviewState) => void;
};

/**
 * Create the store for `session` (null when the page was not opened by the
 * CLI), loading the comments saved for it.
 *
 * @example
 * const store = createReviewStore(session, window.sessionStorage);
 * store.update((state) => addAnnotation(state, "Denser header", 1700000000000, "c1"));
 * store.get().annotations.length; // 1 when a draft was open, else 0
 */
export function createReviewStore(
	session: SessionKey | null,
	storage: Storage | null,
): ReviewStore {
	const saved = loadSaved(storage, session);
	let state: ReviewState = {
		session,
		sessionStatus: session === null ? { kind: "none" } : { kind: "checking" },
		annotations: saved.annotations,
		general: saved.general,
		draft: null,
		picking: false,
		focusedId: null,
		sendStatus: { kind: "idle" },
		extension: "unknown",
	};
	const listeners = new Set<() => void>();
	return {
		get: () => state,
		subscribe: (listener) => {
			listeners.add(listener);
			return () => listeners.delete(listener);
		},
		update: (change) => {
			const next = change(state);
			if (next === state) return;
			const isSavedChange =
				next.annotations !== state.annotations ||
				next.general !== state.general;
			state = next;
			if (isSavedChange) save(storage, session, state);
			for (const listener of listeners) listener();
		},
	};
}

/**
 * Save the draft as a new comment, or the edited text of an existing one.
 * Blank text leaves the state as it is.
 *
 * @example
 * addAnnotation(withNewDraft, "Rename to Branch", 1700000000000, "c1"); // one more comment, no draft
 * addAnnotation(withNewDraft, "   ", 1700000000000, "c1"); // unchanged
 */
export function addAnnotation(
	state: ReviewState,
	text: string,
	now: number,
	newId: string,
): ReviewState {
	const trimmed = text.trim();
	const { draft } = state;
	if (draft === null || trimmed === "") return state;
	if (draft.kind === "edit") {
		return {
			...state,
			draft: null,
			annotations: state.annotations.map((annotation) =>
				annotation.id === draft.id
					? { ...annotation, text: trimmed }
					: annotation,
			),
		};
	}
	const annotation: Annotation = {
		id: newId,
		story: draft.story,
		target: draft.target,
		text: trimmed,
		args: draft.args,
		globals: draft.globals,
		screenshotId: draft.screenshotId,
		createdAt: now,
	};
	return {
		...state,
		draft: null,
		focusedId: annotation.id,
		annotations: [...state.annotations, annotation],
	};
}

/**
 * Remove one comment.
 *
 * @example
 * removeAnnotation(state, "c1"); // state without c1; the draft closes if it edited c1
 */
export function removeAnnotation(
	state: ReviewState,
	id: string,
): ReviewState {
	const isEditingIt = state.draft?.kind === "edit" && state.draft.id === id;
	return {
		...state,
		draft: isEditingIt ? null : state.draft,
		focusedId: state.focusedId === id ? null : state.focusedId,
		annotations: state.annotations.filter((annotation) => annotation.id !== id),
	};
}

/**
 * Whether the user can still send: the session is open and nothing was sent.
 *
 * @example
 * canSend({ ...state, sessionStatus: { kind: "open" }, sendStatus: { kind: "idle" } }); // true
 * canSend({ ...state, sessionStatus: { kind: "none" } }); // false
 */
export function canSend(state: ReviewState): boolean {
	const isWaiting =
		state.sendStatus.kind === "idle" || state.sendStatus.kind === "failed";
	return state.sessionStatus.kind === "open" && isWaiting;
}

function storageKey(session: SessionKey | null): string {
	return `storybook-review:comments:${session?.id ?? "no-session"}`;
}

function loadSaved(
	storage: Storage | null,
	session: SessionKey | null,
): SavedAnnotations {
	const empty: SavedAnnotations = { annotations: [], general: "" };
	try {
		const raw = storage?.getItem(storageKey(session)) ?? null;
		if (raw === null) return empty;
		const parsed = savedAnnotationsSchema.safeParse(JSON.parse(raw));
		return parsed.success ? parsed.data : empty;
	} catch {
		return empty;
	}
}

function save(
	storage: Storage | null,
	session: SessionKey | null,
	state: ReviewState,
): void {
	const saved: SavedAnnotations = {
		annotations: [...state.annotations],
		general: state.general,
	};
	try {
		storage?.setItem(storageKey(session), JSON.stringify(saved));
	} catch {
		// Storage can be full or blocked; the comments stay in memory.
	}
}
