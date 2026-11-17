#!/usr/bin/env node
// Optional host root: a scripted model issues real shell tool calls in an offline SDK session.
// The fixture model is the only stub; Pi's agent loop, bash, codemode, and the guard are real.
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import type {
	AgentSession,
	createAgentSession as CreateAgentSessionFn,
	DefaultResourceLoader,
	ExtensionFactory,
	ModelRegistry,
	ModelRuntime,
	SessionManager,
	SettingsManager,
} from "@earendil-works/pi-coding-agent";
import type { InMemoryCredentialStore } from "@earendil-works/pi-ai";
import { isRecord, jsonList, requireRecord } from "./test-harness.ts";

/** The host-selected Pi SDK surface this boundary regression drives. */
type HostSdk = {
	DefaultResourceLoader: typeof DefaultResourceLoader;
	ModelRuntime: typeof ModelRuntime;
	ModelRegistry: typeof ModelRegistry;
	SessionManager: typeof SessionManager;
	SettingsManager: typeof SettingsManager;
	createAgentSession: typeof CreateAgentSessionFn;
	createCodemodeExtension: () => ExtensionFactory;
};
const isHostSdk = (module: unknown): module is HostSdk =>
	typeof module === "object" &&
	module !== null &&
	"DefaultResourceLoader" in module &&
	"ModelRuntime" in module &&
	"ModelRegistry" in module &&
	"SessionManager" in module &&
	"SettingsManager" in module &&
	"createAgentSession" in module &&
	"createCodemodeExtension" in module;

/** Fitch Pi's detached shell tool as an SDK extension; official Pi has none. */
type BackgroundCommandSdk = { createBackgroundCommandExtension: () => ExtensionFactory };
const hasBackgroundCommand = (module: unknown): module is BackgroundCommandSdk =>
	typeof module === "object" &&
	module !== null &&
	"createBackgroundCommandExtension" in module &&
	typeof module.createBackgroundCommandExtension === "function";

/** The host-selected pi-ai surface the offline credential store needs. */
type HostAi = { InMemoryCredentialStore: typeof InMemoryCredentialStore };
const isHostAi = (module: unknown): module is HostAi =>
	typeof module === "object" &&
	module !== null &&
	"InMemoryCredentialStore" in module &&
	typeof module.InMemoryCredentialStore === "function";

const root = fileURLToPath(new URL("..", import.meta.url));
const host =
	process.argv[2] !== undefined
		? resolve(process.argv[2])
		: dirname(dirname(fileURLToPath(import.meta.resolve("@earendil-works/pi-coding-agent"))));
const aiRootBases = createRequire(join(host, "package.json")).resolve.paths(
	"@earendil-works/pi-ai",
);
if (aiRootBases === null) {
	throw new Error("could not resolve pi-ai from the host package");
}
const aiRoot = aiRootBases
	.map((base) => join(base, "@earendil-works/pi-ai"))
	.find((base) => existsSync(join(base, "package.json")));
if (aiRoot === undefined) {
	throw new Error("could not locate the host pi-ai package");
}
const temp = mkdtempSync(join(tmpdir(), "pi-backtick-guard-"));
const cwd = join(temp, "project");
mkdirSync(cwd);
process.env.PI_CODING_AGENT_DIR = temp;
process.env.PI_PACKAGE_DIR = host;
process.env.PI_OFFLINE = "1";
const originalFetch = globalThis.fetch;

const requests: Array<Record<string, unknown>> = [];
/** The tool call the fixture model issues on its next request. */
let scripted: { name: string; args: Record<string, unknown> } | undefined;
globalThis.fetch = async (
	url: Parameters<typeof fetch>[0],
	init: Parameters<typeof fetch>[1],
): Promise<Response> => {
	assert.equal(url, "https://guard.invalid/v1/responses", "no network may leave the fixture");
	if (init === undefined || typeof init.body !== "string") {
		throw new Error("fixture capture lost its request body");
	}
	requests.push(requireRecord(JSON.parse(init.body), "captured request"));
	const item: Record<string, unknown> =
		scripted === undefined
			? {
					id: `msg_${requests.length}`,
					type: "message",
					role: "assistant",
					status: "completed",
					content: [{ type: "output_text", text: "DONE", annotations: [] }],
				}
			: {
					type: "function_call",
					id: `fc_${requests.length}`,
					call_id: `call_${requests.length}`,
					name: scripted.name,
					arguments: JSON.stringify(scripted.args),
					status: "completed",
				};
	scripted = undefined;
	const events = [
		{
			type: "response.output_item.added",
			output_index: 0,
			item: { ...item, ...(item.type === "message" ? { content: [] } : { arguments: "" }) },
		},
		{ type: "response.output_item.done", output_index: 0, item },
		{
			type: "response.completed",
			response: {
				id: `resp_${requests.length}`,
				status: "completed",
				output: [item],
				usage: { input_tokens: 10, output_tokens: 2, total_tokens: 12 },
			},
		},
	];
	return new Response(
		events.map((event) => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join(""),
		{ headers: { "content-type": "text/event-stream" } },
	);
};

let session: AgentSession | undefined;
try {
	const sdk: unknown = await import(pathToFileURL(join(host, "dist/index.js")).href);
	if (!isHostSdk(sdk)) {
		throw new Error("host Pi SDK did not expose the expected session surface");
	}
	const ai: unknown = await import(pathToFileURL(join(aiRoot, "dist/index.js")).href);
	if (!isHostAi(ai)) {
		throw new Error("host pi-ai did not expose the credential store");
	}
	const runtime = await sdk.ModelRuntime.create({
		credentials: new ai.InMemoryCredentialStore(),
		modelsPath: null,
		allowModelNetwork: false,
		refreshOnCreate: false,
	});
	const registry = new sdk.ModelRegistry(runtime);
	registry.registerProvider("guard-boundary", {
		api: "openai-responses",
		baseUrl: "https://guard.invalid/v1",
		apiKey: "offline",
		models: [
			{
				id: "guard",
				name: "guard",
				reasoning: false,
				input: ["text"],
				contextWindow: 100000,
				maxTokens: 1000,
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
			},
		],
	});
	const model = registry.find("guard-boundary", "guard");
	if (model === undefined) {
		throw new Error("guard-boundary model missing");
	}
	const settingsManager = sdk.SettingsManager.inMemory({
		compaction: { enabled: false },
		retry: { enabled: false },
	});
	const loader = new sdk.DefaultResourceLoader({
		cwd,
		agentDir: temp,
		settingsManager,
		additionalExtensionPaths: [join(root, "extensions/backtick-guard.ts")],
		// The CLI loads these as built-in extensions; an SDK session adds them itself.
		extensionFactories: [
			sdk.createCodemodeExtension(),
			...(hasBackgroundCommand(sdk) ? [sdk.createBackgroundCommandExtension()] : []),
		],
		noExtensions: true,
		noSkills: true,
		noPromptTemplates: true,
		noThemes: true,
		noContextFiles: true,
	});
	await loader.reload();
	assert.deepEqual(loader.getExtensions().errors, []);
	const active = (
		await sdk.createAgentSession({
			cwd,
			agentDir: temp,
			model,
			modelRuntime: runtime,
			resourceLoader: loader,
			settingsManager,
			sessionManager: sdk.SessionManager.inMemory(cwd),
			tools: ["bash", "codemode", "background_command"],
		})
	).session;
	session = active;
	await active.bindExtensions({
		onError: (error) => {
			throw new Error(error.error);
		},
	});

	/** Issues one tool call as the model and returns the result text the model then receives. */
	const modelCalls = async (name: string, args: Record<string, unknown>): Promise<string> => {
		scripted = { name, args };
		await active.prompt(`call ${name}`);
		await active.waitForIdle();
		const result = jsonList(requireRecord(requests.at(-1), "follow-up request").input, "input")
			.filter(isRecord)
			.findLast((item) => item.type === "function_call_output");
		if (result === undefined) {
			throw new Error(`the model received no result for ${name}`);
		}
		return JSON.stringify(result.output);
	};
	const inProject = (name: string): string => join(cwd, name);
	/** The shape of the real incidents: prose with a code span inside a double-quoted argument. */
	const proseInDoubleQuotes = (marker: string, output: string): string =>
		`printf '%s' "the check reads \`touch ${marker}\` first" > ${output}`;
	const REFUSED = "Blocked: backtick command substitution";

	const direct = await modelCalls("bash", { command: proseInDoubleQuotes("direct-ran", "direct") });
	assert.ok(direct.includes(REFUSED), direct);
	assert.ok(direct.includes("`touch direct-ran`"), direct);
	assert.ok(!existsSync(inProject("direct-ran")), "the code span must not run");
	assert.ok(!existsSync(inProject("direct")), "no part of a refused command may run");
	console.log("PASS a direct bash call with a code span in double quotes is refused");

	const nested = await modelCalls("codemode", {
		code: `return await tools.bash({ command: ${JSON.stringify(proseInDoubleQuotes("nested-ran", "nested"))} });`,
	});
	assert.ok(nested.includes(REFUSED), nested);
	assert.ok(!existsSync(inProject("nested-ran")), "the code span must not run");
	assert.ok(!existsSync(inProject("nested")), "no part of a refused command may run");
	console.log("PASS a bash call from a codemode script is refused");

	const unreadable = await modelCalls("bash", {
		command: "touch before-syntax-error\necho 'it`s",
	});
	assert.ok(unreadable.includes("Blocked: unreadable command with a backtick"), unreadable);
	assert.ok(
		!existsSync(inProject("before-syntax-error")),
		"bash would run the line before the syntax error",
	);
	console.log("PASS a command the parser cannot read is refused when it has a backtick");

	const heredocText = "the check reads `touch heredoc-ran` first";
	await modelCalls("bash", { command: `cat <<'EOF' > heredoc\n${heredocText}\nEOF` });
	assert.equal(readFileSync(inProject("heredoc"), "utf8"), `${heredocText}\n`);
	await modelCalls("bash", {
		command: `printf '%s' "$(cat <<'EOF'\n${heredocText}\nEOF\n)" > substituted-heredoc`,
	});
	assert.equal(readFileSync(inProject("substituted-heredoc"), "utf8"), heredocText);
	assert.ok(!existsSync(inProject("heredoc-ran")), "a quoted heredoc keeps backticks literal");
	console.log("PASS backticks in a quoted heredoc run unchanged, also inside $(...)");

	if (hasBackgroundCommand(sdk)) {
		const background = await modelCalls("background_command", {
			action: "start",
			command: proseInDoubleQuotes("background-ran", "background"),
		});
		assert.ok(background.includes(REFUSED), background);
		assert.ok(!existsSync(inProject("background-ran")), "the code span must not run");
		console.log("PASS a background_command start is refused");
	}

	console.log(
		JSON.stringify({
			host,
			version: requireRecord(
				JSON.parse(readFileSync(join(host, "package.json"), "utf8")),
				"host package.json",
			).version,
			backgroundCommand: hasBackgroundCommand(sdk) ? "checked" : "host has no such tool",
			requests: requests.length,
			network: "fixture only",
		}),
	);
} finally {
	if (session !== undefined) {
		session.dispose();
	}
	globalThis.fetch = originalFetch;
	rmSync(temp, { recursive: true, force: true });
}
