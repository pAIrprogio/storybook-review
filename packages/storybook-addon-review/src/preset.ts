import type { Middleware, ServerApp } from "storybook/internal/types";
import {
	type AnnotationResult,
	REVIEW_PING,
	REVIEW_ROUTE,
	resultRequestSchema,
	type SessionKey,
	sessionKeySchema,
} from "./annotation.schema";

/**
 * Server side of the storybook-review addon. It adds local-only HTTP routes to the Storybook dev server:
 * the CLI registers a session and polls for its result, the manager page
 * posts the result. Sessions live in memory: they end with the server.
 */

type Session = { readonly token: string; result: AnnotationResult | null };

const MAX_BODY_BYTES = 5 * 1024 * 1024;
const sessions = new Map<string, Session>();

// A Storybook the CLI started exits on its own after this long, in case the
// agent never comes back for the result (the CLI sets it, the user's own
// `storybook dev` does not).
const lifetimeMs = Number(process.env.STORYBOOK_REVIEW_LIFETIME_MS ?? 0);
if (lifetimeMs > 0) setTimeout(() => process.exit(0), lifetimeMs).unref();

/**
 * Storybook preset hook: bundle the addon's manager entry (the Review
 * panel and the toolbar button).
 *
 * @example
 * managerEntries(["/a11y/manager.js"]); // ["/a11y/manager.js", "<this folder>/manager.js"]
 */
export const managerEntries = (entries: readonly string[] = []): string[] => [
	...entries,
	`${import.meta.dirname}/manager.js`,
];

/**
 * Storybook preset hook: add the addon's preview annotations (the canvas
 * overlay) to every story.
 *
 * @example
 * previewAnnotations([]); // ["<this folder>/preview.js"]
 */
export const previewAnnotations = (
	entries: readonly string[] = [],
): string[] => [...entries, `${import.meta.dirname}/preview.js`];

/**
 * Storybook preset hook: add the review routes before the builders'
 * middleware. Every route answers only loopback clients.
 *
 * @example
 * // GET  /__storybook-review/ping                 → "storybook-review/1"
 * // POST /__storybook-review/session {id, token}  → 204 (the CLI)
 * // GET  /__storybook-review/session?id&token     → {"status":"open"} | 404
 * // POST /__storybook-review/result {id, token, result} → 204 | 409 if sent
 * // GET  /__storybook-review/result?id&token      → 204 while open, 200 result
 */
export const experimental_devServer = (app: ServerApp): ServerApp => {
	app.get(`${REVIEW_ROUTE}/ping`, localOnly(handlePing));
	app.post(`${REVIEW_ROUTE}/session`, localOnly(handleOpenSession));
	app.get(`${REVIEW_ROUTE}/session`, localOnly(handleSessionStatus));
	app.post(`${REVIEW_ROUTE}/result`, localOnly(handleSendResult));
	app.get(`${REVIEW_ROUTE}/result`, localOnly(handleReadResult));
	return app;
};

const handlePing: Middleware = (_req, res) => {
	res.setHeader("Content-Type", "text/plain");
	res.end(REVIEW_PING);
};

const handleOpenSession: Middleware = async (req, res) => {
	const key = sessionKeySchema.safeParse(await readJson(req));
	if (!key.success) return reply(res, 400, key.error.message);
	sessions.set(key.data.id, { token: key.data.token, result: null });
	reply(res, 204);
};

const handleSessionStatus: Middleware = (req, res) => {
	const session = findSession(queryKey(req.url));
	if (session === null) return reply(res, 404, "unknown session");
	replyJson(res, { status: session.result === null ? "open" : "sent" });
};

const handleSendResult: Middleware = async (req, res) => {
	const request = resultRequestSchema.safeParse(await readJson(req));
	if (!request.success) return reply(res, 400, request.error.message);
	const session = findSession(request.data);
	if (session === null) return reply(res, 404, "unknown session");
	if (session.result !== null) return reply(res, 409, "already sent");
	session.result = request.data.result;
	reply(res, 204);
};

const handleReadResult: Middleware = (req, res) => {
	const session = findSession(queryKey(req.url));
	if (session === null) return reply(res, 404, "unknown session");
	if (session.result === null) return reply(res, 204);
	replyJson(res, session.result);
};

function localOnly(handler: Middleware): Middleware {
	return (req, res, next) => {
		const address = req.socket.remoteAddress ?? "";
		const isLoopback =
			address === "::1" ||
			address.startsWith("127.") ||
			address.startsWith("::ffff:127.");
		if (!isLoopback) return reply(res, 403, "local clients only");
		return handler(req, res, next);
	};
}

function findSession(key: SessionKey | null): Session | null {
	if (key === null) return null;
	const session = sessions.get(key.id);
	if (session === undefined || session.token !== key.token) return null;
	return session;
}

function queryKey(url: string | undefined): SessionKey | null {
	const params = new URL(url ?? "/", "http://localhost").searchParams;
	const key = sessionKeySchema.safeParse({
		id: params.get("id"),
		token: params.get("token"),
	});
	return key.success ? key.data : null;
}

async function readJson(req: AsyncIterable<unknown>): Promise<unknown> {
	const chunks: Uint8Array[] = [];
	let size = 0;
	for await (const chunk of req) {
		const bytes =
			chunk instanceof Uint8Array
				? chunk
				: new TextEncoder().encode(String(chunk));
		size += bytes.byteLength;
		if (size > MAX_BODY_BYTES) return null;
		chunks.push(bytes);
	}
	try {
		return JSON.parse(Buffer.concat(chunks).toString("utf8"));
	} catch {
		return null;
	}
}

type Reply = Parameters<Middleware>[1];

function reply(res: Reply, status: number, message = ""): void {
	res.statusCode = status;
	res.setHeader("Content-Type", "text/plain");
	res.setHeader("Cache-Control", "no-store");
	res.end(message);
}

function replyJson(res: Reply, body: unknown): void {
	res.statusCode = 200;
	res.setHeader("Content-Type", "application/json");
	res.setHeader("Cache-Control", "no-store");
	res.end(JSON.stringify(body));
}
