#!/usr/bin/env node
// Loads this repo as a real Pi package in a throwaway agent dir and asserts
// its active prompts, themes and bundled extensions load cleanly. Catches resource
// breakage that static validation cannot see. Requires `npm install` first.
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { fauxAssistantMessage } from "@earendil-works/pi-ai";
import {
	DefaultResourceLoader,
	type SlashCommandInfo,
	SessionManager,
	SettingsManager,
	type ToolInfo,
} from "@earendil-works/pi-coding-agent";
import {
	commandFor,
	drivenCommands,
	isRecord,
	jsonField,
	jsonList,
	jsonString,
	requireRecord,
	toolContextFrom,
} from "./test-harness.ts";

/** The subset of the installed footer factory this smoke exercises. */
type InstalledFooter = (
	tui: { requestRender: () => void },
	theme: { fg: (color: string, text: string) => string },
	footerData: {
		getGitBranch: () => string;
		getAvailableProviderCount: () => number;
		getExtensionStatuses: () => Map<string, string>;
		onBranchChange: (listener: () => void) => () => void;
	},
) => { render: (width: number) => string[]; dispose?: () => void };

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
	writeFileSync(
		join(agentDir, "settings.json"),
		`${JSON.stringify({ packages: [root] }, null, 2)}\n`,
	);
	writeFileSync(
		join(agentDir, "verbosity.json"),
		`${JSON.stringify({ showIndicator: true, models: { "openai-codex/gpt-6-astra": "low" } }, null, 2)}\n`,
	);
	process.env.HOME = home;
	process.env.PI_CODING_AGENT_DIR = "~/agent";

	const settingsManager = SettingsManager.create(cwd, agentDir, { projectTrusted: false });
	const loader = new DefaultResourceLoader({
		cwd,
		agentDir,
		settingsManager,
		noSkills: true,
		noContextFiles: true,
	});
	await loader.reload();

	const prompts = loader.getPrompts();
	const themes = loader.getThemes();
	const extensions = loader.getExtensions();
	const themeNames = themes.themes
		.map(({ name }) => {
			if (name === undefined) {
				throw new Error("Loaded theme without a name");
			}
			return name;
		})
		.sort();
	if (JSON.stringify(themeNames) !== JSON.stringify(["calm"]) || themes.diagnostics.length > 0) {
		throw new Error(
			`Theme load failed: ${JSON.stringify({ themes: themeNames, diagnostics: themes.diagnostics })}`,
		);
	}
	// SDK-only loaders resolve colors but do not install Pi's full theme schema validator.
	// The native CLI does; observe its selected theme because invalid themes silently fall back.
	const hostDir = fileURLToPath(
		new URL("..", import.meta.resolve("@earendil-works/pi-coding-agent")),
	);
	const hostPackage = requireRecord(
		JSON.parse(readFileSync(join(hostDir, "package.json"), "utf8")),
		"host package.json",
	);
	const cliAgentDir = join(temp, "cli-agent");
	mkdirSync(join(cliAgentDir, "themes"), { recursive: true });
	writeFileSync(join(cliAgentDir, "settings.json"), JSON.stringify({ theme: "calm" }));
	const themeProbe = join(temp, "theme-probe.ts");
	writeFileSync(
		themeProbe,
		`export default function (pi) {
		pi.on("session_start", (_event, ctx) => {
			pi.appendEntry("kit-theme-smoke", { name: ctx.ui.theme.name });
		});
	}\n`,
	);
	const shippedTheme: Record<string, unknown> = requireRecord(
		JSON.parse(readFileSync(join(root, "themes", "calm.json"), "utf8")),
		"themes/calm.json",
	);
	const missingRequiredColor = structuredClone(shippedTheme);
	const missingColors = jsonField(missingRequiredColor, "colors", "theme colors");
	delete missingColors.mdHeading;
	const themeDocuments: Array<[string, Record<string, unknown>, boolean]> = [
		["shipped calm", shippedTheme, true],
		["missing required mdHeading", missingRequiredColor, false],
	];
	for (const [label, document, shouldLoad] of themeDocuments) {
		writeFileSync(join(cliAgentDir, "themes", "calm.json"), JSON.stringify(document));
		const result = spawnSync(
			process.execPath,
			[
				resolve(hostDir, jsonString(jsonField(hostPackage, "bin", "host bin").pi, "host bin.pi")),
				"--mode",
				"rpc",
				"--offline",
				"--no-session",
				"--no-extensions",
				"-e",
				themeProbe,
				"--no-skills",
				"--no-prompt-templates",
				"--no-context-files",
				"--no-tools",
				"--no-approve",
				"--provider",
				"openai",
				"--model",
				"gpt-6-astra",
				"--api-key",
				"fixture-only",
			],
			{
				cwd,
				env: {
					PATH: process.env.PATH,
					HOME: home,
					PI_CODING_AGENT_DIR: cliAgentDir,
					PI_TELEMETRY: "0",
					PI_SKIP_VERSION_CHECK: "1",
				},
				input: '{"id":"theme","type":"get_entries"}\n',
				encoding: "utf8",
				timeout: 30_000,
			},
		);
		if (result.error) {
			throw result.error;
		}
		if (result.status !== 0) {
			throw new Error(`Native theme probe failed: ${result.stderr}`);
		}
		const response = result.stdout
			.split("\n")
			.filter(Boolean)
			.map((line) => requireRecord(JSON.parse(line), "theme probe response"))
			.find((record) => record.id === "theme" && record.type === "response");
		if (response?.success !== true) {
			throw new Error(`Native theme probe had no successful response: ${result.stdout}`);
		}
		const smokeEntry = jsonList(
			jsonField(response, "data", "response data").entries,
			"theme probe entries",
		).find((entry) => requireRecord(entry, "theme entry").customType === "kit-theme-smoke");
		const observed =
			isRecord(smokeEntry) && isRecord(smokeEntry.data) ? smokeEntry.data.name : undefined;
		if (typeof observed !== "string") {
			throw new Error("Native theme probe did not observe the active theme");
		}
		if ((observed === "calm") !== shouldLoad) {
			throw new Error(`Native theme schema check failed for ${label}: selected ${observed}`);
		}
	}
	const promptNames = prompts.prompts.map(({ name }) => name).sort();
	const expectedPrompts = ["fitch-setup", "github-open-issues-prs"];
	if (JSON.stringify(promptNames) !== JSON.stringify(expectedPrompts)) {
		throw new Error(
			`Expected ${JSON.stringify(expectedPrompts)}, got ${JSON.stringify(promptNames)}`,
		);
	}
	const errors = prompts.diagnostics.filter(({ type }) => type === "error");
	if (errors.length > 0) {
		throw new Error(`Prompt load errors: ${JSON.stringify(errors)}`);
	}
	if (extensions.errors.length > 0) {
		throw new Error(`Extension load errors: ${JSON.stringify(extensions.errors)}`);
	}
	if (extensions.extensions.length !== 7) {
		throw new Error(`Expected 7 extensions, got ${extensions.extensions.length}`);
	}
	const cleanFooter = extensions.extensions.find(({ path }) =>
		path.endsWith("/extensions/clean-footer.ts"),
	);
	if (!cleanFooter) {
		throw new Error("Clean-footer extension missing");
	}
	const fastMode = extensions.extensions.find(({ path }) =>
		path.endsWith("/extensions/fast-mode.ts"),
	);
	if (!fastMode) {
		throw new Error("Fast-mode extension missing");
	}
	const sessionName = extensions.extensions.find(({ path }) =>
		path.endsWith("/extensions/session-name.ts"),
	);
	if (!sessionName) {
		throw new Error("Session-name extension missing");
	}
	const setupModels = extensions.extensions.find(({ path }) =>
		path.endsWith("/extensions/setup-models.ts"),
	);
	const setupModelsTool = [...(setupModels?.tools.values() ?? [])].find(
		({ definition }) => definition.name === "fitch_setup_models",
	)?.definition;
	if (!setupModelsTool) {
		throw new Error("Read-only setup model tool missing");
	}
	const legacyFiles: Array<[string, string]> = [
		[join(cwd, ".pi", "commands", "legacy.md"), "project command"],
		[join(agentDir, "tools", "rg"), "older distinct binary"],
		[join(agentDir, "bin", "rg"), "current distinct binary"],
	];
	for (const [path, content] of legacyFiles) {
		mkdirSync(dirname(path), { recursive: true });
		writeFileSync(path, content);
	}
	const models = [
		{ provider: "openai", id: "gpt-6-astra" },
		{ provider: "fireworks", id: "accounts/fireworks/routers/kimi-k3-fast" },
	];
	const modelStatus = await setupModelsTool.execute(
		"models",
		{
			routes: [
				"openai/gpt-6-astra",
				"fireworks/accounts/fireworks/routers/kimi-k3-fast",
				"anthropic/missing",
			],
		},
		undefined,
		() => {
			return;
		},
		toolContextFrom({
			modelRegistry: { getAll: () => models, getAvailable: () => [models[0]] },
			isProjectTrusted: () => true,
		}),
	);
	const expectedStatus = {
		projectTrusted: true,
		routes: [
			{ route: "openai/gpt-6-astra", known: true, available: true },
			{ route: "fireworks/accounts/fireworks/routers/kimi-k3-fast", known: true, available: false },
			{ route: "anthropic/missing", known: false, available: false },
		],
	};
	const statusText = modelStatus.content.at(0);
	if (statusText === undefined || !("text" in statusText)) {
		throw new Error(`Unexpected in-session model status: ${JSON.stringify(modelStatus)}`);
	}
	if (
		JSON.stringify(modelStatus.details) !== JSON.stringify(expectedStatus) ||
		JSON.stringify(JSON.parse(statusText.text)) !== JSON.stringify(expectedStatus)
	) {
		throw new Error(`Unexpected in-session model status: ${JSON.stringify(modelStatus)}`);
	}
	for (const [path, content] of legacyFiles) {
		if (readFileSync(path, "utf8") !== content) {
			throw new Error(`Model inspection changed ${path}`);
		}
	}
	if (existsSync(join(cwd, ".pi", "prompts"))) {
		throw new Error("Model inspection migrated project commands");
	}
	const writePrompt = extensions.extensions.find(({ path }) =>
		path.endsWith("/extensions/write-prompt.ts"),
	);
	if (!writePrompt) {
		throw new Error("Write-prompt extension missing");
	}
	extensions.runtime.getCommands = () =>
		extensions.extensions.flatMap(({ commands }) =>
			[...commands.values()].map(({ name, description, sourceInfo }) => {
				const info: SlashCommandInfo = { name, source: "extension", sourceInfo };
				if (description !== undefined) {
					info.description = description;
				}
				return info;
			}),
		);
	extensions.runtime.getAllTools = () =>
		extensions.extensions.flatMap(({ tools }) =>
			[...tools.values()].map(({ definition, sourceInfo }) => {
				const info: ToolInfo = {
					name: definition.name,
					description: definition.description,
					parameters: definition.parameters,
					exposure: definition.exposure ?? "direct",
					sourceInfo,
				};
				if (definition.promptGuidelines !== undefined) {
					info.promptGuidelines = definition.promptGuidelines;
				}
				if (definition.reachesTools !== undefined) {
					info.reachesTools = definition.reachesTools;
				}
				return info;
			}),
		);
	extensions.runtime.getActiveTools = () => ["name_session"];
	extensions.runtime.getSessionName = (): undefined => undefined;
	const fastModeStart = fastMode.handlers.get("session_start")?.[0];
	if (!fastModeStart) {
		throw new Error("Fast-mode session_start handler missing");
	}
	const fastStatuses = new Map<string, string | undefined>();
	await fastModeStart(
		{},
		{
			model: { provider: "openai-codex", id: "gpt-6-astra", api: "openai-codex-responses" },
			sessionManager: SessionManager.inMemory(cwd),
			hasUI: false,
			ui: {
				setStatus: (key: string, value: string | undefined) => fastStatuses.set(key, value),
				theme: { fg: (_color: string, text: string) => text },
			},
		},
	);
	if (!fastStatuses.has("codex-fast")) {
		throw new Error("Fast-mode footer status missing for OpenAI models");
	}
	if (fastStatuses.get("anthropic-fast") !== undefined) {
		throw new Error("Fast-mode must clear the Anthropic status on OpenAI models");
	}
	const sessionNameStart = sessionName.handlers.get("session_start")?.[0];
	if (!sessionNameStart) {
		throw new Error("Session-name session_start handler missing");
	}
	await sessionNameStart({}, {});
	const toolNames = extensions.extensions
		.flatMap(({ tools }) => [...tools.values()].map(({ definition }) => definition.name))
		.sort();
	if (
		JSON.stringify(toolNames) !==
		JSON.stringify(["fitch_setup_models", "name_session", "reader_present"])
	) {
		throw new Error(`Unexpected kit tools: ${JSON.stringify(toolNames)}`);
	}
	const sessionContext = sessionName.handlers.get("before_agent_start")?.[0];
	if (!sessionContext) {
		throw new Error("Session-name startup handler missing");
	}
	const contextResult = await sessionContext({}, { sessionManager: SessionManager.inMemory(cwd) });
	const contextMessage = isRecord(contextResult) ? contextResult.message : undefined;
	if (
		!String(isRecord(contextMessage) ? contextMessage.content : undefined).includes(
			'"currentName":null',
		)
	) {
		throw new Error("Session-name context metadata missing");
	}
	const cleanFooterStart = cleanFooter.handlers.get("session_start")?.[0];
	if (!cleanFooterStart) {
		throw new Error("Clean-footer session_start handler missing");
	}
	let footerFactory: InstalledFooter | undefined;
	let footerNotice: string | undefined;
	// The command handler reassigns both through UI callbacks the type system
	// cannot track, so checks read through fresh calls instead of stale narrowing.
	const currentFactory = (): InstalledFooter | undefined => footerFactory;
	const currentNotice = (): string | undefined => footerNotice;
	const footerSession = SessionManager.inMemory(join(home, "Projects", "demo"));
	footerSession.appendSessionInfo("footer-smoke");
	for (const usage of [
		{ input: 20, cacheRead: 80 },
		{ input: 100, cacheRead: 0 },
	]) {
		const message = fauxAssistantMessage("footer smoke");
		footerSession.appendMessage({
			...message,
			usage: { ...message.usage, ...usage, totalTokens: 100 },
		});
	}
	const footerContext = {
		mode: "tui",
		hasUI: true,
		ui: {
			setFooter: (factory: InstalledFooter) => {
				footerFactory = factory;
			},
			notify: (message: string) => {
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
	const installedFooter = currentFactory();
	if (installedFooter === undefined) {
		throw new Error("Clean footer was not installed in TUI mode");
	}
	const statuses = new Map([
		["mcp", "MCP: 13 servers enabled (2 connected)"],
		["todo", "todo 0 active · 1 pending"],
		["verbosity", "🗣  medium"],
	]);
	const createFooter = () =>
		installedFooter(
			{
				requestRender: () => {
					return;
				},
			},
			{ fg: (_color: string, text: string) => text },
			{
				getGitBranch: () => "main",
				getAvailableProviderCount: () => 2,
				getExtensionStatuses: () => statuses,
				onBranchChange: () => () => {
					return;
				},
			},
		);
	const footer = createFooter();
	const wideFooter = footer.render(170);
	if (wideFooter.length !== 2) {
		throw new Error(`Expected two wide footer lines, got ${JSON.stringify(wideFooter)}`);
	}
	if (!wideFooter.join("\n").includes("🗣 medium")) {
		throw new Error(
			`Clean footer lost the controller's native verbosity status: ${wideFooter.join("\n")}`,
		);
	}
	const narrowFooter = footer.render(45);
	const narrowText = narrowFooter.join("\n");
	const normalizedNarrowText = narrowText.replace(/\s+/g, " ");
	if (narrowText.includes("...")) {
		throw new Error(`Clean footer truncated content: ${narrowText}`);
	}
	for (const hidden of ["↑", "↓", "$"]) {
		if (narrowText.includes(hidden)) {
			throw new Error(`Clean footer leaked cumulative counter ${hidden}`);
		}
	}
	for (const expected of [
		"footer-smoke",
		"(openai-codex) gpt-6-astra • high • 🗣 medium",
		"74.0%/272k • CH0.0%",
		"MCP: 13 servers enabled (2 connected)",
		"todo 0 active · 1 pending",
	]) {
		if (!normalizedNarrowText.includes(expected)) {
			throw new Error(`Clean footer lost ${expected}: ${narrowText}`);
		}
	}
	if (wideFooter.join("\n").split("🗣").length !== 2) {
		throw new Error("Verbosity status was rendered twice");
	}
	statuses.set("verbosity", "🗣  high");
	if (!footer.render(170).join("\n").includes("🗣 high")) {
		throw new Error("Footer did not follow updated native status");
	}
	statuses.delete("verbosity");
	if (footer.render(170).join("\n").includes("🗣")) {
		throw new Error("Footer read verbosity from stale config without the controller");
	}
	footer.dispose?.();

	const cleanFooterCommand = commandFor(drivenCommands(cleanFooter), "clean-footer");
	await cleanFooterCommand.handler("", footerContext);
	if (currentFactory() !== undefined || currentNotice() !== "Clean footer disabled") {
		throw new Error("Clean-footer command did not restore the built-in footer");
	}
	await cleanFooterCommand.handler("", footerContext);
	if (typeof currentFactory() !== "function" || currentNotice() !== "Clean footer enabled") {
		throw new Error("Clean-footer command did not restore the compact footer");
	}

	const commandNames = extensions.extensions.flatMap(({ commands }) => [...commands.keys()]).sort();
	const expectedCommands = [
		"ambitious",
		"anthropic-fast",
		"clean-footer",
		"codex-fast",
		"draft",
		"fast",
		"reader",
		"side-question",
		"ultrafast",
		"unreasonable",
		"xai-fast",
	];
	if (JSON.stringify(commandNames) !== JSON.stringify(expectedCommands)) {
		throw new Error(
			`Expected ${JSON.stringify(expectedCommands)}, got ${JSON.stringify(commandNames)}`,
		);
	}
	for (const event of ["before_provider_request"]) {
		const count = extensions.extensions.reduce(
			(total, extension) => total + (extension.handlers.get(event)?.length ?? 0),
			0,
		);
		if (count !== 1) {
			throw new Error(`Expected one ${event} handler, got ${count}`);
		}
	}

	console.log(
		JSON.stringify(
			{
				ok: true,
				prompts: promptNames,
				themes: themeNames,
				themeSchema: "native CLI accepted calm and rejected missing mdHeading",
				commands: commandNames,
				tools: toolNames,
				extensions: extensions.extensions.length,
			},
			null,
			2,
		),
	);
} finally {
	if (previousAgentDir === undefined) {
		delete process.env.PI_CODING_AGENT_DIR;
	} else {
		process.env.PI_CODING_AGENT_DIR = previousAgentDir;
	}
	if (previousHome === undefined) {
		delete process.env.HOME;
	} else {
		process.env.HOME = previousHome;
	}
	rmSync(temp, { recursive: true, force: true });
}
