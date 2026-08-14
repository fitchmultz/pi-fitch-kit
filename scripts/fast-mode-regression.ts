import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const agentDir = mkdtempSync(join(tmpdir(), "pi-kit-fast-mode-"));
process.on("exit", () => rmSync(agentDir, { recursive: true, force: true }));
process.env.PI_CODING_AGENT_DIR = agentDir;

const { default: fastMode, fastRates } = await import("../extensions/fast-mode.ts");

type Handler = (event: Record<string, unknown>, ctx: Record<string, unknown>) => unknown;
const handlers: Record<string, Handler[]> = {};
const commands: Record<string, { handler: (args: string, ctx: unknown) => Promise<void> }> = {};
const providers = new Map<string, { api: string; streamSimple: CallableFunction }>();
fastMode({
	on(event: string, handler: Handler) {
		(handlers[event] ??= []).push(handler);
	},
	registerCommand(name: string, config: (typeof commands)[string]) {
		commands[name] = config;
	},
	registerProvider(name: string, config: { api: string; streamSimple: CallableFunction }) {
		providers.set(name, config);
	},
} as never);

// The mandatory beta header can only survive pi-ai's last-write-wins client
// assembly via a fetch-time append, so Anthropic fast mode must be a scoped
// provider override, never a before_provider_headers write.
assert.equal(handlers.before_provider_headers, undefined, "the headers hook cannot preserve OAuth beta markers");
assert.deepEqual([...providers.keys()].sort(), ["anthropic", "cloudflare-ai-gateway"]);
for (const provider of providers.values()) {
	assert.equal(provider.api, "anthropic-messages");
	assert.equal(typeof provider.streamSimple, "function");
}
assert.equal(typeof handlers.before_provider_request?.[0], "function");
assert.deepEqual(Object.keys(commands).sort(), ["anthropic-fast", "codex-fast"]);

assert.deepEqual(
	fastRates({ input: 15, output: 75, cacheRead: 1.5, cacheWrite: 18.75 }),
	{ input: 30, output: 150, cacheRead: 3, cacheWrite: 37.5 },
	"fast mode bills double, so reported rates must double",
);

const notices: string[] = [];
const status = new Map<string, string | undefined>();
const uiCtx = (model: unknown) => ({
	hasUI: true,
	model,
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
async function fastRequest(
	provider: string,
	id: string,
	beta = "pi-existing-beta",
	extraOptions: Record<string, unknown> = {},
) {
	let payload: Record<string, unknown> | undefined;
	let headers = new Headers();
	let url: string | undefined;
	const gateway = provider === "cloudflare-ai-gateway";
	const stream = providers.get(provider)?.streamSimple(
		{
			id,
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
		{ messages: [{ role: "user", content: "test", timestamp: 0 }] },
		{
			apiKey: "test",
			maxRetries: 0,
			...(gateway ? { env: GATEWAY_ENV } : {}),
			...extraOptions,
			fetch: async (input: unknown, init: { headers?: HeadersInit; body?: unknown } = {}) => {
				url = String(input);
				headers = new Headers(init.headers);
				payload = JSON.parse(String(init.body));
				throw new Error("payload captured");
			},
		},
	);
	for await (const _event of stream) {
		// Drain the capture abort.
	}
	// A prebuilt client never reaches the wrapped fetch, which is the point of that case.
	if (!extraOptions.client) {
		assert.ok(payload, "an Anthropic request must be issued");
		if (gateway) {
			assert.ok(
				url?.startsWith("https://gateway.ai.cloudflare.com/v1/acct-123/gw-456/anthropic"),
				`gateway endpoint placeholders must resolve for every request, got ${url}`,
			);
		}
	}
	return { payload, beta: (headers.get("anthropic-beta") ?? "").split(",") };
}

const anthropicOpusCtx = uiCtx({ provider: "anthropic", id: "claude-opus-5" });
const offOpus = await fastRequest("anthropic", "claude-opus-5");
assert.equal(offOpus.payload?.speed, undefined);
assert.deepEqual(offOpus.beta, ["pi-existing-beta"], "no fast beta while disabled");

await commands["anthropic-fast"].handler("on", anthropicOpusCtx);
assert.equal(JSON.parse(readFileSync(join(agentDir, "anthropic-fast.json"), "utf8")).enabled, true);
assert.equal(notices.at(-1), "Anthropic fast mode ON");
// Direct route and gateway route get identical fast treatment.
for (const provider of ["anthropic", "cloudflare-ai-gateway"]) {
	for (const id of ["claude-opus-5", "claude-opus-4-8"]) {
		const fast = await fastRequest(provider, id);
		assert.equal(fast.payload?.speed, "fast", `${provider}/${id} must request fast mode`);
		assert.deepEqual(
			fast.beta,
			["pi-existing-beta", "fast-mode-2026-02-01"],
			`${provider}/${id} must append the beta without dropping Pi's own markers`,
		);
	}
}
const preBeta = await fastRequest("anthropic", "claude-opus-5", "pi-existing-beta,fast-mode-2026-02-01");
assert.deepEqual(preBeta.beta, ["pi-existing-beta", "fast-mode-2026-02-01"], "no duplicate beta");
const unsupported = await fastRequest("cloudflare-ai-gateway", "claude-fable-5");
assert.equal(unsupported.payload?.speed, undefined);
assert.deepEqual(unsupported.beta, ["pi-existing-beta"], "no fast beta on models fast mode ignores");

const fullStreamOnly = await fastRequest("anthropic", "claude-opus-5", "pi-existing-beta", {
	toolChoice: "none",
});
assert.equal(
	(fullStreamOnly.payload?.tool_choice as { type?: string } | undefined)?.type,
	"none",
	"full-only options must survive",
);
assert.notEqual(
	(fullStreamOnly.payload?.thinking as { type?: string } | undefined)?.type,
	"disabled",
	"a full call without thinkingEnabled must not be recomputed by the simple path",
);

let clientPayload: Record<string, unknown> | undefined;
const prebuilt = await fastRequest("anthropic", "claude-opus-5", "pi-existing-beta", {
	client: {
		messages: {
			create: (params: Record<string, unknown>) => {
				clientPayload = params;
				throw new Error("prebuilt client used");
			},
		},
	},
});
assert.equal(prebuilt.payload, undefined, "a prebuilt client bypasses the wrapped fetch");
assert.equal(clientPayload?.speed, undefined, "never request fast mode when the beta header cannot be attached");

await commands["anthropic-fast"].handler("off", anthropicOpusCtx);
assert.equal(notices.at(-1), "Anthropic fast mode OFF");
assert.equal((await fastRequest("anthropic", "claude-opus-5")).payload?.speed, undefined);

// OpenAI priority mode is provider-gated payload injection via the stock hook.
const requestHook = handlers.before_provider_request[0];
const requestPayload = async (model: unknown, payload: unknown = { model: "m" }) =>
	requestHook({ payload }, { model });
const MODELS = {
	openai: { provider: "openai", id: "gpt-5.6-sol", api: "openai-responses" },
	codex: { provider: "openai-codex", id: "gpt-5.6-sol", api: "openai-codex-responses" },
	xai: { provider: "xai", id: "grok-4.6", api: "openai-completions" },
	anthropicOpus: { provider: "anthropic", id: "claude-opus-5", api: "anthropic-messages" },
	copilotOpus: { provider: "github-copilot", id: "claude-opus-5", api: "anthropic-messages" },
} as const;
for (const model of Object.values(MODELS)) {
	assert.equal(await requestPayload(model), undefined, "all payloads pass through while off");
}
await commands["codex-fast"].handler("on", uiCtx(MODELS.openai));
assert.equal(notices.at(-1), "OpenAI fast mode ON");
for (const model of [MODELS.openai, MODELS.codex]) {
	const fast = (await requestPayload(model)) as Record<string, unknown>;
	assert.equal(fast.service_tier, "priority", `${model.provider} must request priority`);
	assert.equal(fast.model, "m", "payload fields must survive");
}
assert.equal(await requestPayload(MODELS.anthropicOpus), undefined, "codex toggle must not touch Anthropic requests");
assert.equal(await requestPayload(MODELS.xai), undefined, "service_tier must stay off OpenAI-compatible providers");
assert.equal(await requestPayload(MODELS.openai, "raw"), undefined, "non-object payloads pass through");

// Command verbs: toggle flips, status reports, invalid warns without a write.
await commands["codex-fast"].handler("toggle", uiCtx(MODELS.openai));
assert.equal(notices.at(-1), "OpenAI fast mode OFF");
await commands["codex-fast"].handler("status", uiCtx(MODELS.openai));
assert.equal(notices.at(-1), "OpenAI fast mode OFF");
const codexState = readFileSync(join(agentDir, "openai-codex-fast.json"), "utf8");
await commands["codex-fast"].handler("bogus", uiCtx(MODELS.openai));
assert.equal(notices.at(-1), "Usage: /codex-fast [on|off|toggle|status]");
assert.equal(readFileSync(join(agentDir, "openai-codex-fast.json"), "utf8"), codexState);

// Footer: one status per eligible model family, colored by state, cleared on
// models fast mode ignores, including non-overridden Opus proxies.
const statWatchers = () =>
	process.getActiveResourcesInfo().filter((resource) => resource === "StatWatcher").length;
const watcherBaseline = statWatchers();
const runHandlers = async (event: string, ...args: [Record<string, unknown>, unknown]) => {
	for (const handler of handlers[event] ?? []) await handler(...(args as [never, never]));
};
const gatewayOpus = { provider: "cloudflare-ai-gateway", id: "claude-opus-5", api: "anthropic-messages" };
await runHandlers("session_start", {}, uiCtx(gatewayOpus));
assert.equal(status.get("anthropic-fast"), "muted:fast:off");
assert.equal(status.get("codex-fast"), undefined);
await commands["anthropic-fast"].handler("on", uiCtx(gatewayOpus));
assert.equal(status.get("anthropic-fast"), "accent:fast:on");
await runHandlers("model_select", {}, uiCtx(MODELS.copilotOpus));
assert.equal(status.get("anthropic-fast"), undefined, "no footer on Opus routes the override does not cover");
await runHandlers("model_select", {}, uiCtx(MODELS.openai));
assert.equal(status.get("anthropic-fast"), undefined);
assert.equal(status.get("codex-fast"), "muted:fast:off");
await runHandlers("model_select", {}, uiCtx(MODELS.xai));
assert.equal(status.get("codex-fast"), undefined);

// A second start must not stack watchers: one shutdown has to release everything.
await runHandlers("session_start", {}, uiCtx(gatewayOpus));
await runHandlers("session_shutdown", {}, uiCtx(gatewayOpus));
assert.equal(statWatchers(), watcherBaseline, "session shutdown must release state-file watchers");

console.log(
	JSON.stringify({
		ok: true,
		anthropicFast: "wire-verified on direct+gateway opus",
		betaHeader: "fetch-time append preserves existing markers",
		prebuiltClient: "stays standard speed",
		openaiFast: "provider-gated priority",
		footer: "eligibility-scoped incl. proxy exclusion",
		watchers: "released",
	}),
);
