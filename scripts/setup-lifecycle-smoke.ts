#!/usr/bin/env node
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { DefaultResourceLoader, SettingsManager } from "@earendil-works/pi-coding-agent";
import { jsonField, jsonList, jsonString, requireRecord } from "./test-harness.ts";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const manifest: Record<string, unknown> = requireRecord(
	JSON.parse(readFileSync(join(root, "setup-manifest.json"), "utf8")),
	"setup-manifest.json",
);
const runtimePi = jsonString(jsonField(manifest, "runtime", "manifest runtime").pi, "runtime.pi");
const minimumPi = runtimePi.replace(/^>=/, "");
const versionAtLeast = (actual: string, minimum: string): boolean => {
	const left = actual.split(".").map(Number);
	const right = minimum.split(".").map(Number);
	for (let index = 0; index < Math.max(left.length, right.length); index++) {
		if ((left[index] ?? 0) !== (right[index] ?? 0)) {
			return (left[index] ?? 0) > (right[index] ?? 0);
		}
	}
	return true;
};
const temp = mkdtempSync(join(tmpdir(), "pi-fitch-kit-lifecycle-"));
const agentDir = join(temp, "agent");
const home = join(temp, "home");
const cwd = join(temp, "project");
const settingsPath = join(agentDir, "settings.json");
mkdirSync(agentDir, { recursive: true });
mkdirSync(home);
mkdirSync(cwd);

const env = {
	...process.env,
	HOME: home,
	PI_CODING_AGENT_DIR: agentDir,
	PI_OFFLINE: "1",
};
const packageDir = fileURLToPath(
	new URL("..", import.meta.resolve("@earendil-works/pi-coding-agent")),
);
const hostPackage: Record<string, unknown> = requireRecord(
	JSON.parse(readFileSync(join(packageDir, "package.json"), "utf8")),
	"host package.json",
);
const installedCli = resolve(
	packageDir,
	jsonString(jsonField(hostPackage, "bin", "host bin").pi, "host bin.pi"),
);
const cli = process.env.PI_HOST_CLI ?? installedCli;
assert.equal(
	realpathSync(cli),
	realpathSync(installedCli),
	"Child CLI must match the installed SDK/types graph",
);
if (process.env.PI_COMPAT_EXPECTED_PACKAGE_DIR !== undefined) {
	assert.equal(realpathSync(packageDir), realpathSync(process.env.PI_COMPAT_EXPECTED_PACKAGE_DIR));
}
if (process.env.PI_HOST_INDEX !== undefined) {
	assert.equal(
		realpathSync(process.env.PI_HOST_INDEX),
		realpathSync(join(packageDir, "dist/index.js")),
	);
}
if (process.env.PI_COMPAT_EXPECTED_VERSION !== undefined) {
	assert.equal(hostPackage.version, process.env.PI_COMPAT_EXPECTED_VERSION);
}
console.log(
	JSON.stringify({
		host: process.env.PI_COMPAT_HOST ?? "local",
		version: hostPackage.version,
		packageDir,
		cli,
	}),
);
const pi = (...args: string[]) =>
	execFileSync(process.execPath, [cli, ...args, "--no-approve"], {
		cwd,
		encoding: "utf8",
		env,
		stdio: ["ignore", "pipe", "pipe"],
	});

try {
	const piVersion = pi("--version").trim();
	assert.ok(versionAtLeast(piVersion, minimumPi), `Pi ${piVersion} must satisfy ${runtimePi}`);
	pi("install", root);
	assert.ok(
		pi("list").includes(root),
		"installed package list must include the resolved checkout path",
	);

	const filtered: Record<string, unknown> = requireRecord(
		JSON.parse(readFileSync(settingsPath, "utf8")),
		"settings.json",
	);
	assert.equal(filtered.compactView, undefined, "installing the kit must not enable compact view");
	filtered.compactView = false;
	filtered.packages = [{ source: root, prompts: [] }];
	writeFileSync(settingsPath, `${JSON.stringify(filtered, null, 2)}\n`);

	const settingsManager = SettingsManager.create(cwd, agentDir, {
		projectTrusted: false,
	});
	const loader = new DefaultResourceLoader({
		cwd,
		agentDir,
		settingsManager,
		noSkills: true,
		noContextFiles: true,
	});
	await loader.reload();
	assert.equal(loader.getPrompts().prompts.length, 0, "the stale filter fixture must hide prompts");

	const canonicalSource = "https://github.com/fitchmultz/pi-fitch-kit";
	filtered.packages = [{ source: canonicalSource, prompts: [] }, `${canonicalSource}#v0.4.3`];
	writeFileSync(settingsPath, `${JSON.stringify(filtered, null, 2)}\n`);
	pi("remove", canonicalSource);
	assert.deepEqual(
		requireRecord(JSON.parse(readFileSync(settingsPath, "utf8")), "settings.json").packages,
		[],
		"one identity-aware remove must clear filtered canonical and pinned duplicates",
	);
	pi("install", root);
	await settingsManager.reload();
	await loader.reload();

	const normalized: Record<string, unknown> = requireRecord(
		JSON.parse(readFileSync(settingsPath, "utf8")),
		"settings.json",
	);
	assert.equal(
		normalized.compactView,
		false,
		"kit reinstall and reload must preserve an explicit compact-view opt-out",
	);
	assert.equal(jsonList(normalized.packages, "settings packages").length, 1);
	const packageSource = jsonList(normalized.packages, "settings packages").at(0);
	if (typeof packageSource !== "string") {
		throw new Error("reinstall must remove stale package filters");
	}
	assert.equal(resolve(dirname(settingsPath), packageSource), root);
	assert.deepEqual(
		loader
			.getPrompts()
			.prompts.map(({ name }) => name)
			.sort(),
		["fitch-setup", "github-open-issues-prs"],
	);
	assert.equal(loader.getExtensions().extensions.length, 6);
	assert.equal(loader.getExtensions().errors.length, 0);
	assert.equal(loader.getThemes().themes.length, 1);
	assert.equal(loader.getThemes().diagnostics.filter(({ type }) => type === "error").length, 0);

	console.log("pi kit install, duplicate normalization, and reload smoke passed");
} finally {
	rmSync(temp, { recursive: true, force: true });
}
