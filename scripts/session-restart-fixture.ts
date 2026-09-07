import { createHash } from "node:crypto";
import { appendFileSync, existsSync, fstatSync, readFileSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fauxAssistantMessage, fauxProvider, type FauxResponseFactory } from "@earendil-works/pi-ai";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

// Loaded only by the owned PTY test with an explicit disposable directory.
export default function fixture(pi: ExtensionAPI): void {
	const root = process.env.PI_RESTART_TEST_RUN;
	if (!root) throw new Error("Missing disposable test directory");
	const record = (event: string, data: object = {}) => appendFileSync(join(root, "events.jsonl"), `${JSON.stringify({ event, pid: process.pid, image: performance.timeOrigin, ...data })}\n`);
	let mode = "normal";
	let hold = false;
	let shutdownExit: number | undefined;
	const response: FauxResponseFactory = async (_context, options) => {
		record("fake-call", { mode, nextTurnSeen: JSON.stringify(_context.messages).includes("synthetic queued context marker"), pendingInputSeen: JSON.stringify(_context.messages).includes("synthetic pending input") });
		if (mode === "retry") return fauxAssistantMessage("", { stopReason: "error", errorMessage: "503 service unavailable" });
		if (mode !== "normal") {
			await new Promise<void>((resolve) => {
				const abort = () => { record("fake-aborted", { mode }); resolve(); };
				if (options?.signal?.aborted) abort(); else options?.signal?.addEventListener("abort", abort, { once: true });
			});
			return fauxAssistantMessage("", { stopReason: "aborted" });
		}
		return fauxAssistantMessage("Synthetic answer; no network or paid provider was called.");
	};
	for (const provider of ["restart-a", "restart-b"]) {
		const fake = fauxProvider({ provider, api: `faux-${provider}`, models: [
			{ id: "one", reasoning: true, contextWindow: 64_000 }, { id: "two", reasoning: true, contextWindow: 64_000 },
		] });
		fake.setResponses(Array.from({ length: 100 }, () => response));
		pi.registerProvider(provider, { api: fake.api, baseUrl: fake.getModel().baseUrl, apiKey: `synthetic-default-${provider}`, models: fake.models, streamSimple: fake.provider.streamSimple });
	}
	pi.registerFlag("fixture-value", { type: "string", default: "", description: "Synthetic preservation check" });
	pi.registerFlag("fixture-enabled", { type: "boolean", default: false, description: "Synthetic preservation check" });

	async function snapshot(ctx: ExtensionContext & { isBashRunning?: () => boolean; getPendingNextTurnCount?: () => number; getPendingInputCount?: () => number }) {
		const file = ctx.sessionManager.getSessionFile();
		const branch = ctx.sessionManager.getBranch();
		const virtual = branch.filter((entry) => entry.type === "custom" && entry.customType === "fixture-virtual-cwd").at(-1);
		const realVirtual = branch.filter((entry) => entry.type === "custom" && entry.customType === "change-working-dir").at(-1);
		return {
			file, id: ctx.sessionManager.getSessionId(), leaf: ctx.sessionManager.getLeafId(), branch: branch.map((entry) => entry.id),
			fileHash: file && existsSync(file) ? createHash("sha256").update(readFileSync(file)).digest("hex") : null,
			cwd: ctx.cwd, nativeCwd: ctx.sessionManager.getCwd(), launchCwd: process.cwd(), virtual: virtual?.type === "custom" ? virtual.data : null,
			realVirtual: realVirtual?.type === "custom" ? realVirtual.data : null, dashPrompt: ctx.getSystemPrompt().startsWith("--"),
			name: pi.getSessionName(), model: ctx.model && `${ctx.model.provider}/${ctx.model.id}`, thinking: pi.getThinkingLevel(),
			flags: { value: pi.getFlag("fixture-value"), enabled: pi.getFlag("fixture-enabled") },
			configuredProviders: ["restart-a", "restart-b"].map((provider) => ({ provider, configured: ctx.modelRegistry.getProviderAuthStatus(provider).configured })),
			idle: ctx.isIdle(), pending: ctx.hasPendingMessages(), bash: ctx.isBashRunning?.() ?? null, nextTurn: ctx.getPendingNextTurnCount?.() ?? null, pendingInput: ctx.getPendingInputCount?.() ?? null, editor: ctx.ui.getEditorText(), trusted: ctx.isProjectTrusted(), nodeArgs: process.execArgv, tty: [0, 1, 2].map((fd) => fstatSync(fd).rdev), raw: process.stdin.isRaw,
			envHash: createHash("sha256").update(process.env.PI_RESTART_TEST_MARKER ?? "").digest("hex"),
			aHasLaunchKey: (await ctx.modelRegistry.getApiKeyForProvider("restart-a")) === process.env.PI_RESTART_TEST_KEY,
			bHasLaunchKey: (await ctx.modelRegistry.getApiKeyForProvider("restart-b")) === process.env.PI_RESTART_TEST_KEY,
		};
	}
	pi.on("session_start", async (event, ctx) => {
		record("start", { reason: event.reason, ...await snapshot(ctx) });
	});
	pi.on("resources_discover", (_event, ctx) => { record("resources", { file: ctx.sessionManager.getSessionFile(), model: ctx.model && `${ctx.model.provider}/${ctx.model.id}` }); });
	pi.on("model_select", (event) => record("model-select", { source: event.source, model: `${event.model.provider}/${event.model.id}` }));
	pi.on("agent_settled", () => { record("settled"); });
	if (process.env.PI_RESTART_TEST_INPUT === "1") pi.on("input", async (event, ctx) => {
		if (!event.text.startsWith("synthetic pending input")) return;
		record("input-dispatch-start", await snapshot(ctx));
		while (!existsSync(join(root, "release-input"))) await delay(10);
		return { action: "continue" };
	});
	const interception = process.env.PI_RESTART_TEST_INTERCEPT;
	if (interception) pi.on("user_bash", async () => {
		if (interception !== "operations") {
			record("intercepted-bash-dispatch");
			while (!existsSync(join(root, "release-interceptor"))) await delay(10);
		}
		if (interception === "result") return { result: { output: "Synthetic intercepted result", exitCode: 0, cancelled: false, truncated: false } };
		return { operations: {
			exec: async (_command, _cwd, options) => {
				record("intercepted-bash-start");
				await new Promise<void>((resolve) => options.signal?.addEventListener("abort", () => { record("intercepted-bash-abort"); resolve(); }, { once: true }));
				return { exitCode: null };
			},
		} };
	});
	pi.on("before_provider_request", () => { throw new Error("No network API should be reached by this faux-only test"); });
	pi.on("session_shutdown", async (event, ctx) => {
		record("shutdown", { reason: event.reason, ...await snapshot(ctx) });
		if (shutdownExit !== undefined) process.exit(shutdownExit);
		if (hold) {
			record("shutdown-held");
			while (!existsSync(join(root, "release"))) await delay(10);
		}
		await writeFile(join(root, "cleanup"), event.reason);
		record("cleanup", { reason: event.reason });
	});
	pi.registerCommand("fixture-info", {
		handler: async (tag, ctx) => { record("info", { tag, ...await snapshot(ctx) }); },
	});
	pi.registerCommand("fixture-model", {
		handler: async (args, ctx) => {
			const [provider, id, thinking] = args.split(" ");
			const model = ctx.modelRegistry.find(provider, id);
			const selected = model && await pi.setModel(model);
			if (!selected) { record("model-selection-failed", { provider, id, found: Boolean(model), configured: model && ctx.modelRegistry.hasConfiguredAuth(model) }); throw new Error("Synthetic model selection failed"); }
			pi.setThinkingLevel(thinking as "high");
			pi.setSessionName("renamed current session");
			record("changed", await snapshot(ctx));
		},
	});
	pi.registerCommand("fixture-tree", {
		handler: async (target, ctx) => {
			await ctx.navigateTree(target, { summarize: false });
			ctx.ui.setEditorText("");
			record("tree", await snapshot(ctx));
		},
	});
	pi.registerCommand("fixture-busy", {
		handler: async (kind, ctx) => {
			mode = kind;
			if (kind === "compact") ctx.compact({ onError: () => record("compact-error"), onComplete: () => record("compact-complete") });
			else if (kind === "tree") void ctx.navigateTree("00000005", { summarize: true });
			else pi.sendUserMessage("Synthetic blocked operation");
		},
	});
	pi.registerCommand("fixture-draft", { handler: async (_args, ctx) => { ctx.ui.setEditorText("unsaved synthetic draft"); record("draft-set"); } });
	pi.registerCommand("fixture-hold", { handler: async (args) => { if (args) shutdownExit = Number(args); else hold = true; record("hold-set"); } });
	pi.registerCommand("fixture-mode", { handler: async (args) => { mode = args; record("mode-set", { mode }); } });
	pi.registerCommand("fixture-queue", { handler: async () => { pi.sendUserMessage("Synthetic queued input", { deliverAs: "followUp" }); record("queue-set"); } });
	pi.registerCommand("fixture-nextturn", { handler: async () => { pi.sendMessage({ customType: "restart-nextturn-fixture", content: "synthetic queued context marker", display: false }, { deliverAs: "nextTurn" }); record("nextturn-set"); } });
	pi.registerCommand("fixture-switch", { handler: async (_args, ctx) => { await ctx.switchSession(join(root, "other.jsonl")); } });
}
