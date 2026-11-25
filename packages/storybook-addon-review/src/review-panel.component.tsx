// The manager bundles this file with the classic JSX transform
// (`React.createElement`), so `React` must be in scope as a value.
import * as React from "react";
import { Button } from "storybook/internal/components";
import { type API, useStorybookState } from "storybook/manager-api";
import { styled } from "storybook/theming";
import type { Annotation, AnnotationResult } from "./annotation.schema";
import {
	groupByStory,
	pinNumbers,
	storyLabel,
	targetLabel,
} from "./annotation.value-object";
import {
	type ReviewState,
	type ReviewStore,
	addAnnotation,
	canSend,
	removeAnnotation,
} from "./annotations.store";
import { sendResult } from "./session-client.adapter";

/** Props of the panel: the addon's store and the manager API. */
export type ReviewPanelProps = {
	readonly store: ReviewStore;
	readonly api: API;
	readonly onCommentOnStory: () => void;
	readonly onTogglePicking: () => void;
	/** The pick shortcut as Storybook shows keys, such as "⌘ ⇧​ C". */
	readonly pickShortcutLabel: string;
};

/**
 * The Review panel: the current story's comments, then the other stories',
 * a general comment, and Send / Discard for the whole session.
 */
export function ReviewPanel({
	store,
	api,
	onCommentOnStory,
	onTogglePicking,
	pickShortcutLabel,
}: ReviewPanelProps) {
	const state = React.useSyncExternalStore(store.subscribe, store.get);
	const storyId = useStorybookState().storyId;

	if (state.sendStatus.kind === "done") {
		return (
			<Done>
				<h2>
					{state.sendStatus.outcome === "sent"
						? "Sent to the agent"
						: "Discarded"}
				</h2>
				<p>You can close this tab and go back to the agent.</p>
			</Done>
		);
	}

	const groups = groupByStory(state.annotations);
	const current = groups.find((group) => group.story.id === storyId);
	const others = groups.filter((group) => group.story.id !== storyId);
	const draft = state.draft;
	const currentStory = storyId === undefined ? null : api.getData(storyId);

	return (
		<Wrapper>
			<SessionLine state={state} />
			{state.extension === "missing" ? <ExtensionNotice /> : null}
			<Section aria-label="This story">
				<Heading>
					<span>
						{currentStory === undefined || currentStory === null
							? "No story selected"
							: `${currentStory.title} › ${currentStory.name}`}
					</span>
					<Actions>
						<Button size="small" variant="outline" onClick={onCommentOnStory}>
							Comment on story
						</Button>
						<Button
							size="small"
							variant={state.picking ? "solid" : "outline"}
							active={state.picking}
							onClick={onTogglePicking}
							title={pickShortcutLabel}
						>
							{state.picking ? "Picking… (Esc)" : "Pick element or region"}
						</Button>
					</Actions>
				</Heading>
				{draft?.kind === "new" ? (
					<Composer
						label={`${storyLabel(draft.story)} · ${targetLabel(draft.target)}`}
						initialText=""
						submitLabel="Add comment"
						onSave={(text) =>
							store.update((s) =>
								addAnnotation(s, text, Date.now(), crypto.randomUUID()),
							)
						}
						onCancel={() => store.update((s) => ({ ...s, draft: null }))}
					/>
				) : null}
				{current === undefined ? (
					<Muted>
						No comments yet — comment on the story, or pick or drag on the
						canvas{` (${pickShortcutLabel}).`}
					</Muted>
				) : (
					<CommentList
						annotations={current.annotations}
						state={state}
						store={store}
					/>
				)}
			</Section>
			{others.map((group) => (
				<Section key={group.story.id} aria-label={storyLabel(group.story)}>
					<Heading>
						<span>{storyLabel(group.story)}</span>
						<Button
							size="small"
							variant="ghost"
							onClick={() => api.selectStory(group.story.id)}
						>
							Open story
						</Button>
					</Heading>
					<CommentList
						annotations={group.annotations}
						state={state}
						store={store}
					/>
				</Section>
			))}
			<SendArea state={state} store={store} />
		</Wrapper>
	);
}

function SessionLine({ state }: { readonly state: ReviewState }) {
	switch (state.sessionStatus.kind) {
		case "none":
			return (
				<Notice>
					No agent is waiting. Comments stay in this tab; to send them, have the
					agent run <code>npx storybook-review</code>.
				</Notice>
			);
		case "checking":
			return <Notice>Connecting to the agent's session…</Notice>;
		case "open":
			return null;
		case "closed":
			return <Notice data-tone="negative">{state.sessionStatus.reason}</Notice>;
		default: {
			const unhandled: never = state.sessionStatus;
			throw new Error(`Unhandled session status: ${JSON.stringify(unhandled)}`);
		}
	}
}

const EXTENSION_INSTALL_URL =
	"https://github.com/pAIrprogio/storybook-review/tree/main/packages/storybook-review-extension#install";

function ExtensionNotice() {
	return (
		<Muted>
			Comments go without screenshots —{" "}
			<a href={EXTENSION_INSTALL_URL} target="_blank" rel="noreferrer">
				install the extension
			</a>{" "}
			to send the agent what you see.
		</Muted>
	);
}

type CommentListProps = {
	readonly annotations: readonly Annotation[];
	readonly state: ReviewState;
	readonly store: ReviewStore;
};

function CommentList({ annotations, state, store }: CommentListProps) {
	const [first] = annotations;
	const numbers =
		first === undefined
			? new Map()
			: pinNumbers(state.annotations, first.story.id);
	return (
		<List>
			{annotations.map((annotation) => (
				<CommentItem
					key={annotation.id}
					annotation={annotation}
					pin={numbers.get(annotation.id) ?? 0}
					state={state}
					store={store}
				/>
			))}
		</List>
	);
}

type CommentItemProps = {
	readonly annotation: Annotation;
	readonly pin: number;
	readonly state: ReviewState;
	readonly store: ReviewStore;
};

function CommentItem({ annotation, pin, state, store }: CommentItemProps) {
	const ref = React.useRef<HTMLLIElement>(null);
	const isFocused = state.focusedId === annotation.id;
	const isEditing =
		state.draft?.kind === "edit" && state.draft.id === annotation.id;
	React.useEffect(() => {
		if (isFocused) ref.current?.scrollIntoView({ block: "nearest" });
	}, [isFocused]);

	return (
		<Item
			ref={ref}
			data-focused={isFocused}
			onClick={() => store.update((s) => ({ ...s, focusedId: annotation.id }))}
		>
			<Pin aria-label={`Comment ${pin}`}>{pin}</Pin>
			<ItemBody>
				<Target>{targetLabel(annotation.target)}</Target>
				{isEditing ? (
					<Composer
						label="Edit comment"
						initialText={annotation.text}
						submitLabel="Update"
						onSave={(text) =>
							store.update((s) => addAnnotation(s, text, Date.now(), ""))
						}
						onCancel={() => store.update((s) => ({ ...s, draft: null }))}
					/>
				) : (
					<>
						<Text>{annotation.text}</Text>
						<Actions>
							<Button
								size="small"
								variant="ghost"
								onClick={() =>
									store.update((s) => ({
										...s,
										draft: { kind: "edit", id: annotation.id },
									}))
								}
							>
								Edit
							</Button>
							<Button
								size="small"
								variant="ghost"
								onClick={() =>
									store.update((s) => removeAnnotation(s, annotation.id))
								}
							>
								Delete
							</Button>
						</Actions>
					</>
				)}
			</ItemBody>
		</Item>
	);
}

type ComposerProps = {
	readonly label: string;
	readonly initialText: string;
	readonly submitLabel: string;
	readonly onSave: (text: string) => void;
	readonly onCancel: () => void;
};

function Composer({
	label,
	initialText,
	submitLabel,
	onSave,
	onCancel,
}: ComposerProps) {
	const [text, setText] = React.useState(initialText);
	const id = React.useId();
	const save = () => {
		if (text.trim() !== "") onSave(text);
	};
	return (
		<ComposerBox onClick={(event) => event.stopPropagation()}>
			<label htmlFor={id}>{label}</label>
			<TextArea
				id={id}
				// The panel opens on a pick, so the comment can be typed at once.
				autoFocus
				value={text}
				placeholder="What should the agent do here?"
				onChange={(event) => setText(event.target.value)}
				onKeyDown={(event) => {
					if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
						event.preventDefault();
						save();
					}
					if (event.key === "Escape") {
						event.preventDefault();
						onCancel();
					}
				}}
			/>
			<Actions>
				<Hint>⌘/Ctrl+Enter to save · Esc to cancel</Hint>
				<Button size="small" variant="ghost" onClick={onCancel}>
					Cancel
				</Button>
				<Button
					size="small"
					variant="solid"
					disabled={text.trim() === ""}
					onClick={save}
				>
					{submitLabel}
				</Button>
			</Actions>
		</ComposerBox>
	);
}

function SendArea({
	state,
	store,
}: {
	readonly state: ReviewState;
	readonly store: ReviewStore;
}) {
	const generalId = React.useId();
	const isSendable = canSend(state);
	const submit = async (result: AnnotationResult) => {
		if (state.session === null) return;
		store.update((s) => ({ ...s, sendStatus: { kind: "sending" } }));
		const sendStatus = await sendResult(state.session, result);
		store.update((s) =>
			sendStatus.kind === "done"
				? {
						...s,
						sendStatus,
						annotations: [],
						general: "",
						draft: null,
						picking: false,
					}
				: { ...s, sendStatus },
		);
	};
	const send = () =>
		submit({
			kind: "sent",
			annotations: [...state.annotations],
			general: state.general.trim(),
		});
	const discard = () => {
		const isConfirmed = window.confirm(
			"Discard every comment and close this session?",
		);
		if (isConfirmed) submit({ kind: "cancelled" });
	};

	return (
		<Footer>
			<label htmlFor={generalId}>General comment (optional)</label>
			<TextArea
				id={generalId}
				value={state.general}
				placeholder="Anything that applies to every story…"
				onChange={(event) => {
					const general = event.target.value;
					store.update((s) => ({ ...s, general }));
				}}
			/>
			{state.sendStatus.kind === "failed" ? (
				<Notice data-tone="negative">
					Could not send: {state.sendStatus.message}. Your comments are kept;
					try again.
				</Notice>
			) : null}
			<Actions>
				<Button
					size="small"
					variant="ghost"
					disabled={!isSendable}
					onClick={discard}
				>
					Discard and close
				</Button>
				<Button
					size="medium"
					variant="solid"
					disabled={!isSendable}
					onClick={send}
				>
					{sendLabel(state)}
				</Button>
			</Actions>
		</Footer>
	);
}

function sendLabel(state: ReviewState): string {
	if (state.sendStatus.kind === "sending") return "Sending…";
	const count = state.annotations.length;
	if (count > 0)
		return `Send ${count} comment${count === 1 ? "" : "s"} to the agent`;
	if (state.general.trim() !== "") return "Send comment to the agent";
	return "Approve with no comments";
}

const Wrapper = styled.div(({ theme }) => ({
	display: "flex",
	flexDirection: "column",
	gap: 12,
	padding: 12,
	fontSize: theme.typography.size.s2,
	color: theme.color.defaultText,
}));

const Section = styled.section(({ theme }) => ({
	display: "flex",
	flexDirection: "column",
	gap: 8,
	paddingBottom: 12,
	borderBottom: `1px solid ${theme.appBorderColor}`,
}));

const Heading = styled.div(({ theme }) => ({
	display: "flex",
	alignItems: "center",
	justifyContent: "space-between",
	gap: 8,
	flexWrap: "wrap",
	fontWeight: theme.typography.weight.bold,
}));

const Actions = styled.div({
	display: "flex",
	alignItems: "center",
	justifyContent: "flex-end",
	gap: 6,
	flexWrap: "wrap",
});

const Notice = styled.p(({ theme }) => ({
	margin: 0,
	padding: "8px 10px",
	borderRadius: theme.appBorderRadius,
	background: theme.background.app,
	color: theme.fgColor.muted,
	"&[data-tone=negative]": { color: theme.fgColor.negative },
	code: { fontFamily: theme.typography.fonts.mono },
}));

const Muted = styled.p(({ theme }) => ({
	margin: 0,
	color: theme.fgColor.muted,
}));

const List = styled.ol({
	listStyle: "none",
	margin: 0,
	padding: 0,
	display: "grid",
	gap: 4,
});

const Item = styled.li(({ theme }) => ({
	display: "flex",
	gap: 10,
	padding: 8,
	borderRadius: theme.appBorderRadius,
	cursor: "pointer",
	"&:hover": { background: theme.background.hoverable },
	"&[data-focused=true]": {
		background: theme.background.hoverable,
		boxShadow: `inset 3px 0 0 ${theme.color.secondary}`,
	},
}));

const Pin = styled.span(({ theme }) => ({
	flex: "0 0 auto",
	minWidth: 20,
	height: 20,
	borderRadius: 10,
	display: "grid",
	placeItems: "center",
	background: theme.color.secondary,
	color: theme.color.lightest,
	fontSize: theme.typography.size.s1,
	fontWeight: theme.typography.weight.bold,
}));

const ItemBody = styled.div({ flex: 1, minWidth: 0, display: "grid", gap: 4 });

const Target = styled.div(({ theme }) => ({
	fontFamily: theme.typography.fonts.mono,
	fontSize: theme.typography.size.s1,
	color: theme.fgColor.muted,
	overflowWrap: "anywhere",
}));

const Text = styled.div({ whiteSpace: "pre-wrap", overflowWrap: "anywhere" });

const ComposerBox = styled.div(({ theme }) => ({
	display: "grid",
	gap: 6,
	padding: 8,
	borderRadius: theme.appBorderRadius,
	border: `1px solid ${theme.appBorderColor}`,
	borderLeft: `3px solid ${theme.color.secondary}`,
	label: {
		fontFamily: theme.typography.fonts.mono,
		fontSize: theme.typography.size.s1,
	},
}));

const TextArea = styled.textarea(({ theme }) => ({
	minHeight: 64,
	resize: "vertical",
	padding: 8,
	font: "inherit",
	borderRadius: theme.input.borderRadius,
	border: `1px solid ${theme.input.border}`,
	background: theme.input.background,
	color: theme.input.color,
}));

const Hint = styled.span(({ theme }) => ({
	marginRight: "auto",
	fontSize: theme.typography.size.s1,
	color: theme.fgColor.muted,
}));

const Footer = styled.div(({ theme }) => ({
	display: "grid",
	gap: 8,
	label: { fontSize: theme.typography.size.s1, color: theme.fgColor.muted },
}));

const Done = styled.div(({ theme }) => ({
	display: "grid",
	placeContent: "center",
	textAlign: "center",
	minHeight: 160,
	color: theme.color.defaultText,
	h2: { margin: "0 0 6px", fontSize: theme.typography.size.m1 },
	p: { margin: 0, color: theme.fgColor.muted },
}));
