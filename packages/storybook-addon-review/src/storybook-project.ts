import { existsSync } from "node:fs";
import { readdir } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";

/**
 * Where the CLI finds the project's Storybook and how to run Storybook with
 * the project's package manager.
 */

const CONFIG_NAMES = ["ts", "mts", "cts", "js", "mjs", "cjs"].map(
	(extension) => `main.${extension}`,
);
const SKIPPED_FOLDERS = new Set([
	"node_modules",
	"dist",
	"build",
	"out",
	"coverage",
	"storybook-static",
]);
const MAX_SEARCH_DEPTH = 5;

/** A folder holding `.storybook/main.*`. */
export type StorybookProject = {
	readonly dir: string;
	readonly configPath: string;
};

export type ProjectSearch =
	| { readonly kind: "found"; readonly project: StorybookProject }
	| { readonly kind: "none" }
	| { readonly kind: "ambiguous"; readonly dirs: readonly string[] };

/**
 * The Storybook to use: `dirArg` when given, else `cwd` when it holds
 * `.storybook/`, else the single Storybook found below `cwd`. Multiple
 * Storybooks below `cwd` are always ambiguous and require `--dir`.
 *
 * @example
 * await findStorybookProject("/repo", undefined);
 * // { kind: "found", project: { dir: "/repo/apps/web", configPath: "/repo/apps/web/.storybook/main.ts" } }
 * await findStorybookProject("/repo", undefined);
 * // { kind: "ambiguous", dirs: ["/repo/apps/web", "/repo/packages/ui"] }
 */
export async function findStorybookProject(
	cwd: string,
	dirArg: string | undefined,
): Promise<ProjectSearch> {
	if (dirArg !== undefined) {
		const project = projectAt(resolve(cwd, dirArg));
		return project === null ? { kind: "none" } : { kind: "found", project };
	}
	const here = projectAt(cwd);
	if (here !== null) return { kind: "found", project: here };
	const found = await searchBelow(cwd, 0);
	const [only] = found;
	if (only !== undefined && found.length === 1) {
		return { kind: "found", project: only };
	}
	if (found.length === 0) return { kind: "none" };
	return { kind: "ambiguous", dirs: found.map((project) => project.dir) };
}

function projectAt(dir: string): StorybookProject | null {
	for (const name of CONFIG_NAMES) {
		const configPath = join(dir, ".storybook", name);
		if (existsSync(configPath)) return { dir, configPath };
	}
	return null;
}

async function searchBelow(
	dir: string,
	depth: number,
): Promise<StorybookProject[]> {
	if (depth >= MAX_SEARCH_DEPTH) return [];
	const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
	const found: StorybookProject[] = [];
	for (const entry of entries) {
		const isSearched =
			entry.isDirectory() &&
			!entry.name.startsWith(".") &&
			!SKIPPED_FOLDERS.has(entry.name);
		if (!isSearched) continue;
		const child = join(dir, entry.name);
		const project = projectAt(child);
		if (project !== null) found.push(project);
		else found.push(...(await searchBelow(child, depth + 1)));
	}
	return found.sort((a, b) => a.dir.localeCompare(b.dir));
}

/** The package manager whose lockfile is nearest above `dir`. */
export type PackageManager = "bun" | "pnpm" | "yarn" | "npm";

const LOCKFILES: ReadonlyArray<readonly [string, PackageManager]> = [
	["bun.lock", "bun"],
	["bun.lockb", "bun"],
	["pnpm-lock.yaml", "pnpm"],
	["yarn.lock", "yarn"],
	["package-lock.json", "npm"],
];

/**
 * @example
 * detectPackageManager("/repo/apps/web"); // "bun" when /repo/bun.lock exists
 */
export function detectPackageManager(dir: string): PackageManager {
	for (let current = dir; ; current = dirname(current)) {
		for (const [file, manager] of LOCKFILES) {
			if (existsSync(join(current, file))) return manager;
		}
		if (dirname(current) === current) return "npm";
	}
}

/**
 * The command that runs the project's own Storybook binary: with Bun in a
 * Bun project (some configs need Bun APIs), with Node otherwise. Null when
 * Storybook does not resolve from the project folder.
 *
 * @example
 * storybookCommand("/repo/apps/web", "bun");
 * // ["bun", ["/repo/node_modules/storybook/dist/bin/dispatcher.js"]]
 */
export function storybookCommand(
	dir: string,
	manager: PackageManager,
): readonly [string, readonly string[]] | null {
	try {
		const require = createRequire(join(dir, "package.json"));
		const manifestPath = require.resolve("storybook/package.json");
		const manifest: unknown = require(manifestPath);
		const bin = binOf(manifest);
		if (bin === null) return null;
		const binPath = join(dirname(manifestPath), bin);
		return manager === "bun" ? ["bun", [binPath]] : ["node", [binPath]];
	} catch {
		return null;
	}
}

function binOf(manifest: unknown): string | null {
	if (typeof manifest !== "object" || manifest === null) return null;
	const bin = Reflect.get(manifest, "bin");
	if (typeof bin === "string") return bin;
	if (typeof bin !== "object" || bin === null) return null;
	const named = Reflect.get(bin, "storybook");
	return typeof named === "string" ? named : null;
}
