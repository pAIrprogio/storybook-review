import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	ADDON_PACKAGE,
	detectPackageManager,
	findSetupGap,
	findStorybookProject,
	formatSetupGap,
} from "./storybook-project";

let root = "";

beforeEach(async () => {
	root = await mkdtemp(join(tmpdir(), "storybook-project-"));
});

afterEach(async () => {
	await rm(root, { recursive: true, force: true });
});

async function storybookIn(dir: string, config = "export default {};") {
	await mkdir(join(root, dir, ".storybook"), { recursive: true });
	await writeFile(join(root, dir, ".storybook", "main.ts"), config);
}

async function installAddonIn(dir: string) {
	const addonDir = join(root, dir, "node_modules", ...ADDON_PACKAGE.split("/"));
	await mkdir(addonDir, { recursive: true });
	await writeFile(join(addonDir, "package.json"), '{"name":"x"}');
}

const LISTED = `export default { addons: ["${ADDON_PACKAGE}"] };`;

describe("findStorybookProject", () => {
	test("given a Storybook in the current folder, when searching, then it is found", async () => {
		// Given
		await storybookIn(".");

		// When
		const search = await findStorybookProject(root, undefined);

		// Then
		expect(search).toEqual({
			kind: "found",
			project: { dir: root, configPath: join(root, ".storybook", "main.ts") },
		});
	});

	test("given one nested Storybook, when searching from the repo root, then it is found", async () => {
		// Given
		await storybookIn("apps/web");

		// When
		const search = await findStorybookProject(root, undefined);

		// Then
		expect(search.kind === "found" && search.project.dir).toBe(
			join(root, "apps/web"),
		);
	});

	test("given two nested Storybooks and one lists the addon, when searching, then that one wins", async () => {
		// Given
		await storybookIn("apps/web", LISTED);
		await storybookIn("packages/ui");

		// When
		const search = await findStorybookProject(root, undefined);

		// Then
		expect(search.kind === "found" && search.project.dir).toBe(
			join(root, "apps/web"),
		);
	});

	test("given two nested Storybooks without the addon, when searching, then it is ambiguous", async () => {
		// Given
		await storybookIn("apps/web");
		await storybookIn("packages/ui");

		// When
		const search = await findStorybookProject(root, undefined);

		// Then
		expect(search).toEqual({
			kind: "ambiguous",
			dirs: [join(root, "apps/web"), join(root, "packages/ui")],
		});
	});

	test("given a Storybook inside node_modules only, when searching, then none is found", async () => {
		// Given
		await storybookIn("node_modules/some-lib");

		// When
		const search = await findStorybookProject(root, undefined);

		// Then
		expect(search).toEqual({ kind: "none" });
	});

	test("given --dir, when searching, then that folder is used", async () => {
		// Given
		await storybookIn("apps/web");
		await storybookIn("packages/ui");

		// When
		const search = await findStorybookProject(root, "packages/ui");

		// Then
		expect(search.kind === "found" && search.project.dir).toBe(
			join(root, "packages/ui"),
		);
	});
});

describe("findSetupGap", () => {
	test("given the addon hoisted to the repo root and listed, when checking, then nothing is missing", async () => {
		// Given
		await storybookIn("apps/web", LISTED);
		await installAddonIn(".");

		// When
		const gap = await findSetupGap({
			dir: join(root, "apps/web"),
			configPath: join(root, "apps/web/.storybook/main.ts"),
		});

		// Then
		expect(gap).toBeNull();
	});

	test("given a fresh Storybook, when checking, then both steps are missing", async () => {
		// Given
		await storybookIn("apps/web");

		// When
		const gap = await findSetupGap({
			dir: join(root, "apps/web"),
			configPath: join(root, "apps/web/.storybook/main.ts"),
		});

		// Then
		expect(gap).toEqual({ isInstalled: false, isListed: false });
	});
});

describe("formatSetupGap", () => {
	test("given a nested Bun project missing both steps, when formatting, then it gives both commands and the rerun", () => {
		// When
		const output = formatSetupGap(
			{ dir: "/repo/apps/web", configPath: "/repo/apps/web/.storybook/main.ts" },
			{ isInstalled: false, isListed: false },
			"bun",
			"/repo",
			"npx storybook-review",
		);

		// Then
		expect(output).toBe(
			[
				"SETUP_REQUIRED",
				"The Storybook in apps/web does not have the review addon set up. Ask the user, then:",
				`1. In apps/web, run: bun add -d ${ADDON_PACKAGE}`,
				`2. In apps/web/.storybook/main.ts, add "${ADDON_PACKAGE}" to the \`addons\` array.`,
				"Then run again: npx storybook-review --dir apps/web",
				"",
			].join("\n"),
		);
	});
});

describe("detectPackageManager", () => {
	test("given a pnpm lockfile at the repo root, when detecting from a nested folder, then it is pnpm", async () => {
		// Given
		await mkdir(join(root, "apps/web"), { recursive: true });
		await writeFile(join(root, "pnpm-lock.yaml"), "");

		// When
		const manager = detectPackageManager(join(root, "apps/web"));

		// Then
		expect(manager).toBe("pnpm");
	});
});
