#!/usr/bin/env node
import assert from "node:assert/strict";

import anthropicImageGuard from "../extensions/anthropic-image-guard.ts";

const SMALL_PNG =
	"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC";
const WIDE_PNG =
	"iVBORw0KGgoAAAANSUhEUgAAB9EAAAABCAIAAADmXckUAAAAH0lEQVR4nO3CMREAAAwDofdvuhWRFY6uVFVVVVXV/QNsD8mZm8ZR8gAAAABJRU5ErkJggg==";

const handlers = {};
anthropicImageGuard({
	on(event, handler) {
		handlers[event] = handler;
	},
});

const { context } = handlers;
assert.equal(typeof context, "function");
assert.equal(typeof handlers.session_start, "function");
assert.equal(typeof handlers.session_compact, "function");

const nonAnthropic = [{ role: "user", content: [{ type: "image", data: "invalid", mimeType: "image/png" }] }];
assert.equal(await context({ messages: nonAnthropic }, { model: { provider: "openai" } }), undefined);
assert.equal(nonAnthropic[0].content[0].type, "image");

const unchanged = [{ role: "user", content: [{ type: "image", data: SMALL_PNG, mimeType: "image/png" }] }];
assert.equal(await context({ messages: unchanged }, { model: { provider: "anthropic" } }), undefined);
assert.equal(unchanged[0].content[0].data, SMALL_PNG);

const wide = [{ role: "user", content: [{ type: "image", data: WIDE_PNG, mimeType: "image/png" }] }];
const wideResult = await context({ messages: wide }, { model: { provider: "anthropic" } });
assert.match(wideResult.messages[0].content[0].text, /original 2001x1, displayed at 2000x1/);
assert.equal(wideResult.messages[0].content[1].type, "image");
assert.notEqual(wideResult.messages[0].content[1].data, WIDE_PNG);

const anthropic = [{ role: "user", content: [{ type: "image", data: "invalid", mimeType: "image/png" }] }];
const result = await context({ messages: anthropic }, { model: { provider: "anthropic" } });
assert.equal(result.messages[0].content[0].type, "text");
assert.match(result.messages[0].content[0].text, /Image omitted/);

const oversized = [
	{ role: "user", content: [{ type: "image", data: "A".repeat(32 * 1024 * 1024 + 1), mimeType: "image/png" }] },
];
const oversizedResult = await context({ messages: oversized }, { model: { provider: "anthropic" } });
assert.match(oversizedResult.messages[0].content[0].text, /resize safety limit/);

handlers.session_compact();
const afterCompaction = [
	{ role: "compactionSummary", summary: "Earlier context" },
	{ role: "branchSummary", summary: "Earlier branch" },
	{ role: "bashExecution", command: "pwd", output: "/tmp" },
	{ role: "user", content: [{ type: "image", data: "invalid", mimeType: "image/png" }] },
];
const afterCompactionResult = await context({ messages: afterCompaction }, { model: { provider: "anthropic" } });
assert.equal(afterCompactionResult.messages[3].content[0].type, "text");

console.log(
	JSON.stringify({
		ok: true,
		nonAnthropic: "unchanged",
		anthropicUnchanged: "preserved",
		anthropicResize: "resized",
		anthropicResizeFailure: "omitted",
		oversizedSource: "omitted",
		compaction: "cleared",
	}),
);
