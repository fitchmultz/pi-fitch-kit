#!/usr/bin/env node
// Opt-in paid/live check: real extension command, native auth and provider, only synthetic context.
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const host = process.argv[2] ? resolve(process.argv[2]) : dirname(dirname(fileURLToPath(import.meta.resolve("@earendil-works/pi-coding-agent"))));
const modelRef = process.argv[3] ?? `${process.env.PI_PROVIDER}/${process.env.PI_MODEL}`;
const repeats = Number(process.argv[4] ?? 1);
const command = process.argv[5] ?? "ambitious";
assert.ok(Number.isInteger(repeats) && repeats > 0 && repeats <= 5, "repeats must be 1–5");
assert.ok(["ambitious", "unreasonable"].includes(command), "command must be ambitious or unreasonable (fourth argument; default ambitious)");
const { DefaultResourceLoader, ModelRuntime, SessionManager, SettingsManager, createAgentSession, getAgentDir } = await import(pathToFileURL(join(host, "dist/index.js")));
const authDir = getAgentDir();
const temp = mkdtempSync(join(tmpdir(), `pi-${command}-live-`));
const agentDir = join(temp, "agent");
const cwd = join(temp, "project");
const exportConstraints = [/CSV/i, /(?:CLI|command.line).{0,40}flags/is, /(?:no|without|do not|don't)\b[^.!?\n]*\bdependenc|existing dependencies only/i, /tenant/i];
const constraints = [...exportConstraints, /npm run test:exports/];
const noDelivery = [/(?:no|do not|don't|neither)\b[^.!?\n]*\bcommit/i, /(?:no|do not|don't|nor)\b[^.!?\n]*\bdeploy/i];
const ambitiousCases = [
	{
		name: "new-session",
		source: "Fix duplicate invoice exports so each invoice is exported once. Preserve the CSV columns and public CLI flags; do not add dependencies.",
		history: [],
		required: [...constraints, /Ledgerline/, /invoice/i, /(?:duplicate|once|exactly.one)/i],
		forbidden: [/previous (?:work|fix)|already (?:fixed|implemented|passed)/i, /SQLite|Redis|Kubernetes/i],
	},
	{
		name: "in-progress",
		source: "Finish the export fix and prove it is ready, without reopening the chosen approach.",
		history: [
			["user", "Stop duplicate invoice exports without changing CSV columns or public CLI flags. Preserve tenant isolation. We suspect the cache, but have not established the cause."],
			["assistant", "One possibility is a SQLite migration. Unrelated note: the mascot is a purple otter."],
			["user", "No migration and no new dependencies. Keep the existing streaming approach. The export must also retain input order. Do not commit or deploy."],
			["assistant", "I changed src/export.ts to deduplicate within each tenant. The tests still need running; the cache hypothesis is unverified."],
		],
		required: [...constraints, ...noDelivery, /invoice/i, /(?:duplicate|deduplic|once)/i, /stream/i, /(?:input|original|relative).{0,25}order/is, /(?:no|without|do not)\b[^.!?\n]*\bmigrat/i, /src\/export\.ts/, /(?:hypothes|suspect|unverified|unconfirmed|unestablished).{0,60}cache|cache.{0,60}(?:hypothes|suspect|unverified|unconfirmed|unestablished|not established)/is, /\b(?:reported|unverified|unrun|outstanding|pending)\b|\bstill need/i],
		forbidden: [/purple|otter/i],
	},
	{
		name: "recurring-outcome",
		source: "Create a weekly invoice-export report so we catch missing or duplicate invoices before customers receive them. Preserve CSV columns and public CLI flags; add no dependencies, and do not commit or deploy.",
		history: [],
		required: [...constraints, ...noDelivery, /report/i, /(?:weekly|recurring)/i, /(?:missing|omission|completeness)/i, /(?:duplicate|once)/i, /(?:repeatable|automat|reusable|runnable)/i, /(?:verify|check|establish|determine|assess|test|validate).{0,150}(?:cadence|timing|frequency|trigger|before.{0,50}(?:receiv|deliver))|(?:gate|check|reconcil).{0,100}(?:before each|per.export|pre.delivery|pre.export)/is],
		forbidden: [/already (?:fixed|implemented|passed)/i, /SQLite|Redis|Kubernetes/i],
	},
];
// Real generations own semantic quality here; offline HTTP fixtures own writer
// transport/lifecycle. These independent, task-specific heuristics catch dropped
// constraints or one-size-fits-all escalation, not every possible bad rewrite.
const unreasonableCases = [
	{
		name: "bounded-fix",
		source: "Please fix duplicate invoice exports so each invoice is exported once. Preserve CSV columns, public CLI flags, tenant isolation, and the existing streaming approach. Add no dependencies. Keep this a bounded fix, not a redesign. Do not commit or deploy.",
		history: [],
		required: [
			...constraints, ...noDelivery, /invoice/i, /(?:duplicate|deduplic|once)/i, /stream/i,
			/(?:root.cause|caus(?:e|al)|failing (?:boundary|path)|reproduc)/i,
			/(?:bounded|minimal|targeted|narrow|no\b[^.!?\n]*redesign|not\b[^.!?\n]*redesign|without\b[^.!?\n]*redesign)/i,
		],
		forbidden: [/already (?:fixed|implemented|passed)/i],
	},
	{
		name: "design-exploration",
		source: "Could you explore genuinely different directions for Ledgerline's invoice review screen and recommend one? Avoid cosmetic variants. Design exploration only: do not implement, edit files, commit, deploy, or purchase anything. Preserve CSV columns, public CLI flags, and tenant isolation; use existing dependencies only, and do not assume access to customer data.",
		history: [],
		required: [
			...exportConstraints, ...noDelivery, /Ledgerline/, /invoice/i, /(?:screen|interface|\bUI\b)/i,
			/(?:distinct|different|divergent|contrast|non.cosmetic)/i, /(?:comparison|compare|trade.?offs?)/i,
			/(?:recommend|select|choose)/i,
			/(?:no|do not|don't|without)\b[^.!?\n]*\bimplement/i,
			/(?:no|do not|don't|without)\b[^.!?\n]*\b(?:edit|chang|modif)[^.!?\n]*\bfiles?/i,
			/(?:no|do not|don't|without)\b[^.!?\n]*\b(?:purchas|spend)/i,
			/(?:no|do not|don't|without|unavailable)\b[^.!?\n]*(?:customer data|data access)|(?:customer data|data access)[^.!?\n]*(?:not|unavailable|unassumed)/i,
		],
		forbidden: [/already (?:implemented|validated|chosen)/i],
		method: /\b(?:inspect|review|examine|audit|trace|investigat\w*)\b/i,
		evidence: /\b(?:workflow|screens?|interaction|source|existing|brief|constraints)\b/i,
		acceptance: /(?:comparison|compare|trade.?offs?)[\s\S]*(?:artifact|sketch|wireframe|mockup|prototype|walkthrough|inspectable|side.by.side)|(?:artifact|sketch|wireframe|mockup|prototype|walkthrough|inspectable|side.by.side)[\s\S]*(?:comparison|compare|trade.?offs?)/i,
	},
	{
		name: "non-code-review",
		source: `Could you review this customer-facing incident explanation for clarity and factual accuracy? Review only: deliver annotated feedback with prioritized reasons, not a rewritten explanation. Do not edit files, send messages, disclose tenant details, promise outcomes, change code, purchase anything, commit, or deploy. Use only the supplied notes; keep the feedback understandable to nontechnical readers. Explanation: "All invoices are accounted for and the issue is resolved." Notes: Ledgerline's weekly report omitted some invoices. A backfill is proposed but has not run; the cause is unknown.`,
		history: [],
		required: [
			...noDelivery, /(?:review.only|review only|only[^.!?\n]*review)/i,
			/(?:no|not|do not|don't|without|never)\b[^.!?\n]*\brewrit/i,
			/(?:annotat|comment|feedback)/i, /prioriti[sz]/i,
			/(?:nontechnical|plain.language|plain English|customer.facing|understandable)/i, /(?:notes|supplied|provided)/i,
			/(?:unknown|unconfirmed|unestablished|undetermined)[^.!?\n]*cause|cause[^.!?\n]*(?:unknown|unconfirmed|unestablished|undetermined)/i,
			/backfill[^.!?\n]*(?:not[^.!?\n]*run|pending|unexecuted)|(?:not[^.!?\n]*run|pending|unexecuted)[^.!?\n]*backfill/i,
			/(?:no|do not|don't|without)\b[^.!?\n]*\b(?:edit|chang|modif)[^.!?\n]*\bfiles?/i,
			/(?:no|do not|don't|without)\b[^.!?\n]*\b(?:code changes|chang[^.!?\n]*code)/i,
			/(?:no|do not|don't|without)\b[^.!?\n]*\bsend/i,
			/(?:no|do not|don't|without)\b[^.!?\n]*\bdisclos/i,
			/(?:no|do not|don't|without)\b[^.!?\n]*\bpromis/i,
			/(?:no|do not|don't|without)\b[^.!?\n]*\b(?:purchas|spend)/i,
		],
		forbidden: [/npm run|unit tests?|test suite|code coverage/i],
		method: /\b(?:review|check|verify|assess|compare|annotat\w*|cross.check)\b/i,
		evidence: /\b(?:notes|sources?|facts?|claims?|evidence|excerpts?)\b/i,
		acceptance: /(?:annotat|feedback|comment)[\s\S]*(?:reason|rationale|evidence|support|prioriti[sz])|(?:reason|rationale|evidence|support|prioriti[sz])[\s\S]*(?:annotat|feedback|comment)/i,
	},
];
const cases = command === "ambitious" ? ambitiousCases : unreasonableCases;
try {
	mkdirSync(agentDir);
	mkdirSync(cwd);
	// Native auth may refresh OAuth; never print/copy credentials or record payload traces.
	delete process.env.PI_CACHE_TRACE_DIR;
	process.env.PI_CODING_AGENT_DIR = agentDir;
	process.env.PI_PACKAGE_DIR = host;
	const runtime = await ModelRuntime.create({ authPath: join(authDir, "auth.json"), modelsPath: join(authDir, "models.json"), modelsStorePath: join(temp, "models-cache.json"), allowModelNetwork: false });
	const slash = modelRef.indexOf("/");
	const model = runtime.getModel(modelRef.slice(0, slash), modelRef.slice(slash + 1));
	assert.ok(model && runtime.hasConfiguredAuth(model.provider), `No configured model/auth: ${modelRef}`);
	// Count calls without replacing the native completion, auth, transport, or response.
	let writerCalls = 0;
	const streamSimple = runtime.streamSimple.bind(runtime);
	runtime.streamSimple = (...args) => { writerCalls++; return streamSimple(...args); };
	writeFileSync(join(cwd, "AGENTS.md"), `# Ledgerline
Node.js/TypeScript invoice-export CLI. Use npm.
The export regression command is npm run test:exports.
Preserve tenant isolation. Do not introduce new dependencies.
`);
	const settingsManager = SettingsManager.inMemory({ compaction: { enabled: false }, retry: { enabled: false } });
	const loader = new DefaultResourceLoader({
		cwd, agentDir, settingsManager,
		additionalExtensionPaths: [fileURLToPath(new URL("../extensions/write-prompt.ts", import.meta.url))],
		noExtensions: true, noSkills: true, noPromptTemplates: true, noThemes: true,
	});
	await loader.reload({ resolveProjectTrust: async () => true });
	assert.deepEqual(loader.getExtensions().errors, []);
	let failures = 0;
	for (let repeat = 1; repeat <= repeats; repeat++) for (const fixture of cases) {
		const manager = SessionManager.inMemory(cwd);
		for (const [role, text] of fixture.history) manager.appendMessage(role === "user"
			? { role, content: text, timestamp: Date.now() }
			: { role, content: [{ type: "text", text }], api: model.api, provider: model.provider, model: model.id, usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } }, stopReason: "stop", timestamp: Date.now() });
		const { session } = await createAgentSession({ cwd, agentDir, modelRuntime: runtime, model, thinkingLevel: "high", resourceLoader: loader, settingsManager, sessionManager: manager, tools: [] });
		let draft;
		const notices = [];
		const start = writerCalls;
		try {
			assert.match(session.systemPrompt, /Ledgerline/, "native project context must be available even without history");
			await session.bindExtensions({ mode: "rpc", uiContext: {
				...session.extensionRunner.createContext().ui,
				select: async (text) => { draft = text; return "Deny"; },
				notify: (text, level) => { if (level === "error") notices.push(text); },
			}, onError: (error) => { throw new Error(error.error); } });
			const before = structuredClone(manager.getEntries());
			await session.prompt(`/${command} ${fixture.source}`);
			assert.deepEqual(manager.getEntries(), before, "rewrite must stay off transcript");
			assert.ok(draft, `No draft: ${notices.join("; ")}`);
			const errors = [];
			if (command === "ambitious" && [...draft].length > 1800) errors.push("exceeds 1800-character maximum");
			if (/^(?:Here is|Here's|Sure[,!]|I've rewritten)|as (?:discussed|agreed)|earlier turns/i.test(draft)) errors.push("not a standalone prompt");
			if (/\b\d+(?:[,.]\d+)?\s*(?:ms|seconds|minutes|seeded cases|generated cases)\b|\b(?!100\s*%|0\s*%)\d+(?:[,.]\d+)?\s*%/i.test(draft)) errors.push("unsupported quantitative target");
			if (/\b100\s*%\s*(?:test\s*)?(?:code\s*)?coverage/i.test(draft)) errors.push("unsupported coverage target");
			if (/\bat least one\b.{0,120}(?:finding|previously|unreported|unestablished)|(?:identify|produce|deliver)\b.{0,80}(?:previously unreported|new finding|not already)/is.test(draft)) errors.push("mandatory unsupported novelty");
			if (!(fixture.method ?? /\b(?:trace|reproduc\w*|inspect|investigat\w*|reconcil\w*|compare|review|examine|audit|read)\b/i).test(draft)
				|| !(fixture.evidence ?? /\b(?:raw|actual|implementation|code|diff|source|contract|data model|logs?|fixtures?)\b/i).test(draft)) errors.push("missing task-appropriate method on primary evidence");
			if (!(fixture.acceptance ?? /\b(?:regressions?|fixtures?|tests?|checks?|reconciliation|assertions?)\b(?!:).*?(?:fail|expos|reproduc|expected|exact|distinct|tenant|input.order|identit|missing)/is).test(draft)) errors.push("missing concrete task-appropriate acceptance evidence");
			for (const sentence of draft.split(/(?<=[.!?])\s+/u)) {
				if (/(?:first|last)[ -]wins|(?:keep|retain|choose|use) (?:only )?(?:the )?(?:first|last) (?:occurrence|copy|record|row)/i.test(sentence)
					&& !/\b(?:if|unless|contract|establish|determine|confirm|verify)\b/i.test(sentence)) errors.push("invented duplicate-conflict policy");
				if (/\b(?:tests?|checks?) (?:already )?(?:have )?passed|already verified/i.test(sentence)
					&& !/\b(?:if|unless|until|only|do not|don't|never|before|must|cannot)\b/i.test(sentence)) errors.push("invented completed verification");
			}
			for (const rule of fixture.required) if (!rule.test(draft)) errors.push(`missing ${rule}`);
			for (const rule of fixture.forbidden) if (rule.test(draft)) errors.push(`unsupported ${rule}`);
			failures += errors.length;
			console.log(JSON.stringify({ command, case: fixture.name, repeat, source: fixture.source, characters: [...draft].length, words: draft.split(/\s+/u).length, writerCalls: writerCalls - start, errors, draft }));
		} finally {
			await session.extensionRunner.emit({ type: "session_shutdown", reason: "quit" });
			session.dispose();
		}
	}
	console.log(JSON.stringify({ command, host, version: JSON.parse(readFileSync(join(host, "package.json"))).version, model: modelRef, repeats, failures }));
	assert.equal(failures, 0, "Generated prompt contract failed; inspect the per-case evidence above");
} finally {
	rmSync(temp, { recursive: true, force: true });
}
// Native provider connection pools may outlive disposed SDK sessions.
process.exit(0);
