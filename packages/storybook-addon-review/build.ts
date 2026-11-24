/**
 * Build the addon into `dist/`: the preset and the CLI for Node, the
 * manager and preview entries for the browser. Storybook and React stay
 * external: Storybook provides them. Zod is
 * bundled, so the package has no runtime dependencies.
 *
 * @example
 * bun run build.ts
 */
import { rm } from "node:fs/promises";

const STORYBOOK_PROVIDED = [
	"storybook",
	"storybook/*",
	"react",
	"react/*",
	"react-dom",
	"react-dom/*",
];

await rm("dist", { recursive: true, force: true });

const builds = await Promise.all([
	Bun.build({
		entrypoints: ["src/preset.ts"],
		outdir: "dist",
		target: "node",
		format: "esm",
		external: STORYBOOK_PROVIDED,
	}),
	Bun.build({
		entrypoints: ["src/cli.ts"],
		outdir: "dist",
		target: "node",
		format: "esm",
		banner: "#!/usr/bin/env node",
	}),
	Bun.build({
		entrypoints: ["src/manager.tsx", "src/preview.ts"],
		outdir: "dist",
		target: "browser",
		format: "esm",
		external: STORYBOOK_PROVIDED,
		// Classic JSX: the manager provides `react` but not `react/jsx-runtime`.
		tsconfig: "tsconfig.manager.json",
		define: { "process.env.NODE_ENV": '"production"' },
	}),
]);

const failed = builds.flatMap((build) => (build.success ? [] : build.logs));
if (failed.length > 0) {
	for (const log of failed) console.error(log);
	process.exit(1);
}
console.log(
	builds.flatMap((build) => build.outputs.map((output) => output.path)).join("\n"),
);
