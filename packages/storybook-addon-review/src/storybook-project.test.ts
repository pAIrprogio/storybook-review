import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	detectPackageManager,
	findStorybookProject,
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

	test("given two nested Storybooks, when searching without --dir, then it is ambiguous", async () => {
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
