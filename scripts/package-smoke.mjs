#!/usr/bin/env node
// Loads this repo as a real Pi package in a throwaway agent dir and asserts
// its active prompts and bundled extensions load cleanly. Catches resource
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
const previousAgentDir = process.env.PI_CODING_AGENT_DIR;

try {
	mkdirSync(agentDir, { recursive: true });
	mkdirSync(cwd, { recursive: true });
	writeFileSync(join(agentDir, "settings.json"), `${JSON.stringify({ packages: [root] }, null, 2)}\n`);
	process.env.PI_CODING_AGENT_DIR = agentDir;

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
	const expectedPrompts = ["fitch-setup", "github-open-issues-prs"];
	if (JSON.stringify(promptNames) !== JSON.stringify(expectedPrompts)) {
		throw new Error(`Expected ${JSON.stringify(expectedPrompts)}, got ${JSON.stringify(promptNames)}`);
	}
	const errors = prompts.diagnostics.filter(({ severity }) => severity === "error");
	if (errors.length > 0) throw new Error(`Prompt load errors: ${JSON.stringify(errors)}`);
	if (extensions.errors.length > 0) throw new Error(`Extension load errors: ${JSON.stringify(extensions.errors)}`);
	if (extensions.extensions.length !== 3) throw new Error(`Expected 3 extensions, got ${extensions.extensions.length}`);
	const codex = extensions.extensions.find(({ path }) => path.endsWith("/extensions/codex-context.ts"));
	if (!codex) throw new Error("Codex context extension missing");
	const sessionName = extensions.extensions.find(({ path }) => path.endsWith("/extensions/session-name.ts"));
	if (!sessionName) throw new Error("Session-name extension missing");
	extensions.runtime.getCommands = () =>
		extensions.extensions.flatMap(({ commands }) =>
			[...commands.values()].map(({ name, description, sourceInfo }) => ({
				name,
				description,
				source: "extension",
				sourceInfo,
			})),
		);
	extensions.runtime.getAllTools = () =>
		extensions.extensions.flatMap(({ tools }) =>
			[...tools.values()].map(({ definition, sourceInfo }) => ({
				...definition,
				sourceInfo,
			})),
		);
	extensions.runtime.getActiveTools = () => ["name_session"];
	extensions.runtime.getSessionName = () => undefined;
	const codexStart = codex.handlers.get("session_start")?.[0];
	if (!codexStart) throw new Error("Codex context session_start handler missing");
	await codexStart({}, {
		model: { provider: "openai-codex" },
		hasUI: false,
		ui: {
			setStatus: () => {},
			theme: { fg: (_color, text) => text },
		},
	});
	const sessionNameStart = sessionName.handlers.get("session_start")?.[0];
	if (!sessionNameStart) throw new Error("Session-name session_start handler missing");
	await sessionNameStart({}, {});
	const toolNames = extensions.extensions
		.flatMap(({ tools }) => [...tools.keys()])
		.sort();
	if (JSON.stringify(toolNames) !== JSON.stringify(["name_session"])) {
		throw new Error(`Expected [\"name_session\"], got ${JSON.stringify(toolNames)}`);
	}
	const sessionContext = sessionName.handlers.get("context")?.[0];
	if (!sessionContext) throw new Error("Session-name context handler missing");
	const contextResult = await sessionContext({ messages: [] }, {});
	if (!String(contextResult?.messages?.[0]?.content).includes('"currentName":null')) {
		throw new Error("Session-name context metadata missing");
	}
	const commandNames = extensions.extensions
		.flatMap(({ commands }) => [...commands.keys()])
		.sort();
	const expectedCommands = ["anthropic-fast", "codex-fast"];
	if (JSON.stringify(commandNames) !== JSON.stringify(expectedCommands)) {
		throw new Error(`Expected ${JSON.stringify(expectedCommands)}, got ${JSON.stringify(commandNames)}`);
	}
	for (const event of ["before_provider_request", "session_before_compact"]) {
		const count = extensions.extensions.reduce(
			(total, extension) => total + (extension.handlers.get(event)?.length ?? 0),
			0,
		);
		if (count !== 1) throw new Error(`Expected one ${event} handler, got ${count}`);
	}

	console.log(JSON.stringify({ ok: true, prompts: promptNames, commands: commandNames, tools: toolNames, extensions: extensions.extensions.length }, null, 2));
} finally {
	if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
	else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
	rmSync(temp, { recursive: true, force: true });
}
