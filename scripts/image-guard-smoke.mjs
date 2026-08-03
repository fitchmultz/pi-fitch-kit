#!/usr/bin/env node
import assert from "node:assert/strict";

import anthropicImageGuard from "../extensions/anthropic-image-guard.ts";

let context;
anthropicImageGuard({
	on(event, handler) {
		if (event === "context") context = handler;
	},
});

assert.equal(typeof context, "function");

const nonAnthropic = [{ role: "user", content: [{ type: "image", data: "invalid", mimeType: "image/png" }] }];
assert.equal(await context({ messages: nonAnthropic }, { model: { provider: "openai" } }), undefined);
assert.equal(nonAnthropic[0].content[0].type, "image");

const anthropic = [{ role: "user", content: [{ type: "image", data: "invalid", mimeType: "image/png" }] }];
const result = await context({ messages: anthropic }, { model: { provider: "anthropic" } });
assert.equal(result.messages[0].content[0].type, "text");
assert.match(result.messages[0].content[0].text, /Image omitted/);

console.log(JSON.stringify({ ok: true, nonAnthropic: "unchanged", anthropicResizeFailure: "omitted" }));
