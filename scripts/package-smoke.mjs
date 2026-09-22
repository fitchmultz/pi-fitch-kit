#!/usr/bin/env node
// Loads this repo as a real Pi package in a throwaway agent dir and asserts
// its active prompts and bundled extensions load cleanly. Catches resource
// breakage that static validation cannot see. Requires `npm install` first.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { fauxAssistantMessage } from "@earendil-works/pi-ai";
import { DefaultResourceLoader, SessionManager, SettingsManager } from "@earendil-works/pi-coding-agent";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const temp = mkdtempSync(join(tmpdir(), "pi-fitch-kit-package-"));
const home = join(temp, "home");
const agentDir = join(home, "agent");
const cwd = join(temp, "project");
const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
const previousHome = process.env.HOME;

try {
	mkdirSync(agentDir, { recursive: true });
	mkdirSync(home, { recursive: true });
	mkdirSync(cwd, { recursive: true });
	writeFileSync(join(agentDir, "settings.json"), `${JSON.stringify({ packages: [root] }, null, 2)}\n`);
	writeFileSync(
		join(agentDir, "verbosity.json"),
		`${JSON.stringify({ showIndicator: true, models: { "openai-codex/gpt-6-astra": "low" } }, null, 2)}\n`,
	);
	process.env.HOME = home;
	process.env.PI_CODING_AGENT_DIR = "~/agent";

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
	if (extensions.extensions.length !== 6) throw new Error(`Expected 6 extensions, got ${extensions.extensions.length}`);
	const cleanFooter = extensions.extensions.find(({ path }) => path.endsWith("/extensions/clean-footer.ts"));
	if (!cleanFooter) throw new Error("Clean-footer extension missing");
	const fastMode = extensions.extensions.find(({ path }) => path.endsWith("/extensions/fast-mode.ts"));
	if (!fastMode) throw new Error("Fast-mode extension missing");
	const sessionName = extensions.extensions.find(({ path }) => path.endsWith("/extensions/session-name.ts"));
	if (!sessionName) throw new Error("Session-name extension missing");
	const writePrompt = extensions.extensions.find(({ path }) => path.endsWith("/extensions/write-prompt.ts"));
	if (!writePrompt) throw new Error("Write-prompt extension missing");
	const restart = extensions.extensions.find(({ path }) => path.endsWith("/extensions/session-restart.ts"));
	if (!restart || restart.commands.size || restart.handlers.size) throw new Error("Restart helper must load inertly outside a real Node Pi TTY");
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
	const fastModeStart = fastMode.handlers.get("session_start")?.[0];
	if (!fastModeStart) throw new Error("Fast-mode session_start handler missing");
	const fastStatuses = new Map();
	await fastModeStart({}, {
		model: { provider: "openai-codex", id: "gpt-6-astra", api: "openai-codex-responses" },
		hasUI: false,
		ui: {
			setStatus: (key, value) => fastStatuses.set(key, value),
			theme: { fg: (_color, text) => text },
		},
	});
	if (!fastStatuses.has("codex-fast")) throw new Error("Fast-mode footer status missing for OpenAI models");
	if (fastStatuses.get("anthropic-fast") !== undefined) {
		throw new Error("Fast-mode must clear the Anthropic status on OpenAI models");
	}
	const sessionNameStart = sessionName.handlers.get("session_start")?.[0];
	if (!sessionNameStart) throw new Error("Session-name session_start handler missing");
	await sessionNameStart({}, {});
	const toolNames = extensions.extensions
		.flatMap(({ tools }) => [...tools.values()].map(({ definition }) => definition.name))
		.sort();
	if (JSON.stringify(toolNames) !== JSON.stringify(["name_session"])) {
		throw new Error(`Expected [\"name_session\"], got ${JSON.stringify(toolNames)}`);
	}
	const sessionContext = sessionName.handlers.get("context_with_system")?.[0] ?? sessionName.handlers.get("context")?.[0];
	if (!sessionContext) throw new Error("Session-name context handler missing");
	const contextResult = await sessionContext({ messages: [{ role: "system", content: "Smoke instructions", timestamp: 0 }] }, {});
	if (!contextResult?.messages?.some((message) => String(message.content).includes('"currentName":null'))) {
		throw new Error("Session-name context metadata missing");
	}
	const cleanFooterStart = cleanFooter.handlers.get("session_start")?.[0];
	if (!cleanFooterStart) throw new Error("Clean-footer session_start handler missing");
	let footerFactory;
	let footerNotice;
	const footerSession = SessionManager.inMemory(join(home, "Projects", "demo"));
	footerSession.appendSessionInfo("footer-smoke");
	for (const usage of [{ input: 20, cacheRead: 80 }, { input: 100, cacheRead: 0 }]) {
		const message = fauxAssistantMessage("footer smoke");
		footerSession.appendMessage({ ...message, usage: { ...message.usage, ...usage, totalTokens: 100 } });
	}
	const footerContext = {
		mode: "tui",
		hasUI: true,
		ui: {
			setFooter: (factory) => {
				footerFactory = factory;
			},
			notify: (message) => {
				footerNotice = message;
			},
		},
		sessionManager: footerSession,
		getContextUsage: () => ({ percent: 74, contextWindow: 272_000 }),
		model: {
			id: "gpt-6-astra",
			provider: "openai-codex",
			api: "openai-codex-responses",
			contextWindow: 272_000,
			reasoning: true,
		},
		thinkingLevel: "high",
	};
	await cleanFooterStart({}, footerContext);
	if (typeof footerFactory !== "function") throw new Error("Clean footer was not installed in TUI mode");
	const statuses = new Map([
		["mcp", "MCP: 13 servers enabled (2 connected)"],
		["todo", "todo 0 active · 1 pending"],
		["verbosity", "🗣  medium"],
	]);
	const createFooter = () => footerFactory(
		{ requestRender: () => {} },
		{ fg: (_color, text) => text },
		{
			getGitBranch: () => "main",
			getAvailableProviderCount: () => 2,
			getExtensionStatuses: () => statuses,
			onBranchChange: () => () => {},
		},
	);
	const footer = createFooter();
	const wideFooter = footer.render(170);
	if (wideFooter.length !== 2) throw new Error(`Expected two wide footer lines, got ${JSON.stringify(wideFooter)}`);
	if (!wideFooter.join("\n").includes("🗣 medium")) {
		throw new Error(`Clean footer lost the controller's native verbosity status: ${wideFooter.join("\n")}`);
	}
	const narrowFooter = footer.render(45);
	const narrowText = narrowFooter.join("\n");
	const normalizedNarrowText = narrowText.replace(/\s+/g, " ");
	if (narrowText.includes("...")) throw new Error(`Clean footer truncated content: ${narrowText}`);
	for (const hidden of ["↑", "↓", "$"]) {
		if (narrowText.includes(hidden)) throw new Error(`Clean footer leaked cumulative counter ${hidden}`);
	}
	for (const expected of [
		"footer-smoke",
		"(openai-codex) gpt-6-astra • high • 🗣 medium",
		"74.0%/272k • CH0.0%",
		"MCP: 13 servers enabled (2 connected)",
		"todo 0 active · 1 pending",
	]) {
		if (!normalizedNarrowText.includes(expected)) throw new Error(`Clean footer lost ${expected}: ${narrowText}`);
	}
	if (wideFooter.join("\n").split("🗣").length !== 2) throw new Error("Verbosity status was rendered twice");
	statuses.set("verbosity", "🗣  high");
	if (!footer.render(170).join("\n").includes("🗣 high")) throw new Error("Footer did not follow updated native status");
	statuses.delete("verbosity");
	if (footer.render(170).join("\n").includes("🗣")) throw new Error("Footer read verbosity from stale config without the controller");
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

	const commandNames = extensions.extensions
		.flatMap(({ commands }) => [...commands.keys()])
		.sort();
	const expectedCommands = ["anthropic-fast", "clean-footer", "codex-fast", "draft", "fast", "side-question", "xai-fast"];
	if (JSON.stringify(commandNames) !== JSON.stringify(expectedCommands)) {
		throw new Error(`Expected ${JSON.stringify(expectedCommands)}, got ${JSON.stringify(commandNames)}`);
	}
	for (const event of ["before_provider_request"]) {
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
