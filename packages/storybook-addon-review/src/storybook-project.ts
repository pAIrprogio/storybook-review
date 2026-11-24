import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join, relative, resolve } from "node:path";

/**
 * Where the CLI finds the project's Storybook, whether the review addon is
 * set up in it, and how to run commands with the project's package manager.
 */

export const ADDON_PACKAGE = "@pairprog/storybook-addon-review";

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
 * `.storybook/`, else the one Storybook found below `cwd`. With several
 * below, the only one that lists the addon wins; otherwise it is ambiguous.
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
	const withAddon: StorybookProject[] = [];
	for (const project of found) {
		if (await listsAddon(project)) withAddon.push(project);
	}
	const [configured] = withAddon;
	if (configured !== undefined && withAddon.length === 1) {
		return { kind: "found", project: configured };
	}
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

/** What is missing for the addon to run in a Storybook. */
export type SetupGap = {
	readonly isInstalled: boolean;
	readonly isListed: boolean;
};

/**
 * Whether the addon resolves from the project folder and is named in its
 * Storybook config. Null when both hold.
 *
 * @example
 * await findSetupGap(project); // null
 * await findSetupGap(freshProject); // { isInstalled: false, isListed: false }
 */
export async function findSetupGap(
	project: StorybookProject,
): Promise<SetupGap | null> {
	const isInstalled = resolvesAddon(project.dir);
	const isListed = await listsAddon(project);
	return isInstalled && isListed ? null : { isInstalled, isListed };
}

function resolvesAddon(dir: string): boolean {
	try {
		createRequire(join(dir, "package.json")).resolve(
			`${ADDON_PACKAGE}/package.json`,
		);
		return true;
	} catch {
		return false;
	}
}

async function listsAddon(project: StorybookProject): Promise<boolean> {
	const config = await readFile(project.configPath, "utf8").catch(() => "");
	return config.includes(ADDON_PACKAGE);
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

const INSTALL_COMMANDS: Record<PackageManager, string> = {
	bun: `bun add -d ${ADDON_PACKAGE}`,
	pnpm: `pnpm add -D ${ADDON_PACKAGE}`,
	yarn: `yarn add -D ${ADDON_PACKAGE}`,
	npm: `npm install -D ${ADDON_PACKAGE}`,
};

/**
 * The `SETUP_REQUIRED` output: what is missing and the steps to fix it,
 * with paths relative to `cwd`.
 *
 * @example
 * formatSetupGap(project, { isInstalled: false, isListed: false }, "bun", "/repo", "npx storybook-review");
 * // "SETUP_REQUIRED\nThe Storybook in apps/web does not have the review addon. …"
 */
export function formatSetupGap(
	project: StorybookProject,
	gap: SetupGap,
	manager: PackageManager,
	cwd: string,
	self: string,
): string {
	const dir = relative(cwd, project.dir) || ".";
	const config = relative(cwd, project.configPath);
	const steps: string[] = [];
	if (!gap.isInstalled) {
		steps.push(`In ${dir}, run: ${INSTALL_COMMANDS[manager]}`);
	}
	if (!gap.isListed) {
		steps.push(`In ${config}, add "${ADDON_PACKAGE}" to the \`addons\` array.`);
	}
	const numbered = steps.map((step, index) => `${index + 1}. ${step}`);
	const rerun = dir === "." ? self : `${self} --dir ${dir}`;
	return [
		"SETUP_REQUIRED",
		`The Storybook in ${dir} does not have the review addon set up. Ask the user, then:`,
		...numbered,
		`Then run again: ${rerun}`,
		"",
	].join("\n");
}
