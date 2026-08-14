import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const agentDir = mkdtempSync(join(tmpdir(), "pi-kit-fast-mode-"));
process.on("exit", () => rmSync(agentDir, { recursive: true, force: true }));
process.env.PI_CODING_AGENT_DIR = agentDir;

const { default: fastMode } = await import("../extensions/fast-mode.ts");

type Handler = (event: Record<string, unknown>, ctx: Record<string, unknown>) => unknown;
const handlers: Record<string, Handler[]> = {};
const commands: Record<string, { handler: (args: string, ctx: unknown) => Promise<void> }> = {};
fastMode({
	on(event: string, handler: Handler) {
		(handlers[event] ??= []).push(handler);
	},
	registerCommand(name: string, config: (typeof commands)[string]) {
		commands[name] = config;
	},
	registerProvider() {
		throw new Error("fast-mode must stay hook-only and never override providers");
	},
} as never);

assert.equal(typeof handlers.before_provider_request?.[0], "function");
assert.equal(typeof handlers.before_provider_headers?.[0], "function");
assert.equal(typeof handlers.session_start?.[0], "function");
assert.equal(typeof handlers.session_shutdown?.[0], "function");
assert.equal(typeof handlers.model_select?.[0], "function");
assert.deepEqual(Object.keys(commands).sort(), ["anthropic-fast", "codex-fast"]);

const MODELS = {
	anthropicOpus: { provider: "anthropic", id: "claude-opus-5", api: "anthropic-messages" },
	gatewayOpus: { provider: "cloudflare-ai-gateway", id: "claude-opus-5", api: "anthropic-messages" },
	gatewayOpus48: { provider: "cloudflare-ai-gateway", id: "claude-opus-4-8", api: "anthropic-messages" },
	gatewayFable: { provider: "cloudflare-ai-gateway", id: "claude-fable-5", api: "anthropic-messages" },
	openai: { provider: "openai", id: "gpt-5.6-sol", api: "openai-responses" },
	codex: { provider: "openai-codex", id: "gpt-5.6-sol", api: "openai-codex-responses" },
	xai: { provider: "xai", id: "grok-4.6", api: "openai-completions" },
} as const;

const requestHook = handlers.before_provider_request[0];
const headersHook = handlers.before_provider_headers[0];
const requestPayload = async (model: unknown, payload: unknown = { model: "m" }) =>
	requestHook({ payload }, { model });
const requestHeaders = async (model: unknown, existing?: string | null) => {
	const headers: Record<string, string | null> = {};
	if (existing !== undefined) headers["anthropic-beta"] = existing;
	await headersHook({ headers }, { model });
	return headers;
};

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

// Both toggles off: every payload and header passes through untouched.
for (const model of Object.values(MODELS)) {
	assert.equal(await requestPayload(model), undefined);
}
assert.deepEqual(await requestHeaders(MODELS.anthropicOpus, "oauth-marker"), {
	"anthropic-beta": "oauth-marker",
});

// Anthropic fast mode covers the direct route and the gateway route alike.
await commands["anthropic-fast"].handler("on", uiCtx(MODELS.anthropicOpus));
assert.equal(JSON.parse(readFileSync(join(agentDir, "anthropic-fast.json"), "utf8")).enabled, true);
assert.equal(notices.at(-1), "Anthropic fast mode ON");
for (const model of [MODELS.anthropicOpus, MODELS.gatewayOpus, MODELS.gatewayOpus48]) {
	const fast = (await requestPayload(model)) as Record<string, unknown>;
	assert.equal(fast.speed, "fast", `${model.provider}/${model.id} must request fast mode`);
	assert.equal(fast.model, "m", "payload fields must survive");
	assert.deepEqual(await requestHeaders(model, "oauth-marker"), {
		"anthropic-beta": "oauth-marker,fast-mode-2026-02-01",
	});
}
// No duplicate beta, absent header handled, and a null deletion marker treated as absent.
assert.deepEqual(await requestHeaders(MODELS.gatewayOpus, "a,fast-mode-2026-02-01"), {
	"anthropic-beta": "a,fast-mode-2026-02-01",
});
assert.deepEqual(await requestHeaders(MODELS.gatewayOpus), {
	"anthropic-beta": "fast-mode-2026-02-01",
});
assert.deepEqual(await requestHeaders(MODELS.gatewayOpus, null), {
	"anthropic-beta": "fast-mode-2026-02-01",
});
// Models fast mode ignores stay untouched even while the toggle is on.
for (const model of [MODELS.gatewayFable, MODELS.xai]) {
	assert.equal(await requestPayload(model), undefined);
	assert.deepEqual(await requestHeaders(model, "oauth-marker"), {
		"anthropic-beta": "oauth-marker",
	});
}

// OpenAI priority mode is provider-gated and independent of the Anthropic toggle.
await commands["anthropic-fast"].handler("off", uiCtx(MODELS.anthropicOpus));
await commands["codex-fast"].handler("on", uiCtx(MODELS.openai));
assert.equal(notices.at(-1), "OpenAI fast mode ON");
for (const model of [MODELS.openai, MODELS.codex]) {
	const fast = (await requestPayload(model)) as Record<string, unknown>;
	assert.equal(fast.service_tier, "priority", `${model.provider} must request priority`);
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

// Footer: one status per eligible model family, colored by state, cleared elsewhere.
const statWatchers = () =>
	process.getActiveResourcesInfo().filter((resource) => resource === "StatWatcher").length;
const watcherBaseline = statWatchers();
const runHandlers = async (event: string, ...args: [Record<string, unknown>, unknown]) => {
	for (const handler of handlers[event] ?? []) await handler(...(args as [never, never]));
};
await runHandlers("session_start", {}, uiCtx(MODELS.gatewayOpus));
assert.equal(status.get("anthropic-fast"), "muted:fast:off");
assert.equal(status.get("codex-fast"), undefined);
await commands["anthropic-fast"].handler("on", uiCtx(MODELS.gatewayOpus));
assert.equal(status.get("anthropic-fast"), "accent:fast:on");
await runHandlers("model_select", {}, uiCtx(MODELS.openai));
assert.equal(status.get("anthropic-fast"), undefined, "no footer on models fast mode ignores");
assert.equal(status.get("codex-fast"), "muted:fast:off");
await runHandlers("model_select", {}, uiCtx(MODELS.xai));
assert.equal(status.get("anthropic-fast"), undefined);
assert.equal(status.get("codex-fast"), undefined);

// A second start must not stack watchers: one shutdown has to release everything.
await runHandlers("session_start", {}, uiCtx(MODELS.gatewayOpus));
await runHandlers("session_shutdown", {}, uiCtx(MODELS.gatewayOpus));
assert.equal(statWatchers(), watcherBaseline, "session shutdown must release state-file watchers");

console.log(
	JSON.stringify({
		ok: true,
		anthropicFast: "direct+gateway opus only",
		betaHeader: "appended once, markers preserved",
		openaiFast: "provider-gated priority",
		footer: "eligibility-scoped",
		watchers: "released",
	}),
);
