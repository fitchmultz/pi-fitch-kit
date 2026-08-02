#!/usr/bin/env node
// Loads this repo as a real Pi package in a throwaway agent dir and asserts
// the prompts and the sync-agents extension load cleanly. Catches resource
// breakage that static validation cannot see. Requires `npm install` first.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { DefaultResourceLoader, SettingsManager } from "@earendil-works/pi-coding-agent";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const temp = mkdtempSync(join(tmpdir(), "pi-fitch-kit-package-"));
const agentDir = join(temp, "agent");
const cwd = join(temp, "project");

try {
	mkdirSync(agentDir, { recursive: true });
	mkdirSync(cwd, { recursive: true });
	writeFileSync(join(agentDir, "settings.json"), `${JSON.stringify({ packages: [root] }, null, 2)}\n`);

	const settingsManager = await SettingsManager.create(cwd, agentDir, { projectTrusted: false });
	const loader = new DefaultResourceLoader({
		cwd,
		agentDir,
		settingsManager,
		noSkills: true,
		noThemes: true,
		noContextFiles: true,
	});
	await loader.reload();

	const prompts = loader.getPrompts();
	const extensions = loader.getExtensions();
	const promptNames = prompts.prompts.map(({ name }) => name).sort();
	if (!promptNames.includes("fitch-setup")) {
		throw new Error(`Expected fitch-setup among prompts, got ${JSON.stringify(promptNames)}`);
	}
	const errors = prompts.diagnostics.filter(({ severity }) => severity === "error");
	if (errors.length > 0) throw new Error(`Prompt load errors: ${JSON.stringify(errors)}`);
	if (extensions.errors.length > 0) throw new Error(`Extension load errors: ${JSON.stringify(extensions.errors)}`);
	if (extensions.extensions.length !== 1) throw new Error(`Expected 1 extension, got ${extensions.extensions.length}`);

	console.log(JSON.stringify({ ok: true, prompts: promptNames, extensions: extensions.extensions.length }, null, 2));
} finally {
	rmSync(temp, { recursive: true, force: true });
}
