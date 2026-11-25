import type { Middleware, ServerApp } from "storybook/internal/types";
import {
	type AnnotationResult,
	REVIEW_PING,
	REVIEW_ROUTE,
	resultRequestSchema,
	screenshotRequestSchema,
	type SessionKey,
	sessionKeySchema,
	shotIdSchema,
} from "./annotation.schema";

/**
 * Server side of the storybook-review addon. It adds local-only HTTP routes to the Storybook dev server:
 * the CLI registers a session and polls for its result, the manager page
 * posts the result. Sessions live in memory: they end with the server.
 */

type Session = {
	readonly token: string;
	result: AnnotationResult | null;
	/** PNGs by shot ID, from the preview's captures, until the CLI reads them. */
	readonly screenshots: Map<string, Buffer>;
};

const MAX_BODY_BYTES = 5 * 1024 * 1024;
// A full canvas on a large Retina screen is a few MB as a base64 PNG.
const MAX_SCREENSHOT_BYTES = 25 * 1024 * 1024;
const MAX_SCREENSHOTS_PER_SESSION = 200;
const PNG_DATA_URL_PREFIX = "data:image/png;base64,";
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
 * // POST /__storybook-review/screenshot {id, token, shotId, dataUrl} → 204 (the manager)
 * // GET  /__storybook-review/screenshot?id&token&shot → 200 image/png | 404 (the CLI)
 */
export const experimental_devServer = (app: ServerApp): ServerApp => {
	app.get(`${REVIEW_ROUTE}/ping`, localOnly(handlePing));
	app.post(`${REVIEW_ROUTE}/session`, localOnly(handleOpenSession));
	app.get(`${REVIEW_ROUTE}/session`, localOnly(handleSessionStatus));
	app.post(`${REVIEW_ROUTE}/result`, localOnly(handleSendResult));
	app.get(`${REVIEW_ROUTE}/result`, localOnly(handleReadResult));
	app.post(`${REVIEW_ROUTE}/screenshot`, localOnly(handleSaveScreenshot));
	app.get(`${REVIEW_ROUTE}/screenshot`, localOnly(handleReadScreenshot));
	return app;
};

const handlePing: Middleware = (_req, res) => {
	res.setHeader("Content-Type", "text/plain");
	res.end(REVIEW_PING);
};

const handleOpenSession: Middleware = async (req, res) => {
	const key = sessionKeySchema.safeParse(await readJson(req));
	if (!key.success) return reply(res, 400, key.error.message);
	sessions.set(key.data.id, {
		token: key.data.token,
		result: null,
		screenshots: new Map(),
	});
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

const handleSaveScreenshot: Middleware = async (req, res) => {
	const request = screenshotRequestSchema.safeParse(
		await readJson(req, MAX_SCREENSHOT_BYTES),
	);
	if (!request.success) return reply(res, 400, request.error.message);
	const session = findSession(request.data);
	if (session === null) return reply(res, 404, "unknown session");
	if (session.result !== null) return reply(res, 409, "already sent");
	const isFull =
		session.screenshots.size >= MAX_SCREENSHOTS_PER_SESSION &&
		!session.screenshots.has(request.data.shotId);
	if (isFull) return reply(res, 413, "too many screenshots");
	const png = Buffer.from(
		request.data.dataUrl.slice(PNG_DATA_URL_PREFIX.length),
		"base64",
	);
	session.screenshots.set(request.data.shotId, png);
	reply(res, 204);
};

const handleReadScreenshot: Middleware = (req, res) => {
	const session = findSession(queryKey(req.url));
	if (session === null) return reply(res, 404, "unknown session");
	const shotId = shotIdSchema.safeParse(
		new URL(req.url ?? "/", "http://localhost").searchParams.get("shot"),
	);
	const png = shotId.success ? session.screenshots.get(shotId.data) : undefined;
	if (png === undefined) return reply(res, 404, "no such screenshot");
	res.statusCode = 200;
	res.setHeader("Content-Type", "image/png");
	res.setHeader("Cache-Control", "no-store");
	res.end(png);
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

async function readJson(
	req: AsyncIterable<unknown>,
	maxBytes = MAX_BODY_BYTES,
): Promise<unknown> {
	const chunks: Uint8Array[] = [];
	let size = 0;
	for await (const chunk of req) {
		const bytes =
			chunk instanceof Uint8Array
				? chunk
				: new TextEncoder().encode(String(chunk));
		size += bytes.byteLength;
		if (size > maxBytes) return null;
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
