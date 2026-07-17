#!/usr/bin/env node
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
	if (JSON.stringify(promptNames) !== JSON.stringify(["fitch-setup"])) {
		throw new Error(`Expected only fitch-setup, got ${JSON.stringify(promptNames)}`);
	}
	if (prompts.diagnostics.some(({ severity }) => severity === "error")) {
		throw new Error(`Prompt load errors: ${JSON.stringify(prompts.diagnostics)}`);
	}
	if (extensions.errors.length > 0) throw new Error(`Extension load errors: ${JSON.stringify(extensions.errors)}`);
	if (extensions.extensions.length !== 2) throw new Error(`Expected 2 extensions, got ${extensions.extensions.length}`);

	console.log(JSON.stringify({ ok: true, prompts: promptNames, extensions: extensions.extensions.length }, null, 2));
} finally {
	rmSync(temp, { recursive: true, force: true });
}
