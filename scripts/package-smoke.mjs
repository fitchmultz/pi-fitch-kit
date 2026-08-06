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
const agentDir = join(temp, ".pi", "agent");
const cwd = join(temp, "project");
const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
const previousHome = process.env.HOME;

try {
	mkdirSync(agentDir, { recursive: true });
	mkdirSync(cwd, { recursive: true });
	writeFileSync(join(agentDir, "settings.json"), `${JSON.stringify({ packages: [root] }, null, 2)}\n`);
	writeFileSync(
		join(agentDir, "verbosity.json"),
		`${JSON.stringify({ showIndicator: true, models: { "openai-codex/gpt-5.6-sol": "medium" } }, null, 2)}\n`,
	);
	process.env.HOME = temp;
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
	if (extensions.extensions.length !== 4) throw new Error(`Expected 4 extensions, got ${extensions.extensions.length}`);
	const cleanFooter = extensions.extensions.find(({ path }) => path.endsWith("/extensions/clean-footer.ts"));
	if (!cleanFooter) throw new Error("Clean-footer extension missing");
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
	const cleanFooterStart = cleanFooter.handlers.get("session_start")?.[0];
	if (!cleanFooterStart) throw new Error("Clean-footer session_start handler missing");
	let footerFactory;
	let footerNotice;
	const footerContext = {
		mode: "tui",
		ui: {
			setFooter: (factory) => {
				footerFactory = factory;
			},
			notify: (message) => {
				footerNotice = message;
			},
		},
		sessionManager: {
			getCwd: () => join(process.env.HOME ?? temp, "Projects", "demo"),
			getSessionName: () => "footer-smoke",
		},
		getContextUsage: () => ({ percent: 74, contextWindow: 272_000 }),
		model: {
			id: "gpt-5.6-sol",
			provider: "openai-codex",
			api: "openai-codex-responses",
			contextWindow: 272_000,
			reasoning: true,
		},
		thinkingLevel: "high",
	};
	await cleanFooterStart({}, footerContext);
	if (typeof footerFactory !== "function") throw new Error("Clean footer was not installed in TUI mode");
	const footer = footerFactory(
		{ requestRender: () => {} },
		{ fg: (_color, text) => text },
		{
			getGitBranch: () => "main",
			getAvailableProviderCount: () => 2,
			getExtensionStatuses: () => new Map([
				["mcp", "MCP: 13 servers enabled (2 connected)"],
				["todo", "todo 0 active · 1 pending"],
			]),
			onBranchChange: () => () => {},
		},
	);
	const wideFooter = footer.render(170);
	if (wideFooter.length !== 2) throw new Error(`Expected two wide footer lines, got ${JSON.stringify(wideFooter)}`);
	if (!wideFooter.join("\n").includes("🗣  medium")) {
		throw new Error(`Clean footer lost the configured verbosity indicator: ${wideFooter.join("\n")}`);
	}
	const narrowFooter = footer.render(45);
	const narrowText = narrowFooter.join("\n");
	const normalizedNarrowText = narrowText.replace(/\s+/g, " ");
	if (narrowText.includes("...")) throw new Error(`Clean footer truncated content: ${narrowText}`);
	for (const hidden of ["↑", "↓", "CH", "$"]) {
		if (narrowText.includes(hidden)) throw new Error(`Clean footer leaked cumulative counter ${hidden}`);
	}
	for (const expected of [
		"footer-smoke",
		"(openai-codex) gpt-5.6-sol • high • 🗣 medium",
		"74.0%/272k",
		"MCP: 13 servers enabled (2 connected)",
		"todo 0 active · 1 pending",
	]) {
		if (!normalizedNarrowText.includes(expected)) throw new Error(`Clean footer lost ${expected}: ${narrowText}`);
	}
	footer.dispose?.();
	const cleanFooterCommand = cleanFooter.commands.get("clean-footer");
	if (!cleanFooterCommand) throw new Error("Clean-footer command missing");
	await cleanFooterCommand.handler("", footerContext);
	if (footerFactory !== undefined || footerNotice !== "Clean footer disabled") {
		throw new Error("Clean-footer command did not restore the built-in footer");
	}
	await cleanFooterCommand.handler("", footerContext);
	if (typeof footerFactory !== "function" || footerNotice !== "Clean footer enabled") {
		throw new Error("Clean-footer command did not restore the compact footer");
	}
	const cleanFooterShutdown = cleanFooter.handlers.get("session_shutdown")?.[0];
	if (!cleanFooterShutdown) throw new Error("Clean-footer session_shutdown handler missing");
	await cleanFooterShutdown({}, footerContext);

	const commandNames = extensions.extensions
		.flatMap(({ commands }) => [...commands.keys()])
		.sort();
	const expectedCommands = ["anthropic-fast", "clean-footer", "codex-fast"];
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
	if (previousHome === undefined) delete process.env.HOME;
	else process.env.HOME = previousHome;
	rmSync(temp, { recursive: true, force: true });
}
