import assert from "node:assert/strict";
import fs, {
	mkdirSync,
	mkdtempSync,
	readFileSync,
	renameSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { createRequire, syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { zstdDecompressSync } from "node:zlib";
import { mock } from "node:test";
import { normalizeContext, type Api, type Model } from "@earendil-works/pi-ai";

const agentDir = mkdtempSync(join(tmpdir(), "pi-kit-fast-mode-"));
process.on("exit", () => rmSync(agentDir, { recursive: true, force: true }));
process.env.PI_CODING_AGENT_DIR = agentDir;

// Keep one pass-through spy for the loaded extension's lifetime: Jiti may
// capture a builtin import, rather than follow later replacement functions.
const realWatch = fs.watch.bind(fs);
const openStateWatchers = new Set<fs.FSWatcher>();
const stateDirWatches = mock.method(
	fs,
	"watch",
	(
		filename: fs.PathLike,
		options?: fs.WatchOptions | BufferEncoding | null,
		listener?: fs.WatchListener<string>,
	): fs.FSWatcher => {
		assert(typeof options === "object" && options !== null && listener !== undefined);
		const watcher = realWatch(filename, options, (eventType, changed) => {
			listener(eventType, typeof changed === "string" ? changed : (changed?.toString() ?? null));
		});
		openStateWatchers.add(watcher);
		const realClose = watcher.close.bind(watcher);
		watcher.close = (): void => {
			openStateWatchers.delete(watcher);
			realClose();
		};
		return watcher;
	},
);
const toggleFileReads = mock.method(fs, "readFileSync");
syncBuiltinESMExports();
process.on("exit", () => {
	stateDirWatches.mock.restore();
	toggleFileReads.mock.restore();
	syncBuiltinESMExports();
});

const { fastRates } = await import("../extensions/fast-mode.ts");
import {
	commandFor,
	drivenCommands,
	drivenHandlers,
	handlerFor,
	requireRecord,
	soleExtension,
	type DrivenHandler,
} from "./test-harness.ts";
const { discoverAndLoadExtensions, SessionManager } =
	await import("@earendil-works/pi-coding-agent");
import type { ProviderConfig } from "@earendil-works/pi-coding-agent";
const defaultSession = SessionManager.inMemory(agentDir);
const loaded = await discoverAndLoadExtensions(
	[fileURLToPath(new URL("../extensions/fast-mode.ts", import.meta.url))],
	agentDir,
	agentDir,
);
assert.deepEqual(loaded.errors, []);
assert.equal(loaded.extensions.length, 1);

const extension = soleExtension(loaded);
const handlers = drivenHandlers(extension);
const commands = drivenCommands(extension);
/** The provider stream entry the wire capture drives. */
type StreamEntry = {
	api: string;
	streamSimple: NonNullable<ProviderConfig["streamSimple"]>;
};
const providers = new Map<string, StreamEntry>();
for (const { name, config } of loaded.runtime.pendingProviderRegistrations) {
	if (typeof config.api !== "string" || typeof config.streamSimple !== "function") {
		throw new Error(`incomplete provider registration: ${name}`);
	}
	providers.set(name, { api: config.api, streamSimple: config.streamSimple });
}
const flags = loaded.runtime.flagValues;

// The mandatory beta header can only survive pi-ai's last-write-wins client
// assembly via a fetch-time append, so Anthropic fast mode must be a scoped
// provider override, never a before_provider_headers write.
assert.equal(
	handlers.before_provider_headers,
	undefined,
	"the headers hook cannot preserve OAuth beta markers",
);
assert.deepEqual([...providers.keys()].sort(), ["anthropic", "cloudflare-ai-gateway"]);
for (const provider of providers.values()) {
	assert.equal(provider.api, "anthropic-messages");
	assert.equal(typeof provider.streamSimple, "function");
}
assert.equal(typeof handlerFor(handlers, "before_provider_request"), "function");
assert.deepEqual(Object.keys(commands).sort(), [
	"anthropic-fast",
	"codex-fast",
	"fast",
	"google-tier",
	"ultrafast",
	"xai-fast",
]);
assert.equal(flags.get("fast"), false, "--fast must default off");
assert.equal(flags.get("ultrafast"), false, "--ultrafast must default off");

assert.deepEqual(
	fastRates({ input: 15, output: 75, cacheRead: 1.5, cacheWrite: 18.75 }),
	{ input: 30, output: 150, cacheRead: 3, cacheWrite: 37.5 },
	"fast mode bills double, so reported rates must double",
);

const notices: string[] = [];
const status = new Map<string, string | undefined>();
const uiCtx = (model: unknown, sessionManager = defaultSession) => ({
	hasUI: true,
	model,
	sessionManager,
	ui: {
		notify: (message: string) => notices.push(message),
		setStatus: (key: string, value: string | undefined) => status.set(key, value),
		theme: { fg: (color: string, text: string) => `${color}:${text}` },
	},
});

// Wire-level capture through real pi-ai serialization: the registered override
// streams against a fake fetch, proving what an actual request would carry.
// Gateway fixtures use the real placeholder baseUrl shape plus resolved env,
// because the override replaces the wrapper that would otherwise resolve it.
const GATEWAY_PLACEHOLDER_URL =
	"https://gateway.ai.cloudflare.com/v1/{CLOUDFLARE_ACCOUNT_ID}/{CLOUDFLARE_GATEWAY_ID}/anthropic";
const GATEWAY_ENV = { CLOUDFLARE_ACCOUNT_ID: "acct-123", CLOUDFLARE_GATEWAY_ID: "gw-456" };
async function countToggleReads(
	request: () => Promise<FastRequestResult>,
): Promise<{ result: FastRequestResult; reads: number }> {
	const before = toggleFileReads.mock.callCount();
	const result = await request();
	return {
		result,
		reads: toggleFileReads.mock.calls
			.slice(before)
			.filter(({ arguments: [path] }) => path === join(agentDir, "anthropic-fast.json")).length,
	};
}

type FastRequestResult = { payload: Record<string, unknown> | undefined; beta: string[] };

async function fastRequest(
	provider: string,
	id: string,
	beta = "pi-existing-beta",
	extraOptions: Record<string, unknown> = {},
	modelOverride?: Model<Api>,
): Promise<FastRequestResult> {
	let payload: Record<string, unknown> | undefined;
	let headers = new Headers();
	let url: string | undefined;
	const gateway = provider === "cloudflare-ai-gateway";
	const provider_ = providers.get(provider);
	if (provider_ === undefined) {
		throw new Error(`no registered provider: ${provider}`);
	}
	const stream = provider_.streamSimple(
		modelOverride ?? {
			id,
			name: id,
			api: "anthropic-messages",
			provider,
			baseUrl: gateway ? GATEWAY_PLACEHOLDER_URL : "https://example.invalid",
			headers: { "anthropic-beta": beta },
			reasoning: true,
			input: ["text"],
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
			contextWindow: 300_000,
			maxTokens: 4096,
		},
		normalizeContext({ messages: [{ role: "user", content: "test", timestamp: 0 }] }),
		{
			apiKey: "test",
			maxRetries: 0,
			...(gateway ? { env: GATEWAY_ENV } : {}),
			...extraOptions,
			fetch: async (input: unknown, init: { headers?: HeadersInit; body?: unknown } = {}) => {
				url = String(input);
				headers = new Headers(init.headers);
				const raw = init.body;
				if (typeof raw === "string") {
					const parsed: unknown = JSON.parse(raw);
					payload = requireRecord(parsed, "captured payload");
				}
				throw new Error("payload captured");
			},
		},
	);
	for await (const _event of stream) {
		// Drain the capture abort.
	}
	// A prebuilt client never reaches the wrapped fetch, which is the point of that case.
	if (extraOptions.client === undefined) {
		if (payload === undefined) {
			throw new Error("an Anthropic request must be issued");
		}
		if (gateway) {
			if (url === undefined) {
				assert.fail("gateway endpoint placeholders must resolve for every request");
			}
			assert.ok(
				url.startsWith("https://gateway.ai.cloudflare.com/v1/acct-123/gw-456/anthropic"),
				`gateway endpoint placeholders must resolve for every request, got ${url}`,
			);
		}
	}
	return { payload, beta: (headers.get("anthropic-beta") ?? "").split(",") };
}

const anthropicOpusCtx = uiCtx({ provider: "anthropic", id: "claude-opus-5" });
const { result: offOpus, reads: defaultOffReads } = await countToggleReads(() =>
	fastRequest("anthropic", "claude-opus-5"),
);
assert.equal(
	defaultOffReads,
	1,
	"an eligible request reads the missing toggle once and defaults off",
);
assert.equal(offOpus.payload?.speed, undefined);
assert.deepEqual(offOpus.beta, ["pi-existing-beta"], "no fast beta while disabled");

const { anthropicProvider } = await import("@earendil-works/pi-ai/providers/anthropic");
const nativeOpus = anthropicProvider()
	.getModels()
	.find((model) => model.id === "claude-opus-4-8");
assert.ok(nativeOpus);
const nativeSonnet = anthropicProvider()
	.getModels()
	.find((model) => model.id === "claude-sonnet-4-6");
assert.ok(nativeSonnet);
const { cloudflareAIGatewayProvider } =
	await import("@earendil-works/pi-ai/providers/cloudflare-ai-gateway");
const gatewayProvider = cloudflareAIGatewayProvider();
const gatewaySonnet = gatewayProvider
	.getModels()
	.find((model) => ["claude-sonnet-4.6", "claude-sonnet-4-6"].includes(model.id));
assert.ok(gatewaySonnet);
for (const enabled of [false, true]) {
	writeFileSync(join(agentDir, "anthropic-fast.json"), JSON.stringify({ enabled }));
	for (const model of [nativeSonnet, gatewaySonnet]) {
		const { result, reads } = await countToggleReads(() =>
			fastRequest(
				model.provider,
				model.id,
				"pi-existing-beta",
				{},
				{ ...model, headers: { "anthropic-beta": "pi-existing-beta" } },
			),
		);
		console.log(
			JSON.stringify({ provider: model.provider, model: model.id, enabled, toggleReads: reads }),
		);
		assert.equal(reads, 0, "ineligible native Sonnet requests must not read the toggle");
		assert.equal(result.payload?.speed, undefined);
		assert.deepEqual(result.beta, ["pi-existing-beta"]);
	}
}
rmSync(join(agentDir, "anthropic-fast.json"));
const reasonedNoTools = await fastRequest(
	"anthropic",
	nativeOpus.id,
	"pi-existing-beta",
	{ reasoning: "high", toolChoice: "none" },
	nativeOpus,
);
assert.deepEqual(
	reasonedNoTools.payload?.thinking,
	{ type: "adaptive", display: "summarized" },
	"toolChoice must not suppress reasoning",
);
const ordinaryConfig = reasonedNoTools.payload.output_config;
assert.equal(
	typeof ordinaryConfig === "object" && ordinaryConfig !== null && "effort" in ordinaryConfig
		? ordinaryConfig.effort
		: undefined,
	"high",
);
assert.deepEqual(reasonedNoTools.payload.tool_choice, { type: "none" });

await commandFor(commands, "anthropic-fast").handler("on", anthropicOpusCtx);
assert.equal(
	requireRecord(
		JSON.parse(readFileSync(join(agentDir, "anthropic-fast.json"), "utf8")),
		"anthropic-fast state",
	).enabled,
	true,
);
assert.equal(notices.at(-1), "Anthropic fast mode ON");
const fastReasoned = await fastRequest(
	"anthropic",
	nativeOpus.id,
	"pi-existing-beta",
	{ reasoning: "high", toolChoice: "none" },
	nativeOpus,
);
const ordinaryReasoned = reasonedNoTools.payload;
assert.deepEqual(
	fastReasoned.payload,
	Object.assign({}, ordinaryReasoned, { speed: "fast" }),
	"fast must preserve the ordinary native payload except speed",
);
const fastConfig = fastReasoned.payload.output_config;
assert.equal(
	typeof fastConfig === "object" && fastConfig !== null && "effort" in fastConfig
		? fastConfig.effort
		: undefined,
	"high",
);
assert.deepEqual(fastReasoned.payload.tool_choice, { type: "none" });
// Direct route and gateway route get identical fast treatment.
for (const provider of ["anthropic", "cloudflare-ai-gateway"]) {
	for (const id of ["claude-opus-5-5", "claude-opus-5", "claude-opus-4-8"]) {
		const { result: fast, reads } = await countToggleReads(() => fastRequest(provider, id));
		assert.equal(reads, 1, "each eligible request must read one current toggle snapshot");
		assert.equal(fast.payload?.speed, "fast", `${provider}/${id} must request fast mode`);
		assert.deepEqual(
			fast.beta,
			["pi-existing-beta", "fast-mode-2026-02-01"],
			`${provider}/${id} must append the beta without dropping Pi's own markers`,
		);
	}
}
const preBeta = await fastRequest(
	"anthropic",
	"claude-opus-5",
	"pi-existing-beta,fast-mode-2026-02-01",
);
assert.deepEqual(preBeta.beta, ["pi-existing-beta", "fast-mode-2026-02-01"], "no duplicate beta");
const { result: unsupported, reads: unsupportedReads } = await countToggleReads(() =>
	fastRequest("cloudflare-ai-gateway", "claude-fable-5"),
);
assert.equal(unsupportedReads, 0, "ineligible gateway requests must not read the toggle");
assert.equal(unsupported.payload?.speed, undefined);
assert.deepEqual(
	unsupported.beta,
	["pi-existing-beta"],
	"no fast beta on models fast mode ignores",
);

const fullStreamOnly = await fastRequest("anthropic", "claude-opus-5", "pi-existing-beta", {
	toolChoice: "none",
});
const fullChoice = fullStreamOnly.payload?.tool_choice;
assert.equal(
	typeof fullChoice === "object" && fullChoice !== null && "type" in fullChoice
		? fullChoice.type
		: undefined,
	"none",
	"full-only options must survive",
);
const fullThinking = fullStreamOnly.payload?.thinking;
assert.notEqual(
	typeof fullThinking === "object" && fullThinking !== null && "type" in fullThinking
		? fullThinking.type
		: undefined,
	"disabled",
	"a full call without thinkingEnabled must not be recomputed by the simple path",
);

// The selected Pi host owns this SDK; it need not be hoisted into the kit.
const apiRequire = createRequire(import.meta.resolve("@earendil-works/pi-ai/compat"));
/** The host-selected Anthropic SDK constructor surface this regression uses. */
type AnthropicCtor = new (options: {
	apiKey: string;
	fetch: (input: unknown, init: { body?: unknown } | undefined) => Promise<never>;
}) => unknown;
const isAnthropicCtor = (module: unknown): module is { default: AnthropicCtor } =>
	typeof module === "object" &&
	module !== null &&
	"default" in module &&
	typeof module.default === "function";
const anthropicModule: unknown = await import(
	pathToFileURL(apiRequire.resolve("@anthropic-ai/sdk")).href
);
if (!isAnthropicCtor(anthropicModule)) {
	throw new Error("host Anthropic SDK did not expose a constructor");
}
const { default: Anthropic } = anthropicModule;
let clientPayload: Record<string, unknown> | undefined;
const { result: prebuilt, reads: clientReads } = await countToggleReads(() =>
	fastRequest("anthropic", "claude-opus-5", "pi-existing-beta", {
		client: new Anthropic({
			apiKey: "test",
			fetch: async (_input: unknown, init: { body?: unknown } | undefined) => {
				const raw = init?.body;
				if (typeof raw === "string") {
					const parsed: unknown = JSON.parse(raw);
					clientPayload = requireRecord(parsed, "client payload");
				}
				throw new Error("prebuilt client used");
			},
		}),
	}),
);
assert.equal(clientReads, 0, "a supplied client must not read the toggle");
assert.equal(prebuilt.payload, undefined, "a prebuilt client bypasses the wrapped fetch");
assert.ok(clientPayload, "the supplied client must actually receive the request");
assert.equal(
	clientPayload.speed,
	undefined,
	"never request fast mode when the beta header cannot be attached",
);

await commandFor(commands, "anthropic-fast").handler("off", anthropicOpusCtx);
assert.equal(notices.at(-1), "Anthropic fast mode OFF");
const { result: freshOff, reads: freshOffReads } = await countToggleReads(() =>
	fastRequest("anthropic", "claude-opus-5"),
);
assert.equal(
	freshOffReads,
	1,
	"the next eligible request must read current off state, not cache on",
);
assert.equal(freshOff.payload?.speed, undefined);
assert.deepEqual(freshOff.beta, ["pi-existing-beta"]);

// A toggle changed by the caller's payload hook only affects the next request.
writeFileSync(join(agentDir, "anthropic-fast.json"), JSON.stringify({ enabled: true }));
const { result: snapshot, reads: snapshotReads } = await countToggleReads(() =>
	fastRequest("anthropic", "claude-opus-5", "pi-existing-beta", {
		onPayload: () => {
			writeFileSync(join(agentDir, "anthropic-fast.json"), JSON.stringify({ enabled: false }));
		},
	}),
);
assert.equal(snapshotReads, 1);
assert.equal(snapshot.payload?.speed, "fast");
assert.deepEqual(snapshot.beta, ["pi-existing-beta", "fast-mode-2026-02-01"]);
assert.equal((await fastRequest("anthropic", "claude-opus-5")).payload?.speed, undefined);

const gatewayO3 = gatewayProvider.getModels().find(({ id }) => id === "o3");
assert.ok(gatewayO3, "the native gateway catalog must include o3");
const supportedGatewayIds = ["o3", "o3-2025-04-16", "o4-mini", "o4-mini-2025-04-16"];
const unsupportedGatewayIds = [
	"o1",
	"o1-pro",
	"o3-mini",
	"o3-pro",
	"o4-mini-deep-research",
	"o3-2025-04-16-extra",
	"o4-mini-2026-01-01",
	"workers-ai/@cf/openai/gpt-oss-120b",
	"workers-ai/@cf/openai/o3",
];
// Aliases use the native catalog. Snapshot/negative IDs exercise custom models,
// not invented catalog entries. No request leaves the fake fetch boundary.
const gatewayModel = (id: string) =>
	gatewayProvider.getModels().find((model) => model.id === id) ?? { ...gatewayO3, id };
async function gatewayPriorityRequest(id: string) {
	const model = gatewayModel(id);
	let payload: Record<string, unknown> | undefined;
	let url = "";
	const stream = gatewayProvider.streamSimple(
		model,
		normalizeContext({ messages: [{ role: "user", content: "test", timestamp: 0 }] }),
		{
			apiKey: "test",
			maxRetries: 0,
			env: GATEWAY_ENV,
			onPayload: (body) => requestPayload(model, body),
			fetch: async (input, init) => {
				if (typeof input === "string") {
					url = input;
				} else if (input instanceof URL) {
					url = input.href;
				}
				const raw = init?.body;
				if (typeof raw === "string") {
					const parsed: unknown = JSON.parse(raw);
					payload = requireRecord(parsed, "captured payload");
				}
				throw new Error("payload captured");
			},
		},
	);
	for await (const _event of stream) {
		/* Drain the capture abort. */
	}
	assert.ok(payload, `${id} must reach real provider serialization`);
	const endpoint =
		model.api === "openai-completions" ? "compat/chat/completions" : "openai/responses";
	assert.equal(url, `https://gateway.ai.cloudflare.com/v1/acct-123/gw-456/${endpoint}`);
	assert.equal(payload.model, id);
	return payload;
}

// OpenAI priority mode is provider-gated payload injection via the stock hook.
const requestPayload = async (
	model: unknown,
	payload: unknown = { model: "m" },
	sessionManager = defaultSession,
) => {
	let current = payload;
	let changed = false;
	for (const handler of handlers.before_provider_request ?? []) {
		const next = await handler({ payload: current }, { model, sessionManager });
		if (next !== undefined) {
			current = next;
			changed = true;
		}
	}
	return changed ? current : undefined;
};
const MODELS = {
	openai: { provider: "openai", id: "gpt-5.6-sol", api: "openai-responses" },
	codex: { provider: "openai-codex", id: "gpt-5.6-sol", api: "openai-codex-responses" },
	xai: { provider: "xai", id: "grok-4.6", api: "openai-completions" },
	gatewayGpt: { provider: "cloudflare-ai-gateway", id: "gpt-5.6-sol", api: "openai-responses" },
	gatewayGrok: { provider: "cloudflare-ai-gateway", id: "grok-4.6", api: "openai-responses" },
	anthropicOpus: { provider: "anthropic", id: "claude-opus-5", api: "anthropic-messages" },
	copilotOpus: { provider: "github-copilot", id: "claude-opus-5", api: "anthropic-messages" },
} as const;
for (const model of Object.values(MODELS)) {
	assert.equal(await requestPayload(model), undefined, "all payloads pass through while off");
}
await commandFor(commands, "codex-fast").handler("on", uiCtx(MODELS.openai));
assert.equal(notices.at(-1), "OpenAI priority requests ON");
for (const model of [MODELS.openai, MODELS.codex, MODELS.gatewayGpt]) {
	const fast = requireRecord(await requestPayload(model), "captured payload");
	assert.equal(
		fast.service_tier,
		"priority",
		`${model.provider}/${model.id} must request priority`,
	);
	assert.equal(fast.model, "m", "payload fields must survive");
}
assert.equal(
	await requestPayload(MODELS.anthropicOpus),
	undefined,
	"codex toggle must not touch Anthropic requests",
);
assert.equal(
	await requestPayload(MODELS.xai),
	undefined,
	"codex toggle must not touch xAI requests",
);
assert.equal(
	await requestPayload(MODELS.gatewayGrok),
	undefined,
	"codex toggle must not touch gateway Grok",
);
assert.equal(
	await requestPayload({
		provider: "cloudflare-ai-gateway",
		id: "workers-ai/@cf/openai/gpt-oss-120b",
		api: "openai-completions",
	}),
	undefined,
	"codex toggle must not touch namespaced workers-ai ids",
);
// The loaded hook, real gateway/Responses serializer, and footer must agree.
for (const enabled of [false, true]) {
	await commandFor(commands, "codex-fast").handler(enabled ? "on" : "off", uiCtx(MODELS.openai));
	for (const id of [...supportedGatewayIds, ...unsupportedGatewayIds]) {
		const priority = enabled && supportedGatewayIds.includes(id);
		const payload = await gatewayPriorityRequest(id);
		await handlerFor(handlers, "model_select")({}, uiCtx(gatewayModel(id)));
		assert.deepEqual(
			{ tier: payload.service_tier, footer: status.get("codex-fast") },
			{
				tier: priority ? "priority" : undefined,
				footer: priority ? "accent:priority enabled" : undefined,
			},
			`${id}, enabled=${enabled}`,
		);
		assert.equal(status.get("xai-fast"), undefined);
		assert.equal(status.get("anthropic-fast"), undefined);
	}
}
// Preserve the existing direct-provider gate, including models not enabled above.
for (const provider of ["openai", "openai-codex"]) {
	for (const id of ["o1", "o1-pro", "o3", "o3-mini", "o3-pro", "o4-mini"]) {
		const model = { provider, id };
		const payload = requireRecord(await requestPayload(model), "captured payload");
		assert.equal(payload.service_tier, "priority", `${provider}/${id} retains direct behavior`);
		await handlerFor(handlers, "model_select")({}, uiCtx(model));
		assert.equal(status.get("codex-fast"), "accent:priority enabled");
	}
}
for (const payload of [null, [], "raw"]) {
	assert.equal(
		await requestPayload(MODELS.openai, payload),
		undefined,
		"non-object payloads pass through",
	);
}
await commandFor(commands, "codex-fast").handler("off", uiCtx(MODELS.openai));
assert.equal(notices.at(-1), "OpenAI priority requests OFF");
await commandFor(commands, "fast").handler("", uiCtx(MODELS.openai));
assert.equal(
	notices.at(-1),
	"OpenAI priority requests ON",
	"/fast with no verb must retain toggle behavior",
);
await commandFor(commands, "fast").handler("off", uiCtx(MODELS.openai));
assert.equal(notices.at(-1), "OpenAI priority requests OFF");

await commandFor(commands, "xai-fast").handler("on", uiCtx(MODELS.xai));
assert.equal(notices.at(-1), "xAI fast mode ON");
const xaiFast = requireRecord(await requestPayload(MODELS.xai), "captured payload");
assert.equal(xaiFast.service_tier, "priority", "xai must request priority");
assert.equal(xaiFast.model, "m", "payload fields must survive");
const gatewayGrokFast = requireRecord(await requestPayload(MODELS.gatewayGrok), "captured payload");
assert.equal(gatewayGrokFast.service_tier, "priority", "gateway grok must request priority");
assert.equal(
	await requestPayload(MODELS.openai),
	undefined,
	"xai toggle must not touch OpenAI requests",
);
assert.equal(
	await requestPayload(MODELS.gatewayGpt),
	undefined,
	"xai toggle must not touch gateway GPT",
);
for (const id of supportedGatewayIds) {
	assert.equal(
		(await gatewayPriorityRequest(id)).service_tier,
		undefined,
		"xai toggle must not touch gateway o-series",
	);
	await handlerFor(handlers, "model_select")({}, uiCtx(gatewayModel(id)));
	assert.equal(status.get("codex-fast"), undefined);
	assert.equal(status.get("xai-fast"), undefined);
}
await commandFor(commands, "xai-fast").handler("off", uiCtx(MODELS.xai));

// Command verbs: toggle flips, status reports, invalid warns without a write.
await commandFor(commands, "codex-fast").handler("toggle", uiCtx(MODELS.openai));
assert.equal(notices.at(-1), "OpenAI priority requests ON");
await commandFor(commands, "codex-fast").handler("toggle", uiCtx(MODELS.openai));
assert.equal(notices.at(-1), "OpenAI priority requests OFF");
await commandFor(commands, "codex-fast").handler("status", uiCtx(MODELS.openai));
assert.equal(notices.at(-1), "OpenAI shared: off; session: inherit; effective: off.");
const codexState = readFileSync(join(agentDir, "openai-codex-fast.json"), "utf8");
await commandFor(commands, "codex-fast").handler("bogus", uiCtx(MODELS.openai));
assert.equal(notices.at(-1), "Usage: /codex-fast [on|off|toggle|status|ultrafast]");
assert.equal(readFileSync(join(agentDir, "openai-codex-fast.json"), "utf8"), codexState);

// A failed real file write is not an adopted memory-only toggle. The provider and
// status continue to read the file (including the existing off fallback on errors).
const statePath = join(agentDir, "openai-codex-fast.json");
renameSync(statePath, `${statePath}.saved`);
mkdirSync(statePath);
try {
	await assert.rejects(
		commandFor(commands, "codex-fast").handler("on", uiCtx(MODELS.openai)),
		/EISDIR/,
	);
	assert.equal(await requestPayload(MODELS.openai), undefined);
} finally {
	rmSync(statePath, { recursive: true });
	renameSync(`${statePath}.saved`, statePath);
}

// Footer: request policy only while enabled on an eligible model family, cleared while
// off and on models fast mode ignores, including non-overridden Opus proxies.
const statWatchers = () =>
	process.getActiveResourcesInfo().filter((resource) => resource === "StatWatcher").length;
const watcherBaseline = statWatchers();
const runHandlers = async (event: string, ...args: unknown[]): Promise<void> => {
	for (const handler of handlers[event] ?? []) {
		await handler(...args);
	}
};

const { openaiProvider } = await import("@earendil-works/pi-ai/providers/openai");
const { openaiCodexProvider } = await import("@earendil-works/pi-ai/providers/openai-codex");
const { openAIResponsesApi, openAICodexResponsesApi, openAICompletionsApi } =
	await import("@earendil-works/pi-ai/compat");
const astra = openaiProvider()
	.getModels()
	.find((model) => model.id === "gpt-6-astra");
const codexAstra = openaiCodexProvider()
	.getModels()
	.find((model) => model.id === "gpt-6-astra");
assert.ok(astra);
assert.ok(codexAstra);

async function openaiWireRequest(
	model: Model<Api>,
	selectedModel = model,
	sessionManager = defaultSession,
) {
	let payload: Record<string, unknown> | undefined;
	let api: ReturnType<typeof openAIResponsesApi>;
	if (model.api === "openai-codex-responses") {
		api = openAICodexResponsesApi();
	} else if (model.api === "openai-completions") {
		api = openAICompletionsApi();
	} else {
		api = openAIResponsesApi();
	}
	const stream = api.streamSimple(
		model,
		normalizeContext({ messages: [{ role: "user", content: "test", timestamp: 0 }] }),
		{
			apiKey: `synthetic.${Buffer.from(JSON.stringify({ "https://api.openai.com/auth": { chatgpt_account_id: "offline" } })).toString("base64")}.synthetic`,
			transport: "sse",
			maxRetries: 0,
			onPayload: (body) => requestPayload(selectedModel, body, sessionManager),
			fetch: async (_input, init) => {
				const raw = init?.body;
				let body: string | undefined;
				if (
					new Headers(init?.headers).get("content-encoding") === "zstd" &&
					raw instanceof Uint8Array
				) {
					body = zstdDecompressSync(raw).toString("utf8");
				} else if (typeof raw === "string") {
					body = raw;
				}
				if (body !== undefined) {
					const parsed: unknown = JSON.parse(body);
					payload = requireRecord(parsed, "captured payload");
				}
				throw new Error("payload captured");
			},
		},
	);
	for await (const _event of stream) {
		/* Drain the capture abort. */
	}
	assert.ok(payload, `${model.provider}/${model.id} must reach its native serializer`);
	return payload;
}

const rotatingSol = { ...astra, provider: "chatgpt-rotate", id: "gpt-6.1-sol" };
for (const enabled of [false, true]) {
	await commandFor(commands, "codex-fast").handler(enabled ? "on" : "off", uiCtx(rotatingSol));
	// The rotation provider delegates to native OpenAI while the session keeps its own provider ID.
	const payload = await openaiWireRequest({ ...rotatingSol, provider: "openai" }, rotatingSol);
	assert.equal(payload.service_tier, enabled ? "priority" : undefined);
	assert.equal(payload.model, "gpt-6.1-sol");
	assert.equal(status.get("codex-fast"), enabled ? "accent:priority enabled" : undefined);
}

// One mode in the existing file: legacy ON stays priority; explicit Ultrafast
// reaches real Responses/Codex serialization without adding a provider override.
writeFileSync(statePath, JSON.stringify({ enabled: true }));
assert.equal((await openaiWireRequest(astra)).service_tier, "priority");
const legacyState = readFileSync(statePath, "utf8");
await commandFor(commands, "codex-fast").handler("ultrafast", uiCtx(MODELS.openai));
assert.equal(
	readFileSync(statePath, "utf8"),
	legacyState,
	"unsupported activation must preserve the selected mode",
);
assert.match(notices.at(-1) ?? "", /No mode was changed/);
await commandFor(commands, "codex-fast").handler("ultrafast", uiCtx(astra));
assert.deepEqual(JSON.parse(readFileSync(statePath, "utf8")), { enabled: true, tier: "ultrafast" });
assert.match(notices.at(-1) ?? "", /6x API\/credit price; 8x Codex included usage/);
const selectedUltraState = readFileSync(statePath, "utf8");
await commandFor(commands, "codex-fast").handler("", uiCtx(astra));
assert.equal(
	readFileSync(statePath, "utf8"),
	selectedUltraState,
	"blank /codex-fast remains a status query",
);
for (const model of [astra, codexAstra, { ...astra, baseUrl: "https://us.api.openai.com/v1/" }]) {
	assert.equal((await openaiWireRequest(model)).service_tier, "ultrafast");
	await runHandlers("model_select", {}, uiCtx(model));
	assert.equal(status.get("codex-fast"), "accent:ultrafast requested");
}
for (const model of [
	{ ...astra, id: "gpt-5.6-sol" },
	{ ...astra, id: "gpt-6.1-sol" },
	{ ...astra, id: "gpt-6-astra-extra" },
	{ ...astra, api: "openai-completions" as const },
	{ ...astra, provider: "cloudflare-ai-gateway" },
	{ ...astra, provider: "opencode" },
	{ ...astra, provider: "chatgpt-rotate" },
	{ ...astra, baseUrl: "https://eu.api.openai.com/v1" },
	{ ...astra, baseUrl: "https://proxy.invalid/v1" },
]) {
	assert.equal(
		(await openaiWireRequest(model)).service_tier,
		undefined,
		"unsupported routes must not fall back to priority",
	);
	await runHandlers("model_select", {}, uiCtx(model));
	assert.equal(status.get("codex-fast"), "warning:ultrafast unavailable");
}
assert.equal(
	(await openaiWireRequest({ ...astra, id: "gpt-5.6-sol" }, astra)).service_tier,
	undefined,
	"serialized model must match, even when the selected model is Astra",
);
for (const payload of [null, [], "raw", { model: "gpt-6-astra-extra" }]) {
	assert.equal(await requestPayload(astra, payload), undefined);
}
await commandFor(commands, "fast").handler("", uiCtx(astra));
assert.equal(notices.at(-1), "OpenAI ultrafast requests OFF");
assert.equal((await openaiWireRequest(astra)).service_tier, undefined);
await commandFor(commands, "fast").handler("", uiCtx(astra));
assert.equal(
	(await openaiWireRequest(astra)).service_tier,
	"priority",
	"/fast must never implicitly enable Ultrafast",
);
await commandFor(commands, "codex-fast").handler("ultrafast", uiCtx(astra));
await commandFor(commands, "codex-fast").handler("on", uiCtx(astra));
assert.equal(
	(await openaiWireRequest(astra)).service_tier,
	"priority",
	"on explicitly returns to priority",
);
for (const content of ['{"enabled":true,"tier":"unknown"}', "null", "{broken"]) {
	writeFileSync(statePath, content);
	assert.equal((await openaiWireRequest(astra)).service_tier, undefined);
	await commandFor(commands, "codex-fast").handler("status", uiCtx(astra));
	assert.equal(notices.at(-1), "OpenAI shared: off; session: inherit; effective: off.");
}

// Real native session storage owns overrides; shared commands never clear them.
// Existing persisted sessions are used because Pi defers a new session's first
// disk flush until it has an assistant message.
const sessionA = SessionManager.create(agentDir, join(agentDir, "sessions"));
sessionA.appendMessage({
	role: "assistant",
	content: [{ type: "text", text: "offline fixture" }],
	api: astra.api,
	provider: astra.provider,
	model: astra.id,
	usage: {
		input: 0,
		output: 0,
		cacheRead: 0,
		cacheWrite: 0,
		totalTokens: 0,
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
	},
	stopReason: "stop",
	timestamp: 0,
});
const sessionB = SessionManager.inMemory(agentDir);
const localCommand = async (args: string, sessionManager = sessionA, model: unknown = astra) => {
	// Same native append binding used by AgentSession, not a fake persistence store.
	loaded.runtime.appendEntry = (type, data) => {
		sessionManager.appendCustomEntry(type, data);
	};
	await commandFor(commands, "ultrafast").handler(args, uiCtx(model, sessionManager));
};
await commandFor(commands, "codex-fast").handler("on", uiCtx(astra));
const sharedPriority = readFileSync(statePath, "utf8");
await localCommand("on --session");
assert.equal(
	readFileSync(statePath, "utf8"),
	sharedPriority,
	"session activation must not write shared state",
);
assert.equal((await openaiWireRequest(astra, astra, sessionA)).service_tier, "ultrafast");
assert.equal(
	(await openaiWireRequest(astra, astra, sessionB)).service_tier,
	"priority",
	"another session keeps the shared tier",
);
assert.equal(status.get("codex-fast"), "accent:session ultrafast requested");
const tierNotice = notices.at(-1);
assert.ok(tierNotice !== undefined, "expected a tier status notice");
assert.match(tierNotice, /shared: priority; session: ultrafast; effective: ultrafast/);
const sessionFile = sessionA.getSessionFile();
assert.ok(sessionFile !== undefined && sessionFile !== "", "expected a session file");
const resumed = SessionManager.open(sessionFile);
assert.equal(
	(await openaiWireRequest(codexAstra, codexAstra, resumed)).service_tier,
	"ultrafast",
	"same-ID resume restores the override",
);
const reloaded = await discoverAndLoadExtensions(
	[fileURLToPath(new URL("../extensions/fast-mode.ts", import.meta.url))],
	agentDir,
	agentDir,
);
assert.deepEqual(reloaded.errors, []);
const reloadedHook = handlerFor(drivenHandlers(soleExtension(reloaded)), "before_provider_request");
assert.equal(
	requireRecord(
		await reloadedHook(
			{ type: "before_provider_request", payload: { model: astra.id } },
			uiCtx(astra, resumed),
		),
		"tier payload",
	).service_tier,
	"ultrafast",
	"a fresh factory reads persisted metadata",
);
const forked = SessionManager.forkFrom(sessionFile, agentDir, join(agentDir, "sessions"));
assert.notEqual(forked.getSessionId(), sessionA.getSessionId());
assert.equal(
	(await openaiWireRequest(astra, astra, forked)).service_tier,
	"priority",
	"copied fork entries do not copy the override",
);
assert.equal(
	sessionA.buildSessionContext().messages.length,
	1,
	"policy metadata stays out of model context",
);
const firstEntry = sessionA.getEntries()[0];
assert.ok(firstEntry);
sessionA.branch(firstEntry.id);
assert.equal(
	(await openaiWireRequest(astra, astra, sessionA)).service_tier,
	"ultrafast",
	"/tree cannot silently retier the same session",
);
await commandFor(commands, "fast").handler("off", uiCtx(astra, sessionA));
assert.equal(
	(await openaiWireRequest(astra, astra, sessionA)).service_tier,
	"ultrafast",
	"global off preserves explicit session on",
);
assert.equal((await openaiWireRequest(astra, astra, sessionB)).service_tier, undefined);
assert.match(notices.at(-1) ?? "", /shared: off; session: ultrafast; effective: ultrafast/);
await localCommand("off --session");
assert.equal(status.get("codex-fast"), "muted:session OpenAI tiers off");
for (const model of [MODELS.anthropicOpus, MODELS.xai]) {
	await runHandlers("model_select", {}, uiCtx(model, sessionA));
	assert.equal(
		status.get("codex-fast"),
		undefined,
		"local OpenAI off must not label other providers as off",
	);
}
await commandFor(commands, "ultrafast").handler("", uiCtx(astra));
assert.equal(
	(await openaiWireRequest(astra, astra, sessionA)).service_tier,
	undefined,
	"session off wins over shared Ultrafast",
);
assert.equal(
	(await openaiWireRequest(astra, astra, sessionB)).service_tier,
	"ultrafast",
	"blank /ultrafast changes shared mode",
);
await localCommand("status --session");
assert.match(notices.at(-1) ?? "", /shared: ultrafast; session: off; effective: off/);
await localCommand("reset --session", sessionA, MODELS.openai);
assert.equal(
	(await openaiWireRequest(astra, astra, sessionA)).service_tier,
	"ultrafast",
	"reset resumes the current shared tier even from an unsupported route",
);
await localCommand("--session");
assert.equal(
	(await openaiWireRequest(astra, astra, sessionA)).service_tier,
	undefined,
	"session toggle disables inherited Ultrafast",
);
await commandFor(commands, "codex-fast").handler("on", uiCtx(astra));
assert.equal(
	(await openaiWireRequest(astra, astra, sessionA)).service_tier,
	undefined,
	"session off also suppresses kit priority",
);
await localCommand("toggle --session");
assert.equal((await openaiWireRequest(astra, astra, sessionA)).service_tier, "ultrafast");
await runHandlers("model_select", {}, uiCtx(MODELS.openai, sessionA));
assert.equal(status.get("codex-fast"), "warning:session ultrafast unavailable");
const beforeInvalid = readFileSync(sessionFile, "utf8");
const beforeInvalidShared = readFileSync(statePath, "utf8");
for (const args of ["reset", "on off", "on --session --session", "on --unknown"]) {
	await localCommand(args);
	assert.match(notices.at(-1) ?? "", /^Usage:/);
}
await localCommand("on --session", sessionA, MODELS.openai);
assert.match(notices.at(-1) ?? "", /No mode was changed/);
assert.equal(
	readFileSync(sessionFile, "utf8"),
	beforeInvalid,
	"invalid activation cannot persist an override",
);
assert.equal(readFileSync(statePath, "utf8"), beforeInvalidShared);
await localCommand("reset --session");
await commandFor(commands, "ultrafast").handler("toggle", uiCtx(astra));
assert.equal(
	(await openaiWireRequest(astra)).service_tier,
	"ultrafast",
	"global toggle from priority selects Ultrafast",
);
await commandFor(commands, "ultrafast").handler("toggle", uiCtx(astra));
assert.equal((await openaiWireRequest(astra)).service_tier, undefined);

// Startup validation refuses ambiguous or unsupported activation and blocks
// prompts until an explicit mode command recovers, without changing shared state.
await commandFor(commands, "codex-fast").handler("ultrafast", uiCtx(astra));
const ultraState = readFileSync(statePath, "utf8");
flags.set("fast", true);
flags.set("ultrafast", true);
await runHandlers("session_start", { reason: "startup" }, uiCtx(astra));
assert.equal(readFileSync(statePath, "utf8"), ultraState);
assert.deepEqual(await handlerFor(handlers, "input")({}, uiCtx(astra)), { action: "handled" });
assert.equal(
	await handlerFor(handlers, "input")({ source: "extension" }, uiCtx(astra)),
	undefined,
	"startup recovery must not swallow intercom or extension-delivered input",
);
const recreatedInputs: DrivenHandler[] = [];
for (const reason of ["reload", "new", "resume", "fork"] as const) {
	const fresh = await discoverAndLoadExtensions(
		[fileURLToPath(new URL("../extensions/fast-mode.ts", import.meta.url))],
		agentDir,
		agentDir,
	);
	assert.deepEqual(fresh.errors, []);
	for (const [name, value] of flags) {
		fresh.runtime.flagValues.set(name, value);
	}
	const freshHandlers = drivenHandlers(soleExtension(fresh));
	await handlerFor(freshHandlers, "session_start")({ reason }, uiCtx(astra));
	assert.deepEqual(
		await handlerFor(freshHandlers, "input")({ source: "interactive" }, uiCtx(astra)),
		{ action: "handled" },
		`${reason} must not bypass unresolved startup validation`,
	);
	recreatedInputs.push(handlerFor(freshHandlers, "input"));
	await handlerFor(freshHandlers, "session_shutdown")({}, uiCtx(astra));
}
await commandFor(commands, "codex-fast").handler("off", uiCtx(astra));
assert.equal(await handlerFor(handlers, "input")({}, uiCtx(astra)), undefined);
for (const input of recreatedInputs) {
	assert.equal(
		await input({ source: "interactive" }, uiCtx(astra)),
		undefined,
		"an explicit mode command resolves the process-wide startup error",
	);
}
flags.set("fast", false);
const offState = readFileSync(statePath, "utf8");
await runHandlers("session_start", { reason: "startup" }, uiCtx(MODELS.openai));
assert.equal(readFileSync(statePath, "utf8"), offState);
assert.deepEqual(await handlerFor(handlers, "input")({}, uiCtx(MODELS.openai)), {
	action: "handled",
});
await commandFor(commands, "codex-fast").handler("off", uiCtx(MODELS.openai));
await runHandlers("session_start", { reason: "startup" }, uiCtx(astra));
assert.equal(
	(await openaiWireRequest(astra)).service_tier,
	"ultrafast",
	"--ultrafast must select the explicit shared tier",
);
assert.match(
	notices.at(-1) ?? "",
	/6x API\/credit price; 8x Codex included usage/,
	"startup activation must show billing and entitlement",
);
for (const reason of ["reload", "resume"]) {
	await runHandlers("session_start", { reason }, uiCtx(astra));
	assert.match(
		notices.at(-1) ?? "",
		/6x API\/credit price; 8x Codex included usage/,
		`${reason} must announce restored Ultrafast policy`,
	);
}
await localCommand("off --session");
const noticeCount = notices.length;
await runHandlers("session_start", { reason: "startup" }, uiCtx(astra, sessionA));
assert.equal(
	notices.length,
	noticeCount + 1,
	"shared startup activation must warn even when this session is off",
);
assert.match(
	notices.at(-1) ?? "",
	/shared: ultrafast; session: off; effective: off.*6x API\/credit price/,
);
await localCommand("reset --session");
await commandFor(commands, "codex-fast").handler("off", uiCtx(astra));
for (const reason of ["reload", "new", "resume", "fork"]) {
	await runHandlers("session_start", { reason }, uiCtx(astra));
	assert.equal(
		(await openaiWireRequest(astra)).service_tier,
		undefined,
		`${reason} must not reapply --ultrafast`,
	);
}
flags.set("ultrafast", false);

const gatewayOpus = {
	provider: "cloudflare-ai-gateway",
	id: "claude-opus-5",
	api: "anthropic-messages",
};
flags.set("fast", true);
await runHandlers("session_start", { reason: "startup" }, uiCtx(gatewayOpus));
assert.equal(
	requireRecord(
		JSON.parse(readFileSync(join(agentDir, "openai-codex-fast.json"), "utf8")),
		"codex-fast state",
	).enabled,
	true,
	"--fast must enable shared OpenAI fast state",
);
await commandFor(commands, "codex-fast").handler("off", uiCtx(gatewayOpus));
for (const reason of ["reload", "new", "resume", "fork"]) {
	await runHandlers("session_start", { reason }, uiCtx(MODELS.openai));
	assert.equal(
		requireRecord(JSON.parse(readFileSync(statePath, "utf8")), "fast state").enabled,
		false,
		`${reason} must preserve explicit fast off despite --fast`,
	);
	assert.equal(
		await requestPayload(MODELS.openai),
		undefined,
		`${reason} must not restore priority requests`,
	);
	assert.equal(status.get("codex-fast"), undefined, `${reason} must leave the fast footer off`);
}
flags.set("fast", false);
assert.equal(status.get("anthropic-fast"), undefined, "no footer while off");
assert.equal(status.get("codex-fast"), undefined);
await commandFor(commands, "anthropic-fast").handler("on", uiCtx(gatewayOpus));
assert.equal(status.get("anthropic-fast"), "accent:fast");
await runHandlers("model_select", {}, uiCtx(MODELS.copilotOpus));
assert.equal(
	status.get("anthropic-fast"),
	undefined,
	"no footer on Opus routes the override does not cover",
);
await runHandlers("model_select", {}, uiCtx(MODELS.openai));
assert.equal(status.get("anthropic-fast"), undefined);
assert.equal(status.get("codex-fast"), undefined);
assert.equal(status.get("xai-fast"), undefined);
await runHandlers("model_select", {}, uiCtx(MODELS.xai));
assert.equal(status.get("codex-fast"), undefined);
assert.equal(status.get("xai-fast"), undefined);

// History size must not multiply repeated request/status work, including a missing override.
for (const count of [781, 43_000]) {
	const manager = SessionManager.inMemory(agentDir);
	for (let i = 0; i < count; i++) {
		manager.appendCustomEntry("history-fixture", {});
	}
	const entries = mock.method(manager, "getEntries");
	await runHandlers("session_start", { reason: "resume" }, uiCtx(astra, manager));
	assert.equal(entries.mock.callCount(), 1, "Session policy bootstraps once");
	entries.mock.resetCalls();
	for (let i = 0; i < 100; i++) {
		await requestPayload(astra, { model: astra.id }, manager);
		await runHandlers("model_select", {}, uiCtx(astra, manager));
	}
	assert.equal(entries.mock.callCount(), 0, "Requests/status retain known-absent session policy");
	const before = readFileSync(statePath, "utf8");
	writeFileSync(statePath, JSON.stringify({ enabled: true, tier: "ultrafast" }));
	assert.equal(
		requireRecord(await requestPayload(astra, { model: astra.id }, manager), "captured payload")
			.service_tier,
		"ultrafast",
		"Shared billing policy is still read on the next request",
	);
	writeFileSync(statePath, before);
	console.log(
		JSON.stringify({
			historyEntries: count,
			bootstrapReads: 1,
			unchangedRequestAndStatusReads: entries.mock.callCount(),
		}),
	);
	entries.mock.restore();
}

// Google tiers use the host's real SDK serializer, not OpenAI's service_tier shape.
const { googleGenerativeAIApi } = await import("@earendil-works/pi-ai/compat");
const googleApi = googleGenerativeAIApi();
const googleCarbon: Model<"google-generative-ai"> = {
	id: "gemini-4-carbon",
	name: "Gemini 4 Carbon",
	provider: "google",
	api: "google-generative-ai",
	baseUrl: "https://generativelanguage.googleapis.com/v1beta",
	reasoning: true,
	input: ["text"],
	contextWindow: 400_000,
	maxTokens: 32768,
	cost: { input: 2, output: 10, cacheRead: 0.1, cacheWrite: 0 },
};
const gatewayGoogle = {
	...googleCarbon,
	baseUrl: "https://gateway.ai.cloudflare.com/v1/acct-123/gw-456/google-ai-studio/v1beta",
};
const googleStatePath = join(agentDir, "google-tier.json");
async function googleWireRequest(model: typeof googleCarbon) {
	let payload: Record<string, unknown> | undefined;
	let errorMessage: string | undefined;
	const capture = mock.method(globalThis, "fetch", async (_input: unknown, init?: RequestInit) => {
		const body = init?.body;
		assert.ok(typeof body === "string");
		payload = requireRecord(JSON.parse(body), "Google wire payload");
		throw new Error("payload captured");
	});
	const stream = googleApi.streamSimple(
		model,
		normalizeContext({ messages: [{ role: "user", content: "test", timestamp: 0 }] }),
		{
			apiKey: "test",
			maxRetries: 0,
			onPayload: (body) => requestPayload(model, body),
		},
	);
	try {
		for await (const event of stream) {
			if (event.type === "error") {
				errorMessage = event.error.errorMessage;
			}
		}
	} finally {
		capture.mock.restore();
	}
	assert.ok(
		payload,
		`Google request must reach its native serializer: ${errorMessage ?? "unknown"}`,
	);
	return payload;
}
assert.equal((await googleWireRequest(gatewayGoogle)).serviceTier, undefined);
await commandFor(commands, "google-tier").handler("", uiCtx(gatewayGoogle));
assert.match(notices.at(-1) ?? "", /Google shared requests: standard/);
assert.equal(fs.existsSync(googleStatePath), false, "status must not opt in or create state");
for (const tier of ["priority", "flex", "standard"]) {
	await commandFor(commands, "google-tier").handler(tier, uiCtx(gatewayGoogle));
	assert.deepEqual(JSON.parse(readFileSync(googleStatePath, "utf8")), { tier });
	for (const model of [googleCarbon, gatewayGoogle]) {
		const payload = await googleWireRequest(model);
		assert.equal(payload.serviceTier, tier, "the SDK must serialize the chosen Google tier");
		assert.equal(payload.service_tier, undefined, "Google must not receive OpenAI fields");
		assert.deepEqual(payload.contents, [{ parts: [{ text: "test" }], role: "user" }]);
	}
	assert.equal(status.get("google-tier"), `accent:Google ${tier} requested`);
	const saved = readFileSync(googleStatePath, "utf8");
	for (const args of ["", "status", "batch", "priority flex", "on", "flex --session"]) {
		await commandFor(commands, "google-tier").handler(args, uiCtx(gatewayGoogle));
		assert.equal(readFileSync(googleStatePath, "utf8"), saved);
	}
}
await commandFor(commands, "google-tier").handler("flex", uiCtx(gatewayGoogle));
for (const model of [
	MODELS.openai,
	{ ...googleCarbon, provider: "google-vertex", api: "google-vertex" },
	{ ...googleCarbon, provider: "custom-google-proxy" },
]) {
	assert.equal(await requestPayload(model, { model: googleCarbon.id, config: {} }), undefined);
	await runHandlers("model_select", {}, uiCtx(model));
	assert.equal(status.get("google-tier"), undefined);
}
await runHandlers("model_select", {}, uiCtx(gatewayGoogle));
assert.equal(status.get("google-tier"), "accent:Google flex requested");
await commandFor(commands, "google-tier").handler("status", uiCtx(MODELS.openai));
assert.match(notices.at(-1) ?? "", /inactive on this model/);
const anotherFactory = await discoverAndLoadExtensions(
	[fileURLToPath(new URL("../extensions/fast-mode.ts", import.meta.url))],
	agentDir,
	agentDir,
);
assert.deepEqual(anotherFactory.errors, []);
await commandFor(drivenCommands(soleExtension(anotherFactory)), "google-tier").handler(
	"status",
	uiCtx(gatewayGoogle),
);
assert.match(notices.at(-1) ?? "", /Google shared requests: flex/);
writeFileSync(googleStatePath, JSON.stringify({ tier: "priority" }));
assert.equal((await googleWireRequest(gatewayGoogle)).serviceTier, "priority");
for (const content of ['{"tier":"batch"}', "null", "{broken"]) {
	writeFileSync(googleStatePath, content);
	assert.equal((await googleWireRequest(gatewayGoogle)).serviceTier, undefined);
}
rmSync(googleStatePath);
mkdirSync(googleStatePath);
try {
	await assert.rejects(
		commandFor(commands, "google-tier").handler("priority", uiCtx(gatewayGoogle)),
		/EISDIR/,
	);
	assert.equal((await googleWireRequest(gatewayGoogle)).serviceTier, undefined);
} finally {
	rmSync(googleStatePath, { recursive: true });
}

// Event-driven directory watching must use zero StatWatcher pollers while active,
// react to external shared-file edits, ignore unrelated agentDir writes, and stop on shutdown.
const sleep = (ms: number): Promise<void> =>
	new Promise<void>((resolve) => {
		setTimeout(resolve, ms);
	});
const waitFor = async (predicate: () => boolean, timeoutMs = 1500): Promise<void> => {
	const deadline = Date.now() + timeoutMs;
	while (!predicate()) {
		if (Date.now() >= deadline) {
			assert.fail("timed out waiting for event-driven footer refresh");
		}
		await sleep(15);
	}
};
writeFileSync(join(agentDir, "anthropic-fast.json"), JSON.stringify({ enabled: false }));
await runHandlers("session_start", {}, uiCtx(gatewayOpus));
await runHandlers("session_start", {}, uiCtx(gatewayOpus));
assert.equal(
	openStateWatchers.size,
	1,
	"repeated session_start must close the previous FSWatcher instead of stacking handles",
);
assert.equal(statWatchers(), watcherBaseline, "UI sessions must not start StatWatcher pollers");
assert.equal(status.get("anthropic-fast"), undefined);
writeFileSync(join(agentDir, "anthropic-fast.json"), JSON.stringify({ enabled: true }));
await waitFor(() => status.get("anthropic-fast") === "accent:fast");
await runHandlers("model_select", {}, uiCtx(gatewayGoogle));
assert.equal(status.get("google-tier"), undefined);
writeFileSync(googleStatePath, JSON.stringify({ tier: "flex" }));
await waitFor(() => status.get("google-tier") === "accent:Google flex requested");
const readsBeforeUnrelated = toggleFileReads.mock.callCount();
writeFileSync(join(agentDir, "unrelated-note.json"), "{}\n");
await sleep(60);
assert.equal(
	toggleFileReads.mock.callCount(),
	readsBeforeUnrelated,
	"unrelated agentDir writes must not re-read shared tier files",
);
await runHandlers("session_start", {}, { ...uiCtx(gatewayGoogle), hasUI: false });
assert.equal(openStateWatchers.size, 0, "headless session_start must close open FSWatchers");
await runHandlers("session_start", {}, uiCtx(gatewayGoogle));
assert.equal(openStateWatchers.size, 1, "UI session_start must open one FSWatcher");
await runHandlers("session_shutdown", {}, uiCtx(gatewayOpus));
assert.equal(openStateWatchers.size, 0, "session_shutdown must close the active FSWatcher handle");
assert.equal(statWatchers(), watcherBaseline, "session shutdown must release state-file watchers");

console.log(
	JSON.stringify({
		ok: true,
		anthropicFast: "wire-verified on direct+gateway opus",
		betaHeader: "fetch-time append preserves existing markers",
		prebuiltClient: "stays standard speed",
		openaiFast:
			"native registered hook + gateway Responses wire: supported o3/o4-mini aliases/snapshots only",
		openaiUltrafast:
			"native Astra Responses/Codex wire; shared and session overrides; resume/reload/tree/fork isolation; explicit startup policy",
		xaiFast: "provider-gated priority",
		googleTiers: "native Google SDK wire on direct and gateway routes; persisted shared state",
		footer: "eligibility-scoped incl. proxy exclusion",
		watchers: "released",
	}),
);
