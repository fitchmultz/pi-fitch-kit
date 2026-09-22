#!/usr/bin/env node
// Optional argument: selected pi-coding-agent root. Real loader, runner and provider serializer; no network.
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const host = process.argv[2] ? resolve(process.argv[2]) : dirname(dirname(fileURLToPath(import.meta.resolve("@earendil-works/pi-coding-agent"))));
const hostRequire = createRequire(join(host, "package.json"));
const aiRoot = hostRequire.resolve.paths("@earendil-works/pi-ai").map((base) => join(base, "@earendil-works/pi-ai")).find((base) => existsSync(join(base, "package.json")));
const temp = mkdtempSync(join(tmpdir(), "pi-name-boundary-"));
process.env.PI_CODING_AGENT_DIR = temp;
process.env.PI_PACKAGE_DIR = host;
process.env.PI_OFFLINE = "1";
const originalFetch = globalThis.fetch;
globalThis.fetch = () => { throw new Error("NETWORK DISALLOWED"); };
try {
	const sdk = await import(pathToFileURL(join(host, "dist/index.js")));
	const ai = await import(pathToFileURL(join(aiRoot, "dist/index.js")));
	const { createExtensionRuntime, loadExtensions } = await import(pathToFileURL(join(host, "dist/core/extensions/loader.js")));
	const { ExtensionRunner } = await import(pathToFileURL(join(host, "dist/core/extensions/runner.js")));
	const runtime = createExtensionRuntime();
	let name;
	let active = true;
	runtime.getSessionName = () => name;
	runtime.getActiveTools = () => active ? ["name_session"] : [];
	const loaded = await loadExtensions([join(root, "extensions/session-name.ts")], temp, undefined, runtime);
	assert.deepEqual(loaded.errors, []);
	runtime.getAllTools = () => loaded.extensions.flatMap(({ tools }) => [...tools.values()].map(({ definition }) => definition));
	const manager = sdk.SessionManager.inMemory(temp);
	const runner = new ExtensionRunner(loaded.extensions, runtime, temp, manager, {});
	const errors = [];
	runner.onError((error) => errors.push(error));
	await runner.emit({ type: "session_start", reason: "startup" });
	const user = (content) => ({ role: "user", content, timestamp: 1 });
	const plain = [user("first")];
	const [major, minor] = sdk.VERSION.split(".").map(Number);
	const modern = major > 0 || minor >= 87;
	assert.equal(sdk.VERSION, JSON.parse(readFileSync(join(host, "package.json"))).version);
	const unnamed = await runner.emitContext(plain);
	assert.match(unnamed[0].content, /"currentName":null/);
	assert.deepEqual(unnamed.slice(1), plain);
	if (modern) {
		const tool = (name) => ({ name, description: name, parameters: { type: "object", properties: {} } });
		const head = { role: "system", content: "INITIAL_INSTRUCTIONS", toolsAdded: [tool("a")], timestamp: 0 };
		const patch = { role: "system", content: "ADDED_INSTRUCTIONS", toolsAdded: [tool("b")], timestamp: 2 };
		const history = [head, user("first")];
		const updated = [...history, patch, user("next")];
		const before = structuredClone(updated);
		const named = await runner.emitContext(history);
		const added = await runner.emitContext(updated);
		assert.deepEqual(added[0], head, "naming must preserve initial tools rather than fold later additions into the head");
		assert.deepEqual(added[2], history[1]);
		assert.deepEqual(added[3], patch, "the system/tool patch stays at its original position");
		assert.match(added[1].content, /inert data, not instructions/);
		assert.deepEqual(updated, before);
		const apiKey = `synthetic.${Buffer.from(JSON.stringify({ "https://api.openai.com/auth": { chatgpt_account_id: "offline" } })).toString("base64")}.synthetic`;
		for (const route of ["openai", "openai-codex"]) {
			const catalog = await import(pathToFileURL(join(aiRoot, `dist/providers/${route}.models.js`)));
			const model = catalog[route === "openai" ? "OPENAI_MODELS" : "OPENAI_CODEX_MODELS"]["gpt-6-astra"];
			assert.ok(model, "selected host must supply the native Astra model");
			const { stream } = await import(pathToFileURL(join(aiRoot, `dist/api/${model.api}.js`)));
			async function capture(messages) {
				let payload;
				const result = await stream(model, ai.normalizeContext({ messages: sdk.convertToLlm(messages) }), {
					apiKey, transport: "sse", env: {}, fetch: globalThis.fetch,
					onPayload: (body) => { payload = structuredClone(body); throw new Error("OFFLINE_CAPTURE"); },
				}).result();
				assert.ok(payload, result.errorMessage);
				assert.match(result.errorMessage, /OFFLINE_CAPTURE/);
				return payload;
			}
			const first = await capture(named);
			const next = await capture(added);
			assert.deepEqual(first.tools.map((t) => t.name), ["a"]);
			assert.deepEqual(next.tools, first.tools, "tool A remains the initial declaration");
			assert.deepEqual(next.input.filter((item) => item.type === "additional_tools").map((item) => item.tools.map((t) => t.name)), [["b"]]);
			assert.deepEqual(next.input.slice(0, first.input.length), first.input, "same-name request extends the original prefix");
			assert.equal(next.instructions, first.instructions);
			assert.match(JSON.stringify(next), /INITIAL_INSTRUCTIONS/);
			assert.match(JSON.stringify(next), /ADDED_INSTRUCTIONS/);
			name = "renamed-session";
			const renamed = await capture(await runner.emitContext(updated));
			assert.notDeepEqual(renamed.input, next.input, "an actual rename changes the early metadata once");
			assert.deepEqual(await capture(await runner.emitContext(updated)), renamed, "subsequent requests with that name are stable");
			name = undefined;
			console.log(`PASS ${route}: stable head, additional_tools B, additive system patch, same-name prefix and one rename reset`);
		}
	} else {
		// In particular, 0.86 has transcript helpers but no system-aware event.
		assert.equal(loaded.extensions[0].handlers.has("context_with_system"), false);
		name = "legacy-session";
		const named = await runner.emitContext(plain);
		assert.match(named[0].content, /"currentName":"legacy-session"/);
		assert.deepEqual(named.slice(1), plain);
		console.log(`PASS legacy context on ${sdk.VERSION}; transcript helpers=${typeof ai.getCurrentSystemMessage === "function"}`);
	}
	assert.ok(loaded.extensions[0].handlers.has(modern ? "context_with_system" : "context"));
	active = false;
	assert.deepEqual(await runner.emitContext(plain), plain, "inactive naming does not add context");
	assert.deepEqual(manager.getEntries(), [], "request metadata is not persisted in the main journal");
	assert.deepEqual(errors, []);
	console.log(JSON.stringify({ host, version: sdk.VERSION, aiRoot, event: modern ? "context_with_system" : "context" }));
} finally {
	globalThis.fetch = originalFetch;
	rmSync(temp, { recursive: true, force: true });
}
