#!/usr/bin/env node
import assert from "node:assert/strict";

const { default: anthropicImageGuard } = await import("../extensions/anthropic-image-guard.ts");

const SMALL_PNG =
	"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC";
const WIDE_PNG =
	"iVBORw0KGgoAAAANSUhEUgAAB9EAAAABCAIAAADmXckUAAAAH0lEQVR4nO3CMREAAAwDofdvuhWRFY6uVFVVVVXV/QNsD8mZm8ZR8gAAAABJRU5ErkJggg==";
const SMALL_BMP = "Qk06AAAAAAAAADYAAAAoAAAAAQAAAAEAAAABABgAAAAAAAQAAAATCwAAEwsAAAAAAAAAAAAAAAD/AA==";

const anthropicModel = { provider: "anthropic", api: "anthropic-messages", id: "claude-opus-5" };

const handlers = {};
anthropicImageGuard({
	on(event, handler) {
		(handlers[event] ??= []).push(handler);
	},
});
const runHandlers = async (event, ...args) => {
	for (const handler of handlers[event] ?? []) await handler(...args);
};

const context = handlers.context[0];
assert.equal(typeof context, "function");
assert.equal(typeof handlers.session_start[0], "function");
assert.equal(typeof handlers.session_compact[0], "function");

const nonAnthropic = [{ role: "user", content: [{ type: "image", data: "invalid", mimeType: "image/png" }] }];
assert.equal(
	await context({ messages: nonAnthropic }, { model: { provider: "openai", api: "openai-responses" } }),
	undefined,
);
assert.equal(nonAnthropic[0].content[0].type, "image");

const unchanged = [{ role: "user", content: [{ type: "image", data: SMALL_PNG, mimeType: "image/png" }] }];
assert.equal(await context({ messages: unchanged }, { model: anthropicModel }), undefined);
assert.equal(unchanged[0].content[0].data, SMALL_PNG);

await runHandlers("session_start", {}, {});
const mislabeled = [{ role: "user", content: [{ type: "image", data: SMALL_PNG, mimeType: "image/jpeg" }] }];
await context({ messages: mislabeled }, { model: anthropicModel });
const correctlyLabeled = [{ role: "user", content: [{ type: "image", data: SMALL_PNG, mimeType: "image/png" }] }];
assert.equal(await context({ messages: correctlyLabeled }, { model: anthropicModel }), undefined);
assert.equal(correctlyLabeled[0].content[0].mimeType, "image/png");

const wide = [{ role: "user", content: [{ type: "image", data: WIDE_PNG, mimeType: "image/png" }] }];
const wideResult = await context({ messages: wide }, { model: anthropicModel });
assert.match(wideResult.messages[0].content[0].text, /original 2001x1, displayed at 2000x1/);
assert.equal(wideResult.messages[0].content[1].type, "image");
assert.notEqual(wideResult.messages[0].content[1].data, WIDE_PNG);

const custom = [
	{
		role: "custom",
		customType: "image-fixture",
		content: [{ type: "image", data: WIDE_PNG, mimeType: "image/png" }],
		display: false,
		timestamp: 0,
	},
];
const customResult = await context({ messages: custom }, { model: anthropicModel });
assert.match(customResult.messages[0].content[0].text, /original 2001x1, displayed at 2000x1/);
assert.equal(customResult.messages[0].content[1].type, "image");

const customBmp = [
	{
		role: "custom",
		customType: "image-fixture",
		content: [{ type: "image", data: SMALL_BMP, mimeType: "image/bmp" }],
		display: false,
		timestamp: 0,
	},
];
const customBmpResult = await context({ messages: customBmp }, { model: anthropicModel });
assert.match(customBmpResult.messages[0].content[0].text, /does not support this image type/);
assert.equal(customBmpResult.messages[0].content.some(({ type }) => type === "image"), false);

const anthropic = [{ role: "user", content: [{ type: "image", data: "invalid", mimeType: "image/png" }] }];
const result = await context({ messages: anthropic }, { model: anthropicModel });
assert.equal(result.messages[0].content[0].type, "text");
assert.match(result.messages[0].content[0].text, /Image omitted/);

const oversized = [
	{
		role: "user",
		content: [
			{ type: "image", data: "A".repeat(32 * 1024 * 1024 + 1), mimeType: "image/png" },
			{ type: "image", data: SMALL_PNG, mimeType: "image/png" },
		],
	},
];
const oversizedResult = await context({ messages: oversized }, { model: anthropicModel });
assert.match(oversizedResult.messages[0].content[0].text, /resize safety limit/);
assert.equal(oversizedResult.messages[0].content[1].type, "image");

// The guard requires a Claude model on the anthropic-messages API: Claude
// behind a gateway or proxy hits the same Anthropic image limits, while
// non-Claude models sharing that wire API (and non-Anthropic APIs from the
// same providers) keep their source images untouched.
const gatewayWide = [{ role: "user", content: [{ type: "image", data: WIDE_PNG, mimeType: "image/png" }] }];
const gatewayResult = await context(
	{ messages: gatewayWide },
	{ model: { provider: "cloudflare-ai-gateway", api: "anthropic-messages", id: "claude-fable-5" } },
);
assert.match(gatewayResult.messages[0].content[0].text, /original 2001x1, displayed at 2000x1/);
assert.equal(gatewayResult.messages[0].content[1].type, "image");
const namespacedClaude = [{ role: "user", content: [{ type: "image", data: SMALL_BMP, mimeType: "image/bmp" }] }];
const namespacedResult = await context(
	{ messages: namespacedClaude },
	{ model: { provider: "vercel-ai-gateway", api: "anthropic-messages", id: "anthropic/claude-opus-5" } },
);
assert.match(namespacedResult.messages[0].content[0].text, /does not support this image type/);
const vercelNonClaude = [{ role: "user", content: [{ type: "image", data: "invalid", mimeType: "image/png" }] }];
assert.equal(
	await context(
		{ messages: vercelNonClaude },
		{ model: { provider: "vercel-ai-gateway", api: "anthropic-messages", id: "openai/gpt-5.6-sol" } },
	),
	undefined,
	"non-Claude models on the anthropic-messages API must keep source images",
);
const gatewayNonClaude = [{ role: "user", content: [{ type: "image", data: "invalid", mimeType: "image/png" }] }];
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
const afterCompactionResult = await context({ messages: afterCompaction }, { model: anthropicModel });
assert.equal(afterCompactionResult.messages[3].content[0].type, "text");

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
