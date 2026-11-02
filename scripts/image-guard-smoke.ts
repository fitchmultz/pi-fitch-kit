#!/usr/bin/env node
import assert from "node:assert/strict";
import { createHook } from "node:async_hooks";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
	commandFor,
	drivenCommands,
	jsonList,
	requireRecord,
	type DrivenHandler,
} from "./test-harness.ts";
import type {
	DefaultResourceLoader,
	SessionManager,
	SettingsManager,
} from "@earendil-works/pi-coding-agent";

/** The host-selected Pi SDK surface this smoke drives. */
type HostSdk = {
	DefaultResourceLoader: typeof DefaultResourceLoader;
	SessionManager: typeof SessionManager;
	SettingsManager: typeof SettingsManager;
};
const isHostSdk = (module: unknown): module is HostSdk =>
	typeof module === "object" &&
	module !== null &&
	"DefaultResourceLoader" in module &&
	"SessionManager" in module &&
	"SettingsManager" in module;

/** The host photon image surface the guard's native resizes use. */
type HostPhotonImage = {
	get_bytes: () => Uint8Array;
	free: () => void;
};
type HostPhoton = {
	loadPhoton: () => Promise<{
		PhotonImage: new (pixels: Uint8Array, width: number, height: number) => HostPhotonImage;
	}>;
};
const isHostPhoton = (module: unknown): module is HostPhoton =>
	typeof module === "object" &&
	module !== null &&
	"loadPhoton" in module &&
	typeof module.loadPhoton === "function";

// Optional host root and extension path support read-only native host/RED probes.
const sdkPath =
	process.argv[2] !== undefined
		? pathToFileURL(join(process.argv[2], "dist/index.js")).href
		: import.meta.resolve("@earendil-works/pi-coding-agent");
const temp = mkdtempSync(join(tmpdir(), "pi-image-guard-"));
const cwd = join(temp, "project");
const agentDir = join(temp, "agent");
mkdirSync(cwd);
mkdirSync(agentDir);
process.env.PI_CODING_AGENT_DIR = agentDir;
process.env.PI_OFFLINE = "1";
process.on("exit", () => rmSync(temp, { recursive: true, force: true }));
const sdkModule: unknown = await import(sdkPath);
if (!isHostSdk(sdkModule)) {
	throw new Error("host Pi SDK did not expose the expected loader surface");
}
const {
	DefaultResourceLoader: HostLoader,
	SessionManager: HostSessionManager,
	SettingsManager: HostSettingsManager,
} = sdkModule;
const guardPath =
	process.argv[3] ??
	fileURLToPath(new URL("../extensions/anthropic-image-guard.ts", import.meta.url));
const loader = new HostLoader({
	cwd,
	agentDir,
	settingsManager: HostSettingsManager.inMemory({}),
	additionalExtensionPaths: [guardPath, join(dirname(guardPath), "write-prompt.ts")],
	noExtensions: true,
	noSkills: true,
	noPromptTemplates: true,
	noThemes: true,
	noContextFiles: true,
});
await loader.reload();
const loaded = loader.getExtensions();
assert.deepEqual(loaded.errors, []);
assert.equal(loaded.extensions.length, 2);
const guardExtension = loaded.extensions[0];
const writer = loaded.extensions[1];
if (guardExtension === undefined || writer === undefined) {
	throw new Error("expected the guard and writer extensions to load");
}
const { handlers } = guardExtension;
const photonModule: unknown = await import(new URL("./utils/photon.js", sdkPath).href);
if (!isHostPhoton(photonModule)) {
	throw new Error("host photon module did not expose the expected surface");
}
const { loadPhoton } = photonModule;
const photon = await loadPhoton();
let workers = 0;
const workerHook = createHook({
	init(_id: number, type: string) {
		if (type === "WORKER") {
			workers += 1;
		}
	},
});
workerHook.enable();

const SMALL_PNG =
	"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC";
const WIDE_PNG =
	"iVBORw0KGgoAAAANSUhEUgAAB9EAAAABCAIAAADmXckUAAAAH0lEQVR4nO3CMREAAAwDofdvuhWRFY6uVFVVVVXV/QNsD8mZm8ZR8gAAAABJRU5ErkJggg==";
const SMALL_BMP =
	"Qk06AAAAAAAAADYAAAAoAAAAAQAAAAEAAAABABgAAAAAAAQAAAATCwAAEwsAAAAAAAAAAAAAAAD/AA==";

const anthropicModel = { provider: "anthropic", api: "anthropic-messages", id: "claude-opus-5" };

const runHandlers = async (event: string, ...args: unknown[]): Promise<void> => {
	for (const handler of handlers.get(event) ?? []) {
		await handler(...args);
	}
};

const context: DrivenHandler | undefined = handlers.get("context")?.[0];
if (context === undefined) {
	throw new Error("expected a context handler registration");
}
assert.equal(typeof handlers.get("session_start")?.[0], "function");
assert.equal(typeof handlers.get("session_compact")?.[0], "function");

/** The rewritten messages of a guard pass result. */
const contextResult = (result: unknown): Array<Record<string, unknown>> =>
	jsonList(requireRecord(result, "context result").messages, "context result messages").map(
		(message, index) => requireRecord(message, `context result messages[${index}]`),
	);

/** The content items of one rewritten message. */
const messageContent = (message: Record<string, unknown>): Array<Record<string, unknown>> =>
	jsonList(message.content, "message content").map((item, index) =>
		requireRecord(item, `message content[${index}]`),
	);

/** The text of one content item, empty when absent. */
const contentText = (item: Record<string, unknown>): string =>
	typeof item.text === "string" ? item.text : "";

// Distinct valid captures reproduce the old cyclic LRU miss, including when a
// request exceeds the byte ceiling: retained results must still get reused.
const captures = Array.from({ length: 40 }, (_, seed) => {
	const pixels = new Uint8Array(500 * 500 * 4);
	for (let i = 0; i < pixels.length; i += 4) {
		pixels[i] = (i + seed * 13) % 256;
		pixels[i + 1] = (i * 3 + seed * 29) % 256;
		pixels[i + 2] = (i * 7 + seed * 43) % 256;
		pixels[i + 3] = 255;
	}
	const image = new photon.PhotonImage(pixels, 500, 500);
	try {
		return Buffer.from(image.get_bytes()).toString("base64");
	} finally {
		image.free();
	}
});
assert.equal(new Set(captures).size, captures.length);
const cacheReceipts = [];
for (const count of [16, 40]) {
	await runHandlers("session_start");
	const originals = captures.slice(0, count).map((data, timestamp) => ({
		role: "user",
		timestamp,
		content: [{ type: "image", data, mimeType: "image/png" }],
	}));
	const sourceChars = originals.reduce((sum, message) => {
		const first = message.content.at(0);
		assert.ok(first !== undefined, "each capture must carry an image");
		return sum + first.data.length;
	}, 0);
	assert.ok(
		sourceChars < 64 * 1024 * 1024,
		"all captures must fit the existing source admission budget",
	);
	// Native unchanged results own another base64 string. Forty sources alone
	// fit 128 MiB of UTF-16 storage, but their sources plus results do not.
	if (count === 40) {
		assert.ok(2 * sourceChars < 128 * 1024 * 1024);
		assert.ok(4 * sourceChars > 128 * 1024 * 1024);
	}
	const deltas = [];
	for (let pass = 0; pass < 3; pass++) {
		const outgoing = structuredClone(originals);
		const before = workers;
		await context({ messages: outgoing }, { model: anthropicModel });
		const delta = workers - before;
		deltas.push(delta);
		assert.deepEqual(outgoing, originals, "in-limit captures and chronology stay intact");
		if (pass === 0) {
			assert.equal(delta, count, "cold control must use the real native workers");
		} else if (count === 16) {
			assert.equal(delta, 0, "admitted16 must reuse every real resize result");
		} else {
			assert.ok(
				delta > 0 && delta < count,
				"byte eviction must bound sources AND results without cyclic all-miss thrash",
			);
		}
	}
	cacheReceipts.push({ count, sourceChars, workers: deltas });
	if (count === 16) {
		for (const event of ["session_start", "session_compact"]) {
			await runHandlers(event);
			const before = workers;
			await context({ messages: structuredClone(originals) }, { model: anthropicModel });
			assert.equal(workers - before, count, `${event} must discard cached results`);
		}
	}
}
console.log(JSON.stringify({ nativeCache: cacheReceipts, sdkPath }));

// Pi gives each extension its own module instance; the writer must still reuse
// the guard's results instead of decoding the session's captures again.
await runHandlers("session_start");
const writerSession = HostSessionManager.inMemory(cwd);
for (const [timestamp, data] of captures.slice(0, 4).entries()) {
	writerSession.appendMessage({
		role: "user",
		timestamp,
		content: [{ type: "image", data, mimeType: "image/png" }],
	});
}
const beforeGuard = workers;
await context(
	{ messages: writerSession.buildSessionContext().messages },
	{ model: anthropicModel },
);
assert.equal(workers - beforeGuard, 4, "the guard decodes each capture once");
let writerRequest: unknown;
const beforeWriter = workers;
await commandFor(drivenCommands(writer), "draft").handler("reuse guard results", {
	hasUI: true,
	mode: "rpc",
	isIdle: () => true,
	model: anthropicModel,
	thinkingLevel: "off",
	getSystemPrompt: () => "",
	sessionManager: writerSession,
	modelRegistry: {
		streamSimple: (_model: unknown, request: unknown) => {
			writerRequest = request;
			return {
				result: async () => ({
					role: "assistant",
					content: [{ type: "text", text: "draft" }],
					stopReason: "stop",
				}),
			};
		},
	},
	ui: {
		notify() {
			return;
		},
		select: async () => "Deny",
	},
});
assert.equal(workers - beforeWriter, 0, "the writer reuses the guard's native results");
assert.deepEqual(
	jsonList(requireRecord(writerRequest, "writer request").messages, "writer request messages")
		.flatMap((message) =>
			jsonList(requireRecord(message, "writer message").content, "message content"),
		)
		.filter((item) => requireRecord(item, "content item").type === "image")
		.map((item) => requireRecord(item, "content item").data),
	captures.slice(0, 4),
);

const nonAnthropic = [
	{ role: "user", content: [{ type: "image", data: "invalid", mimeType: "image/png" }] },
];
const beforeNonClaude = workers;
assert.equal(
	await context(
		{ messages: nonAnthropic },
		{ model: { provider: "openai", api: "openai-responses" } },
	),
	undefined,
);
const nonAnthropicFirst = nonAnthropic.at(0);
assert.ok(nonAnthropicFirst !== undefined, "the non-anthropic fixture must carry a message");
assert.equal(messageContent(nonAnthropicFirst).at(0)?.type, "image");
assert.equal(workers, beforeNonClaude);

const unchanged = [
	{ role: "user", content: [{ type: "image", data: SMALL_PNG, mimeType: "image/png" }] },
];
assert.equal(await context({ messages: unchanged }, { model: anthropicModel }), undefined);
const unchangedFirst = unchanged.at(0);
assert.ok(unchangedFirst !== undefined, "the unchanged fixture must carry a message");
assert.equal(messageContent(unchangedFirst).at(0)?.data, SMALL_PNG);

await runHandlers("session_start", {}, {});
const mislabeled = [
	{ role: "user", content: [{ type: "image", data: SMALL_PNG, mimeType: "image/jpeg" }] },
];
await context({ messages: mislabeled }, { model: anthropicModel });
const correctlyLabeled = [
	{ role: "user", content: [{ type: "image", data: SMALL_PNG, mimeType: "image/png" }] },
];
assert.equal(await context({ messages: correctlyLabeled }, { model: anthropicModel }), undefined);
const labeledFirst = correctlyLabeled.at(0);
assert.ok(labeledFirst !== undefined, "the labeled fixture must carry a message");
assert.equal(messageContent(labeledFirst).at(0)?.mimeType, "image/png");

const wide = [
	{ role: "user", content: [{ type: "image", data: WIDE_PNG, mimeType: "image/png" }] },
];
const wideMessages = contextResult(await context({ messages: wide }, { model: anthropicModel }));
const wideFirst = wideMessages.at(0);
assert.ok(wideFirst !== undefined, "the wide rewrite must carry a message");
const wideContent = messageContent(wideFirst);
assert.match(
	contentText(requireRecord(wideContent.at(0), "first content item")),
	/original 2001x1, displayed at 2000x1/,
);
assert.equal(wideContent.at(1)?.type, "image");
assert.notEqual(wideContent.at(1)?.data, WIDE_PNG);

const custom = [
	{
		role: "custom",
		customType: "image-fixture",
		content: [{ type: "image", data: WIDE_PNG, mimeType: "image/png" }],
		display: false,
		timestamp: 0,
	},
];
const beforeCustom = workers;
const customMessages = contextResult(
	await context({ messages: custom }, { model: anthropicModel }),
);
const customFirst = customMessages.at(0);
assert.ok(customFirst !== undefined, "the custom rewrite must carry a message");
const customContent = messageContent(customFirst);
assert.match(
	contentText(requireRecord(customContent.at(0), "first content item")),
	/original 2001x1, displayed at 2000x1/,
);
assert.equal(customContent.at(1)?.type, "image");
assert.equal(
	workers,
	beforeCustom,
	"reuse resized data and its coordinate note without another native decode",
);

const customBmp = [
	{
		role: "custom",
		customType: "image-fixture",
		content: [{ type: "image", data: SMALL_BMP, mimeType: "image/bmp" }],
		display: false,
		timestamp: 0,
	},
];
const customBmpMessages = contextResult(
	await context({ messages: customBmp }, { model: anthropicModel }),
);
const customBmpFirst = customBmpMessages.at(0);
assert.ok(customBmpFirst !== undefined, "the BMP rewrite must carry a message");
const customBmpContent = messageContent(customBmpFirst);
assert.match(
	contentText(requireRecord(customBmpContent.at(0), "first content item")),
	/does not support this image type/,
);
assert.equal(
	customBmpContent.some((item) => item.type === "image"),
	false,
);

const anthropic = [
	{ role: "user", content: [{ type: "image", data: "invalid", mimeType: "image/png" }] },
];
const invalidMessages = contextResult(
	await context({ messages: anthropic }, { model: anthropicModel }),
);
const invalidFirst = invalidMessages.at(0);
assert.ok(invalidFirst !== undefined, "the invalid-image rewrite must carry a message");
const invalidContent = messageContent(invalidFirst);
assert.equal(requireRecord(invalidContent.at(0), "first content item").type, "text");
assert.match(
	contentText(requireRecord(invalidContent.at(0), "first content item")),
	/Image omitted/,
);
const beforeRetry = workers;
const retry = [
	{ role: "user", content: [{ type: "image", data: "invalid", mimeType: "image/png" }] },
];
const retryMessages = contextResult(await context({ messages: retry }, { model: anthropicModel }));
const retryFirst = retryMessages.at(0);
assert.ok(retryFirst !== undefined, "the retry rewrite must carry a message");
assert.match(
	contentText(requireRecord(messageContent(retryFirst).at(0), "first content item")),
	/Image omitted/,
);
assert.equal(
	workers - beforeRetry,
	1,
	"failed decoding must be retried, never retained as a successful cache entry",
);

const oversized = [
	{
		role: "user",
		content: [
			{ type: "image", data: "A".repeat(32 * 1024 * 1024 + 1), mimeType: "image/png" },
			{ type: "image", data: SMALL_PNG, mimeType: "image/png" },
		],
	},
];
const oversizedMessages = contextResult(
	await context({ messages: oversized }, { model: anthropicModel }),
);
const oversizedFirst = oversizedMessages.at(0);
assert.ok(oversizedFirst !== undefined, "the oversized rewrite must carry a message");
const oversizedContent = messageContent(oversizedFirst);
assert.match(
	contentText(requireRecord(oversizedContent.at(0), "first content item")),
	/resize safety limit/,
);
assert.equal(oversizedContent.at(1)?.type, "image");

// The guard requires a Claude model on the anthropic-messages API: Claude
// behind a gateway or proxy hits the same Anthropic image limits, while
// non-Claude models sharing that wire API (and non-Anthropic APIs from the
// same providers) keep their source images untouched.
const gatewayWide = [
	{ role: "user", content: [{ type: "image", data: WIDE_PNG, mimeType: "image/png" }] },
];
const gatewayMessages = contextResult(
	await context(
		{ messages: gatewayWide },
		{
			model: { provider: "cloudflare-ai-gateway", api: "anthropic-messages", id: "claude-fable-5" },
		},
	),
);
const gatewayFirst = gatewayMessages.at(0);
assert.ok(gatewayFirst !== undefined, "the gateway rewrite must carry a message");
const gatewayContent = messageContent(gatewayFirst);
assert.match(
	contentText(requireRecord(gatewayContent.at(0), "first content item")),
	/original 2001x1, displayed at 2000x1/,
);
assert.equal(gatewayContent.at(1)?.type, "image");
const namespacedClaude = [
	{ role: "user", content: [{ type: "image", data: SMALL_BMP, mimeType: "image/bmp" }] },
];
const namespacedMessages = contextResult(
	await context(
		{ messages: namespacedClaude },
		{
			model: {
				provider: "vercel-ai-gateway",
				api: "anthropic-messages",
				id: "anthropic/claude-opus-5",
			},
		},
	),
);
const namespacedFirst = namespacedMessages.at(0);
assert.ok(namespacedFirst !== undefined, "the namespaced rewrite must carry a message");
assert.match(
	contentText(requireRecord(messageContent(namespacedFirst).at(0), "first content item")),
	/does not support this image type/,
);
const vercelNonClaude = [
	{ role: "user", content: [{ type: "image", data: "invalid", mimeType: "image/png" }] },
];
assert.equal(
	await context(
		{ messages: vercelNonClaude },
		{
			model: { provider: "vercel-ai-gateway", api: "anthropic-messages", id: "openai/gpt-5.6-sol" },
		},
	),
	undefined,
	"non-Claude models on the anthropic-messages API must keep source images",
);
const gatewayNonClaude = [
	{ role: "user", content: [{ type: "image", data: "invalid", mimeType: "image/png" }] },
];
assert.equal(
	await context(
		{ messages: gatewayNonClaude },
		{ model: { provider: "cloudflare-ai-gateway", api: "openai-completions", id: "gpt-5.6-sol" } },
	),
	undefined,
);

await runHandlers("session_compact");
const afterCompaction = [
	{ role: "compactionSummary", summary: "Earlier context" },
	{ role: "branchSummary", summary: "Earlier branch" },
	{ role: "bashExecution", command: "pwd", output: "/tmp" },
	{ role: "user", content: [{ type: "image", data: "invalid", mimeType: "image/png" }] },
];
const compactionMessages = contextResult(
	await context({ messages: afterCompaction }, { model: anthropicModel }),
);
const compactionUser = compactionMessages.at(3);
assert.ok(compactionUser !== undefined, "the post-compaction rewrite must carry the user message");
assert.equal(
	requireRecord(messageContent(compactionUser).at(0), "first content item").type,
	"text",
);
workerHook.disable();

console.log(
	JSON.stringify({
		ok: true,
		nonAnthropic: "unchanged",
		anthropicUnchanged: "preserved",
		anthropicResize: "resized",
		mimeAwareCache: "preserved",
		customImage: "resized",
		unsupportedCustomImage: "omitted",
		anthropicResizeFailure: "omitted",
		oversizedSource: "omitted",
		claudeRoutes: "gateway+namespaced claude guarded, non-claude and non-anthropic APIs untouched",
		compaction: "cleared",
	}),
);
