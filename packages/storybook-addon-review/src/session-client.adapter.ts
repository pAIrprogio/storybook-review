import {
	REVIEW_QUERY_PARAM,
	REVIEW_ROUTE,
	type AnnotationResult,
	parseSessionParam,
	type SessionKey,
	sessionStatusSchema,
} from "./annotation.schema";
import type { SendStatus, SessionStatus } from "./annotations.store";

/**
 * The manager page's side of the local HTTP routes the addon's preset adds
 * (`preset.ts`): find the agent's session, check it, send the result.
 */

const SESSION_STORAGE_KEY = "storybook-review:session";

/**
 * The session this page belongs to: from the `review` query parameter the
 * CLI put in the URL, else from this tab's `sessionStorage` (the manager
 * can drop unknown query parameters as the user navigates).
 *
 * @example
 * // http://localhost:6006/?path=/story/x&review=a1b2c3d4e5f6.0011…
 * readSession(); // { id: "a1b2c3d4e5f6", token: "0011…" }
 * // http://localhost:6006/ in a fresh tab
 * readSession(); // null
 */
export function readSession(): SessionKey | null {
	const fromUrl = parseSessionParam(
		new URLSearchParams(window.location.search).get(REVIEW_QUERY_PARAM),
	);
	const storage = tabStorage();
	if (fromUrl !== null) {
		try {
			storage?.setItem(SESSION_STORAGE_KEY, `${fromUrl.id}.${fromUrl.token}`);
		} catch {
			// Blocked storage: the session lasts as long as the URL keeps it.
		}
		return fromUrl;
	}
	try {
		return parseSessionParam(storage?.getItem(SESSION_STORAGE_KEY) ?? null);
	} catch {
		return null;
	}
}

/**
 * This tab's `sessionStorage`, or null where the browser blocks it.
 *
 * @example
 * tabStorage()?.getItem("x"); // null when unset
 */
export function tabStorage(): Storage | null {
	try {
		return window.sessionStorage;
	} catch {
		return null;
	}
}

/**
 * Ask the Storybook server whether the session still waits for comments.
 *
 * @example
 * await checkSession(session); // { kind: "open" }
 * await checkSession(sessionOfAStoppedCli); // { kind: "closed", reason: "…" }
 */
export async function checkSession(
	session: SessionKey,
): Promise<SessionStatus> {
	try {
		const response = await fetch(
			`${REVIEW_ROUTE}/session?${keyQuery(session)}`,
			{
				cache: "no-store",
			},
		);
		if (response.status === 404) {
			return {
				kind: "closed",
				reason:
					"This Storybook does not know the agent's session any more. Ask the agent to start a new one.",
			};
		}
		const status = sessionStatusSchema.parse(await response.json());
		return status.status === "open"
			? { kind: "open" }
			: {
					kind: "closed",
					reason: "The comments of this session were already sent.",
				};
	} catch {
		return {
			kind: "closed",
			reason: "The Storybook server cannot be reached.",
		};
	}
}

/**
 * Hand the result to the Storybook server, where the CLI picks it up.
 *
 * @example
 * await sendResult(session, { kind: "cancelled" }); // { kind: "done", outcome: "cancelled" }
 * await sendResult(sessionAlreadySent, result); // { kind: "failed", message: "already sent" }
 */
export async function sendResult(
	session: SessionKey,
	result: AnnotationResult,
): Promise<SendStatus> {
	try {
		const response = await fetch(`${REVIEW_ROUTE}/result`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ ...session, result }),
		});
		if (response.status !== 204) {
			return {
				kind: "failed",
				message: (await response.text()) || `HTTP ${response.status}`,
			};
		}
		return { kind: "done", outcome: result.kind };
	} catch (error) {
		return {
			kind: "failed",
			message: error instanceof Error ? error.message : String(error),
		};
	}
}

function keyQuery(session: SessionKey): string {
	return new URLSearchParams({
		id: session.id,
		token: session.token,
	}).toString();
}
