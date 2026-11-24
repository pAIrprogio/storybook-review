#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const PKG = "@pairprog/storybook-addon-review";
const SKIP = new Set(["node_modules", ".git", "dist", "build", "out", "coverage", "storybook-static"]);
const CONFIGS = ["ts", "mts", "cts", "js", "mjs", "cjs"].map((e) => `main.${e}`);

const scriptPath = fileURLToPath(import.meta.url);
const runtime = process.versions.bun ? "bun" : "node";
const selfCmd = `${runtime} ${scriptPath.includes(" ") ? JSON.stringify(scriptPath) : scriptPath}`;

function projectAt(dir) {
	for (const name of CONFIGS) {
		const configPath = join(dir, ".storybook", name);
		if (existsSync(configPath)) return { dir, configPath };
	}
	return null;
}

function searchBelow(dir, depth = 0) {
	if (depth >= 5) return [];
	let entries;
	try {
		entries = readdirSync(dir, { withFileTypes: true });
	} catch {
		return [];
	}
	const found = [];
	for (const entry of entries) {
		if (!entry.isDirectory() || entry.name.startsWith(".") || SKIP.has(entry.name)) continue;
		const child = join(dir, entry.name);
		const project = projectAt(child);
		if (project) found.push(project);
		else found.push(...searchBelow(child, depth + 1));
	}
	return found.sort((a, b) => a.dir.localeCompare(b.dir));
}

function resolveCli(dir) {
	try {
		const pkgPath = createRequire(join(dir, "package.json")).resolve(`${PKG}/package.json`);
		return join(dirname(pkgPath), "dist/cli.js");
	} catch {
		return null;
	}
}

function detectInstall(startDir) {
	for (let cur = resolve(startDir); ; cur = dirname(cur)) {
		if (existsSync(join(cur, "bun.lock")) || existsSync(join(cur, "bun.lockb"))) return `bun add -d ${PKG}`;
		if (existsSync(join(cur, "pnpm-lock.yaml"))) return `pnpm add -D ${PKG}`;
		if (existsSync(join(cur, "yarn.lock"))) return `yarn add -D ${PKG}`;
		if (existsSync(join(cur, "package-lock.json"))) return `npm install -D ${PKG}`;
		if (dirname(cur) === cur) return `npm install -D ${PKG}`;
	}
}

function readFlag(args, name) {
	for (let i = 0; i < args.length; i += 1) {
		if (args[i] === name && i + 1 < args.length) return args[i + 1];
		if (args[i].startsWith(`${name}=`)) return args[i].slice(name.length + 1);
	}
	return undefined;
}

function execCli(cliPath, args) {
	const result = spawnSync(process.execPath, [cliPath, ...args], {
		stdio: "inherit",
		env: { ...process.env, STORYBOOK_REVIEW_SELF: selfCmd },
	});
	process.exit(result.status ?? 1);
}

const argv = process.argv.slice(2);
const cwd = process.cwd();

if (readFlag(argv, "--wait") !== undefined) {
	const direct = resolveCli(cwd);
	if (direct) execCli(direct, argv);
	const projects = projectAt(cwd) ? [projectAt(cwd)] : searchBelow(cwd);
	for (const project of projects) {
		const cliPath = resolveCli(project.dir);
		if (cliPath) execCli(cliPath, argv);
	}
	console.log(`ERROR: ${PKG} is not installed under ${cwd}`);
	process.exit(1);
}

const dirArg = readFlag(argv, "--dir");
let project;
if (dirArg !== undefined) {
	project = projectAt(resolve(cwd, dirArg));
	if (!project) {
		console.log(`ERROR: no .storybook/main.* in ${resolve(cwd, dirArg)}`);
		process.exit(1);
	}
} else {
	const here = projectAt(cwd);
	if (here) {
		project = here;
	} else {
		const found = searchBelow(cwd);
		if (found.length === 0) {
			console.log(`ERROR: no .storybook/main.* found under ${cwd}. Run from the Storybook folder or pass --dir <folder>.`);
			process.exit(1);
		}
		if (found.length > 1) {
			const dirs = found.map((p) => relative(cwd, p.dir));
			console.log(`ERROR: several Storybooks: ${dirs.join(", ")}. Run again with --dir <the one holding the component>, e.g. ${selfCmd} --dir ${dirs[0]}`);
			process.exit(1);
		}
		project = found[0];
	}
}

const rel = relative(cwd, project.dir) || ".";
const cliPath = resolveCli(project.dir);
const isListed = readFileSync(project.configPath, "utf8").includes(PKG);

if (!cliPath || !isListed) {
	const steps = [];
	if (!cliPath) steps.push(`In ${rel}, run: ${detectInstall(project.dir)}`);
	if (!isListed) steps.push(`In ${relative(cwd, project.configPath)}, add "${PKG}" to the \`addons\` array.`);
	const rerun = rel === "." ? selfCmd : `${selfCmd} --dir ${rel}`;
	console.log([
		"SETUP_REQUIRED",
		`The Storybook in ${rel} does not have the review addon set up. Ask the user, then:`,
		...steps.map((s, i) => `${i + 1}. ${s}`),
		`Then run again: ${rerun}`,
	].join("\n"));
	process.exit(1);
}

const cliArgs = dirArg === undefined && rel !== "." ? [...argv, "--dir", rel] : argv;
execCli(cliPath, cliArgs);
