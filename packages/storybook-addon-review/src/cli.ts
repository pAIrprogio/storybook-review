/**
 * `storybook-review`: let the user comment on Storybook stories in the
 * browser and print the comments for the agent. It reuses the Storybook
 * already serving the review addon on the port, or starts one; opens the
 * browser on the story; waits until the user presses Send; prints the
 * comments; and stops the Storybook it started.
 *
 * Output starts with `ANNOTATIONS`, `PENDING <id>` (run again with
 * `--wait <id>`), `OPEN_FAILED <id>`, `SETUP_REQUIRED`, `CANCELLED` or
 * `ERROR`.
 *
 * Runs on Node 22+ and Bun. It finds the Storybook in the current folder or
 * below it (`--dir` picks one), checks the addon is installed and listed in
 * its config (else prints `SETUP_REQUIRED` with the steps), and starts the
 * project's own Storybook binary, with Bun in a Bun project.
 *
 * @example
 * npx storybook-review
 * npx storybook-review canvas/FrameNode
 * npx storybook-review canvas-framenode--running --port 6007 --dir apps/web
 * npx storybook-review --wait a1b2c3d4e5f6
 */
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { closeSync, openSync } from "node:fs";
import {
	mkdir,
	readdir,
	readFile,
	rm,
	stat,
	writeFile,
} from "node:fs/promises";
import { createConnection } from "node:net";
import { tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { parseArgs } from "node:util";
import {
	REVIEW_PING,
	REVIEW_QUERY_PARAM,
	REVIEW_ROUTE,
	type AnnotationResult,
	annotationResultSchema,
	type CliSession,
	cliSessionSchema,
	storyIndexSchema,
} from "./annotation.schema";
import { formatResult } from "./format-result";
import {
	detectPackageManager,
	findSetupGap,
	findStorybookProject,
	formatSetupGap,
	type StorybookProject,
	storybookCommand,
} from "./storybook-project";

const IS_BUN = process.versions.bun !== undefined;
// How the agent runs this CLI again (PENDING, OPEN_FAILED, SETUP_REQUIRED).
// The repo's `bun run review` sets it, so a run from source stays on source.
const SELF =
	process.env.STORYBOOK_REVIEW_SELF ??
	(IS_BUN ? "bunx storybook-review" : "npx storybook-review");
const SESSIONS_ROOT = join(tmpdir(), "storybook-review");
const DEFAULT_PORT = 6006;
const PORTS_TRIED = 20;
// Stay under the 10-minute command timeout common to agent harnesses, with
// room for stopping Storybook, then hand back PENDING.
const WAIT_MS = Number(process.env.STORYBOOK_REVIEW_WAIT_MS ?? 480_000);
const BOOT_TIMEOUT_MS = 180_000;
// A Storybook this CLI starts exits on its own after 6 h (preset.ts).
const STORYBOOK_LIFETIME_MS = 6 * 60 * 60 * 1000;
const SESSION_MAX_AGE_MS = 24 * 60 * 60 * 1000;
const POLL_MS = 500;
const MAX_FAILED_POLLS = 6;

/** What the run prints, and the exit code it ends with. */
type Outcome = { readonly output: string; readonly exitCode: number };

const outcome = await run(process.argv.slice(2)).catch(
	(error: unknown): Outcome => ({
		output: `ERROR: ${error instanceof Error ? error.message : String(error)}\n`,
		exitCode: 1,
	}),
);
process.stdout.write(outcome.output);
process.exit(outcome.exitCode);

async function run(argv: readonly string[]): Promise<Outcome> {
	const startedAt = Date.now();
	const { values, positionals } = parseArgs({
		args: [...argv],
		allowPositionals: true,
		options: {
			wait: { type: "string" },
			port: { type: "string" },
			dir: { type: "string" },
			help: { type: "boolean", short: "h" },
		},
	});
	if (values.help === true) {
		return {
			output: `Usage: ${SELF} [story id or title prefix] [--port 6006] [--dir <Storybook project folder>]\n       ${SELF} --wait <session id>\n`,
			exitCode: 0,
		};
	}
	const deadline = startedAt + WAIT_MS;
	if (values.wait !== undefined) return waitFor(values.wait, deadline);
	const port = values.port === undefined ? DEFAULT_PORT : Number(values.port);
	if (!Number.isInteger(port) || port <= 0) {
		return fail(`--port must be a port number, got "${values.port}"`);
	}
	const cwd = process.cwd();
	const search = await findStorybookProject(cwd, values.dir);
	switch (search.kind) {
		case "found":
			return start(positionals.join(" ").trim(), port, search.project, deadline);
		case "none":
			return fail(
				values.dir === undefined
					? `no Storybook in ${cwd} or the folders below it (looked for .storybook/main.*). Run from the Storybook folder or pass --dir <folder>.`
					: `no .storybook/main.* in ${resolve(cwd, values.dir)}`,
			);
		case "ambiguous": {
			const dirs = search.dirs.map((dir) => relative(cwd, dir));
			return fail(
				`several Storybooks: ${dirs.join(", ")}. Run again with --dir <the one holding the component>, e.g. ${SELF} --dir ${dirs[0]}`,
			);
		}
	}
}

async function start(
	storyArg: string,
	preferredPort: number,
	project: StorybookProject,
	deadline: number,
): Promise<Outcome> {
	const manager = detectPackageManager(project.dir);
	if ((await findReviewPort(preferredPort)) === null) {
		const gap = await findSetupGap(project);
		if (gap !== null) {
			return {
				output: formatSetupGap(project, gap, manager, process.cwd(), SELF),
				exitCode: 1,
			};
		}
	}
	await removeOldSessions();
	const id = randomBytes(6).toString("hex");
	const token = randomBytes(16).toString("hex");
	const dir = sessionDir(id);
	await mkdir(dir, { recursive: true });

	const storybook = await ensureStorybook(preferredPort, project, dir);
	const stopOwned = () => stopStorybook(storybook.pid);
	try {
		const storyId =
			storyArg === "" ? null : await resolveStory(storybook.port, storyArg);
		const response = await fetch(
			`${baseUrl(storybook.port)}${REVIEW_ROUTE}/session`,
			{
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ id, token }),
			},
		);
		if (response.status !== 204) {
			throw new Error(`Storybook refused the session: HTTP ${response.status}`);
		}
		const url = managerUrl(storybook.port, storyId, `${id}.${token}`);
		const session: CliSession = {
			id,
			token,
			port: storybook.port,
			url,
			storybookPid: storybook.pid,
			projectDir: relative(process.cwd(), project.dir) || ".",
		};
		await writeFile(join(dir, "session.json"), JSON.stringify(session));
		await writeFile(join(dir, "url"), url);
		const isOpened = await openBrowser(url);
		if (!isOpened) {
			return {
				output: `OPEN_FAILED ${id}\nCould not open a browser. Ask the user to open ${url}\nthen run: ${SELF} --wait ${id}\n`,
				exitCode: 0,
			};
		}
	} catch (error) {
		await stopOwned();
		throw error;
	}
	return waitFor(id, deadline);
}

async function waitFor(id: string, deadline: number): Promise<Outcome> {
	const dir = sessionDir(id);
	const session = await readSession(dir);
	if (session === null) {
		return fail(`no Storybook annotation session ${id} (it may have expired)`);
	}
	const resultUrl = `${baseUrl(session.port)}${REVIEW_ROUTE}/result?${new URLSearchParams({ id: session.id, token: session.token })}`;
	let failedPolls = 0;
	while (Date.now() < deadline) {
		const poll = await pollResult(resultUrl);
		if (poll.kind === "result") return finish(session, dir, poll.result);
		if (poll.kind === "unknown") {
			await stopStorybook(session.storybookPid);
			await rm(join(dir, "session.json"), { force: true });
			return fail(
				"Storybook no longer knows this session (it restarted). Start a new one.",
			);
		}
		failedPolls = poll.kind === "unreachable" ? failedPolls + 1 : 0;
		const isDown =
			failedPolls >= MAX_FAILED_POLLS || !isAlive(session.storybookPid);
		if (isDown) {
			await rm(join(dir, "session.json"), { force: true });
			return fail("Storybook stopped before the comments were sent.");
		}
		await sleep(POLL_MS);
	}
	return {
		output: `PENDING ${id}\nThe user is still annotating (${session.url}).\nKeep waiting by running: ${SELF} --wait ${id}\n`,
		exitCode: 0,
	};
}

type Poll =
	| { readonly kind: "result"; readonly result: AnnotationResult }
	| { readonly kind: "open" }
	| { readonly kind: "unknown" }
	| { readonly kind: "unreachable" };

async function pollResult(resultUrl: string): Promise<Poll> {
	try {
		const response = await fetch(resultUrl, {
			signal: AbortSignal.timeout(5_000),
		});
		if (response.status === 204) return { kind: "open" };
		if (response.status === 404) return { kind: "unknown" };
		if (!response.ok) return { kind: "unreachable" };
		return {
			kind: "result",
			result: annotationResultSchema.parse(await response.json()),
		};
	} catch {
		return { kind: "unreachable" };
	}
}

async function finish(
	session: CliSession,
	dir: string,
	result: AnnotationResult,
): Promise<Outcome> {
	await stopStorybook(session.storybookPid);
	await rm(dir, { recursive: true, force: true });
	return { output: formatResult(result, session.projectDir), exitCode: 0 };
}

// ---------- Storybook ----------

type RunningStorybook = { readonly port: number; readonly pid: number | null };

/** The first port from `preferredPort` serving the review addon, if any. */
async function findReviewPort(preferredPort: number): Promise<number | null> {
	for (
		let port = preferredPort;
		port < preferredPort + PORTS_TRIED;
		port += 1
	) {
		if (await servesReview(port)) return port;
		if (!(await isPortBusy(port))) return null;
	}
	return null;
}

async function ensureStorybook(
	preferredPort: number,
	project: StorybookProject,
	dir: string,
): Promise<RunningStorybook> {
	for (
		let port = preferredPort;
		port < preferredPort + PORTS_TRIED;
		port += 1
	) {
		if (await servesReview(port)) return { port, pid: null };
		if (!(await isPortBusy(port)))
			return { port, pid: await startStorybook(port, project, dir) };
	}
	throw new Error(
		`no free port and no Storybook with the review addon between ${preferredPort} and ${preferredPort + PORTS_TRIED - 1}`,
	);
}

async function startStorybook(
	port: number,
	project: StorybookProject,
	dir: string,
): Promise<number> {
	const runner = storybookCommand(
		project.dir,
		detectPackageManager(project.dir),
	);
	if (runner === null) {
		throw new Error(
			`Storybook is not installed in ${relative(process.cwd(), project.dir) || "."} (the "storybook" package does not resolve from there)`,
		);
	}
	const logPath = join(dir, "storybook.log");
	const log = openSync(logPath, "a");
	const storybookArgs = [
		"dev",
		"-p",
		String(port),
		"--no-open",
		"--ci",
		"--exact-port",
		"--no-version-updates",
	];
	const [command, runnerArgs] = runner;
	const child = spawn(command, [...runnerArgs, ...storybookArgs], {
		cwd: project.dir,
		// Its own process group, so it outlives a PENDING exit and stops as a whole.
		detached: true,
		stdio: ["ignore", log, log],
		env: {
			...process.env,
			STORYBOOK_REVIEW_LIFETIME_MS: String(STORYBOOK_LIFETIME_MS),
		},
	});
	closeSync(log);
	child.unref();
	const pid = child.pid;
	if (pid === undefined)
		throw new Error(`could not start Storybook (${command} not found?)`);
	const bootDeadline = Date.now() + BOOT_TIMEOUT_MS;
	// The preset adds its routes before the server listens, so a server that
	// answers without them for a while runs without the addon.
	let missedPings = 0;
	while (Date.now() < bootDeadline) {
		if (await servesReview(port)) return pid;
		if (!isAlive(pid)) {
			throw new Error(`Storybook exited while starting; its log is ${logPath}`);
		}
		missedPings = (await isPortBusy(port)) ? missedPings + 1 : 0;
		if (missedPings > MAX_FAILED_POLLS) {
			await stopStorybook(pid);
			throw new Error(
				`Storybook started without the review addon although ${relative(process.cwd(), project.configPath)} names it; its log is ${logPath}`,
			);
		}
		await sleep(POLL_MS);
	}
	await stopStorybook(pid);
	throw new Error(
		`Storybook did not start within ${BOOT_TIMEOUT_MS / 1000} s; its log is ${logPath}`,
	);
}

async function servesReview(port: number): Promise<boolean> {
	try {
		const response = await fetch(`${baseUrl(port)}${REVIEW_ROUTE}/ping`, {
			signal: AbortSignal.timeout(2_000),
		});
		return response.ok && (await response.text()) === REVIEW_PING;
	} catch {
		return false;
	}
}

async function isPortBusy(port: number): Promise<boolean> {
	const accepts = (host: string) =>
		new Promise<boolean>((done) => {
			const socket = createConnection({ port, host });
			socket.setTimeout(1_000);
			socket.once("connect", () => {
				socket.destroy();
				done(true);
			});
			socket.once("timeout", () => {
				socket.destroy();
				done(false);
			});
			socket.once("error", () => done(false));
		});
	const [ipv4, ipv6] = await Promise.all([
		accepts("127.0.0.1"),
		accepts("::1"),
	]);
	return ipv4 || ipv6;
}

/** Stop the Storybook this CLI started; one it reused keeps running. */
async function stopStorybook(pid: number | null): Promise<void> {
	if (pid === null || !isAlive(pid)) return;
	signalGroup(pid, "SIGTERM");
	for (let waited = 0; waited < 5_000 && isAlive(pid); waited += 100) {
		await sleep(100);
	}
	if (isAlive(pid)) signalGroup(pid, "SIGKILL");
}

function signalGroup(pid: number, signal: NodeJS.Signals): void {
	try {
		// The negative PID signals the process group `detached: true` created.
		process.kill(-pid, signal);
	} catch {
		try {
			process.kill(pid, signal);
		} catch {
			// Already gone.
		}
	}
}

function isAlive(pid: number | null): boolean {
	if (pid === null) return true;
	try {
		process.kill(pid, 0);
		return true;
	} catch (error) {
		return error instanceof Error && "code" in error && error.code === "EPERM";
	}
}

async function resolveStory(port: number, storyArg: string): Promise<string> {
	const response = await fetch(`${baseUrl(port)}/index.json`);
	if (!response.ok)
		throw new Error(`could not read the story index: HTTP ${response.status}`);
	const entries = Object.values(
		storyIndexSchema.parse(await response.json()).entries,
	);
	const exact = entries.find((entry) => entry.id === storyArg);
	if (exact !== undefined) return exact.id;
	const wanted = storyArg.toLowerCase();
	const match = entries.find(
		(entry) =>
			entry.type === "story" &&
			(entry.title.toLowerCase().startsWith(wanted) ||
				entry.id.startsWith(wanted)),
	);
	if (match === undefined) {
		throw new Error(
			`no story has the ID "${storyArg}" or a title starting with it`,
		);
	}
	return match.id;
}

function baseUrl(port: number): string {
	return `http://localhost:${port}`;
}

function managerUrl(
	port: number,
	storyId: string | null,
	sessionParam: string,
): string {
	const path =
		storyId === null ? "" : `path=/story/${encodeURIComponent(storyId)}&`;
	return `${baseUrl(port)}/?${path}${REVIEW_QUERY_PARAM}=${sessionParam}`;
}

async function openBrowser(url: string): Promise<boolean> {
	if (process.env.STORYBOOK_REVIEW_NO_OPEN === "1") return true;
	const command =
		process.platform === "darwin"
			? ["open", url]
			: process.platform === "win32"
				? ["cmd", "/c", "start", "", url]
				: ["xdg-open", url];
	const [executable = "open", ...args] = command;
	return new Promise((done) => {
		const child = spawn(executable, args, { stdio: "ignore" });
		child.once("error", () => done(false));
		child.once("exit", (code) => done(code === 0));
	});
}

// ---------- session folders ----------

function sessionDir(id: string): string {
	return join(SESSIONS_ROOT, id.replace(/[^a-f0-9]/gi, ""));
}

async function readSession(dir: string): Promise<CliSession | null> {
	try {
		return cliSessionSchema.parse(
			JSON.parse(await readFile(join(dir, "session.json"), "utf8")),
		);
	} catch {
		return null;
	}
}

async function removeOldSessions(): Promise<void> {
	await mkdir(SESSIONS_ROOT, { recursive: true });
	for (const name of await readdir(SESSIONS_ROOT)) {
		const dir = join(SESSIONS_ROOT, name);
		const info = await stat(dir).catch(() => null);
		const isOld =
			info !== null && Date.now() - info.mtimeMs > SESSION_MAX_AGE_MS;
		if (isOld) await rm(dir, { recursive: true, force: true });
	}
}

function fail(message: string): Outcome {
	return { output: `ERROR: ${message}\n`, exitCode: 1 };
}
