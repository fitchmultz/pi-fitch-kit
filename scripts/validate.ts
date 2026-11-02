#!/usr/bin/env node
import { existsSync, lstatSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
	isRecord,
	jsonField,
	jsonList,
	jsonNumber,
	jsonString,
	jsonStrings,
	requireRecord,
} from "./test-harness.ts";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
/** A parsed JSON document, kept unknown until a check establishes its shape. */
const jsonDocument = (path: string): unknown => JSON.parse(readFileSync(join(root, path), "utf-8"));
const manifest: Record<string, unknown> = requireRecord(
	jsonDocument("setup-manifest.json"),
	"setup-manifest.json",
);
const packageJson: Record<string, unknown> = requireRecord(
	jsonDocument("package.json"),
	"package.json",
);
const packageLock: Record<string, unknown> = requireRecord(
	jsonDocument("package-lock.json"),
	"package-lock.json",
);
const settingsExample: Record<string, unknown> = requireRecord(
	jsonDocument(join("examples", "settings.json")),
	"examples/settings.json",
);

const assert: (condition: boolean, message: string) => asserts condition = (condition, message) => {
	if (!condition) {
		throw new Error(message);
	}
};

assert(
	manifest.schemaVersion === 8,
	"setup manifest schema must match the ordered required-alternatives shape",
);
const requiredModelsRaw = jsonList(manifest.requiredModels, "manifest requiredModels");
assert(
	requiredModelsRaw.every(
		(routes) =>
			Array.isArray(routes) &&
			routes.length > 0 &&
			routes.every((route) => typeof route === "string" && route.includes("/")),
	),
	"each requiredModels entry must be a non-empty ordered list of provider/model routes",
);
const requiredModels: string[][] = requiredModelsRaw.map((routes, index) =>
	jsonStrings(routes, `requiredModels[${index}]`),
);
const manifestModelRoutes = new Set<string>([
	...requiredModels.flat(),
	...jsonStrings(manifest.optionalModels, "optionalModels"),
]);
const compaction: Record<string, unknown> = isRecord(settingsExample.compaction)
	? settingsExample.compaction
	: {};
for (const key of ["reserveTokens", "keepRecentTokens"]) {
	const value = compaction[key];
	assert(
		typeof value === "number" && Number.isSafeInteger(value) && value > 0,
		`compaction.${key} must be a positive safe integer`,
	);
}
const reserveTokens = jsonNumber(compaction["reserveTokens"], "compaction.reserveTokens");
const keepRecentTokens = jsonNumber(compaction["keepRecentTokens"], "compaction.keepRecentTokens");
const modelContextWindows = jsonField(
	manifest,
	"modelContextWindows",
	"manifest modelContextWindows",
);
assert(Object.keys(modelContextWindows).length > 0, "manifest must carry modelContextWindows");
for (const [route, value] of Object.entries(modelContextWindows)) {
	assert(
		manifestModelRoutes.has(route),
		`modelContextWindows route ${route} must be a manifest-managed model route`,
	);
	assert(
		typeof value === "number" &&
			Number.isSafeInteger(value) &&
			value > reserveTokens + keepRecentTokens,
		`modelContextWindows value for ${route} must be a safe integer exceeding the compaction reserve plus recent tokens`,
	);
}
const runtime = jsonField(manifest, "runtime", "manifest runtime");
const piFloor = /^>=(\d+\.\d+\.\d+)$/.exec(jsonString(runtime.pi, "runtime.pi"))?.[1];
assert(piFloor === "1.5.0", "the kit requires Pi 1.5.0 or newer");
const engines = jsonField(packageJson, "engines", "package engines");
assert(engines.node === runtime.node, "package and manifest Node floors must match");
assert(
	typeof packageJson.version === "string" && /^\d+\.\d+\.\d+$/.test(packageJson.version),
	"package version must be a release version",
);
const lockPackages = jsonField(packageLock, "packages", "lockfile packages");
const lockRoot = requireRecord(lockPackages[""], "lockfile root package");
assert(
	packageLock.version === packageJson.version && lockRoot.version === packageJson.version,
	"lockfile version must match package.json",
);
const resolvedOrigins = Object.values(lockPackages)
	.flatMap((entry) => {
		const resolved = requireRecord(entry, "lockfile entry").resolved;
		return typeof resolved === "string" ? [resolved] : [];
	})
	.map((resolved) => new URL(resolved).origin);
assert(resolvedOrigins.length > 0, "the lockfile must contain resolved package origins");
assert(
	resolvedOrigins.every((origin) => origin === "https://registry.npmjs.org"),
	`the public lockfile must use only the npm registry; found ${[...new Set(resolvedOrigins)].join(", ")}`,
);
assert(
	!existsSync(join(root, "patches")),
	"Pi core patch artifacts are retired; the kit must stay patch-free",
);
assert(
	!Object.keys(jsonField(packageJson, "scripts", "package scripts")).some((script) =>
		script.includes("pi-core"),
	),
	"guarded Pi core scripts are retired with the patch stack",
);
for (const dependency of [
	"@earendil-works/pi-ai",
	"@earendil-works/pi-coding-agent",
	"@earendil-works/pi-tui",
]) {
	const devDependencies = jsonField(packageJson, "devDependencies", "package devDependencies");
	const devVersion = devDependencies[dependency];
	assert(
		typeof devVersion === "string" && /^\d+\.\d+\.\d+$/.test(devVersion),
		`${dependency} must pin an exact Pi development baseline`,
	);
	assert(
		devVersion === devDependencies["@earendil-works/pi-coding-agent"],
		`${dependency} must use the coherent Pi development cohort`,
	);
	const peerDependencies = jsonField(packageJson, "peerDependencies", "package peerDependencies");
	assert(peerDependencies[dependency] === "*", `${dependency} must remain an unversioned Pi peer`);
	const peerDependenciesMeta = jsonField(
		packageJson,
		"peerDependenciesMeta",
		"package peerDependenciesMeta",
	);
	assert(
		isRecord(peerDependenciesMeta[dependency]) &&
			peerDependenciesMeta[dependency].optional === true,
		`${dependency} must remain an optional Pi peer`,
	);
}
const piField = jsonField(packageJson, "pi", "package pi field");
const kitResources = jsonField(manifest, "kitResources", "manifest kitResources");
const kitExtensions = jsonStrings(kitResources.extensions, "kitResources.extensions");
const kitPrompts = jsonStrings(kitResources.prompts, "kitResources.prompts");
const kitThemes = jsonStrings(kitResources.themes, "kitResources.themes");
assert(
	JSON.stringify(piField.extensions) === JSON.stringify(kitExtensions.map((path) => `./${path}`)),
	"package.json pi.extensions must match manifest kitResources.extensions",
);
assert(
	JSON.stringify(piField.prompts) === JSON.stringify(kitPrompts.map((path) => `./${path}`)),
	"package.json pi.prompts must match manifest kitResources.prompts",
);
assert(
	JSON.stringify(piField.themes) === JSON.stringify(kitThemes.map((path) => `./${path}`)),
	"package.json pi.themes must match manifest kitResources.themes",
);
for (const resource of [
	...kitExtensions,
	...kitPrompts,
	jsonString(kitResources.workingAgreementTemplate, "kitResources.workingAgreementTemplate"),
	jsonString(kitResources.settingsExample, "kitResources.settingsExample"),
]) {
	assert(lstatSync(join(root, resource)).isFile(), `manifest resource missing: ${resource}`);
}

assert(!existsSync(join(root, "agents")), "agent profiles belong to pi-subagents, not the kit");
assert(
	!existsSync(join(root, "extensions", "sync-agents.ts")),
	"sync-agents is redundant with pi-subagents defaults",
);
assert(
	!existsSync(join(root, "extensions", "codex-context.ts")),
	"codex-context is retired; fast-mode owns the fast toggles",
);
assert(
	JSON.stringify(kitExtensions) ===
		JSON.stringify([
			"extensions/anthropic-image-guard.ts",
			"extensions/clean-footer.ts",
			"extensions/fast-mode.ts",
			"extensions/session-name.ts",
			"extensions/setup-models.ts",
			"extensions/write-prompt.ts",
			"extensions/paged-reader.ts",
		]),
	"the kit must bundle the image-guard, clean-footer, fast-mode, session-name, setup-models, write-prompt, and paged-reader extensions",
);
assert(
	!existsSync(join(root, "extensions", "session-restart.ts")),
	"the fork's native /restart replaces the retired kit helper",
);

const corePackages = jsonList(manifest.corePackages, "corePackages").map((pkg, index) =>
	requireRecord(pkg, `corePackages[${index}]`),
);
const retiredPackageSources = jsonStrings(manifest.retiredPackageSources, "retiredPackageSources");
for (const pkg of corePackages) {
	const id = jsonString(pkg.id, "core package id");
	const source = pkg.source;
	assert(
		typeof source === "string" &&
			(/^npm:(?:@[\w.-]+\/)?[\w.-]+$/.test(source) ||
				/^git:github\.com\/[\w-]+\/[\w-]+$/.test(source)),
		`corePackages ${id} must use an unpinned npm or Git source: ${typeof source === "string" ? source : JSON.stringify(source)}`,
	);
	assert(!retiredPackageSources.includes(source), `corePackages ${id} cannot also be retired`);
}
const subagents = corePackages.find((pkg) => pkg.id === "subagents");
assert(
	subagents?.source === "npm:@fitchmultz/pi-subagents",
	"subagents must use the consolidated owned scoped npm source",
);
assert(
	!corePackages.some((pkg) => pkg.id === "intercom"),
	"standalone intercom is retired into pi-subagents",
);
assert(
	jsonStrings(manifest.optionalIntegrations, "optionalIntegrations").includes("GitHub"),
	"active GitHub MCP integration must be selectable",
);

const mcp = corePackages.find((pkg) => pkg.id === "mcp");
assert(
	mcp?.source === "git:github.com/fitchmultz/pi-mcp-adapter",
	"MCP adapter must use its public source",
);

const agentSkills = corePackages.find((pkg) => pkg.id === "agent-skills");
assert(
	agentSkills?.source === "git:github.com/fitchmultz/pi-agent-skills",
	"agent-skills must use its public source",
);

const pstack = corePackages.find((pkg) => pkg.id === "pstack");
assert(
	pstack?.source === "git:github.com/fitchmultz/pi-pstack",
	"pstack must use its public source",
);

const ctxInfo = corePackages.find((pkg) => pkg.id === "ctx-info");
assert(
	ctxInfo?.source === "git:github.com/fitchmultz/pi-ctx-info",
	"ctx-info must follow its public source",
);

assert(
	!corePackages.some((pkg) => pkg.id === "codex-context"),
	"codex-context is retired, not a core package",
);
assert(
	!corePackages.some((pkg) => pkg.id === "session-name"),
	"session-name now belongs to the kit",
);
const askQuestion = corePackages.find((pkg) => pkg.id === "ask-question");
assert(
	askQuestion?.source === "npm:@fitchmultz/pi-ask-question",
	"ask-question must use the owned scoped npm source for the structured question tool",
);
const ponytail = corePackages.find((pkg) => pkg.id === "ponytail");
assert(
	ponytail?.source === "git:github.com/fitchmultz/ponytail",
	"ponytail must use its public source",
);
assert(
	!corePackages.some((pkg) => pkg.id === "fff"),
	"fff is retired in favor of native repository search",
);
for (const source of [
	"git:github.com/fitchmultz/pi-codex-context",
	"git:github.com/fitchmultz/pi-session-name",
	"npm:@ff-labs/pi-fff",
	"npm:pi-verbosity-control",
	"git:github.com/DietrichGebert/ponytail",
]) {
	assert(
		retiredPackageSources.includes(source),
		`upgrades must remove the retired standalone package: ${source}`,
	);
}
const retiredExtensionLinks = jsonList(manifest.retiredExtensionLinks, "retiredExtensionLinks").map(
	(link, index) => requireRecord(link, `retiredExtensionLinks[${index}]`),
);
assert(
	JSON.stringify(retiredExtensionLinks) ===
		JSON.stringify([
			{
				path: "extensions/fold-responsive-footer.ts",
				targetSuffix: "/fold-dev-environment/extensions/fold-responsive-footer.ts",
			},
			{
				path: "extensions/openai-codex-fast-mode",
				targetSuffix: "/fold-dev-environment/extensions/openai-codex-fast-mode",
			},
		]),
	"upgrades must retire the approved Fold footer and standalone fast-mode links",
);
const consentBehaviors = jsonList(manifest.consentBehaviors, "consentBehaviors");
for (const behavior of consentBehaviors) {
	const consent = requireRecord(
		requireRecord(behavior, "consent behavior").consent,
		"consent behavior consent",
	);
	assert(consent.required === true, "consent behaviors must require explicit consent");
	assert(consent.default === "disabled", "consent behaviors must default off");
}
assert(
	manifest.piCorePatch === undefined,
	"the retired Pi core patch must not reappear in the manifest",
);

assert(
	jsonField(manifest, "kit", "manifest kit").packageName === "@fitch/pi-kit",
	"setup must identify duplicate kit package entries",
);

const verbosity = corePackages.find((pkg) => pkg.id === "verbosity");
assert(
	verbosity?.source === "npm:@fitchmultz/pi-verbosity-control",
	"verbosity must use the owned scoped npm native-status controller",
);

const calculator = corePackages.find((pkg) => pkg.id === "calculator");
assert(
	calculator?.source === "npm:@fitchmultz/pi-calculator",
	"calculator must use the owned scoped npm source",
);

const editSession = corePackages.find((pkg) => pkg.id === "edit-session");
assert(
	editSession?.source === "git:github.com/fitchmultz/pi-edit-session-in-place",
	"edit-session must follow its public Git source",
);

const browser = requireRecord(
	corePackages.find((pkg) => pkg.id === "agent-browser")?.externalPrerequisite,
	"agent-browser externalPrerequisite",
);
const browserMinimumVersion = browser.minimumVersion;
assert(
	typeof browserMinimumVersion === "string" && /^\d+\.\d+\.\d+$/.test(browserMinimumVersion),
	"Agent Browser prerequisite must declare its minimum version",
);
assert(
	browser.installCommand === "npm install --global agent-browser",
	"Agent Browser install must use the canonical package name without a version",
);

const setupPromptPath = kitPrompts.find((path) => path.endsWith("/fitch-setup.md"));
assert(setupPromptPath !== undefined, "manifest must include prompts/fitch-setup.md");
const setupPrompt = readFileSync(join(root, setupPromptPath), "utf-8");
// Content contracts only; native resource smokes separately verify delivery, not model obedience.
const agreement = readFileSync(
	join(
		root,
		jsonString(kitResources.workingAgreementTemplate, "kitResources.workingAgreementTemplate"),
	),
	"utf-8",
);
const processBlock =
	agreement.match(
		/<!-- fitch-pi-kit:process:start -->([\s\S]*?)<!-- fitch-pi-kit:process:end -->/,
	)?.[1] ?? "";
assert(
	!setupPrompt.includes("pi-subagents/agents/"),
	"setup content must not reference a sibling profile tree",
);
assert(
	!/`|\breviewer[-_][\w-]+/i.test(processBlock),
	"managed process content must avoid code spans and reviewer-prefixed identifiers",
);
assert(
	["independent review", "unsatisfied", "self-review"].every((anchor) =>
		processBlock.includes(anchor),
	),
	"managed process content must retain the independent-review, unsatisfied, and self-review boundaries",
);
assert(
	setupPrompt.includes("selected or confirmed installed"),
	"setup content must scope optional ownership to selected or confirmed installed",
);
assert(
	[
		"minimum versions against the running runtime",
		"minimum check as unverified rather than as passing",
	].every((anchor) => setupPrompt.includes(anchor)),
	"setup must assess the running-runtime minimum without treating unknown as a pass",
);
assert(
	[
		"running session's channel and build provenance",
		"selected CLI may differ from the running session",
		"compare it with the current maintained build or revision",
		"matching version numbers do not establish identity or currency",
		"host currency as unverified",
		"current comparison target cannot be established",
	].every((anchor) => setupPrompt.includes(anchor)),
	"setup must require channel/build provenance before confirming host currency",
);
const hardReview = readFileSync(join(root, "prompts/review/hard-review.md"), "utf-8");
assert(
	hardReview.includes("GPT-family") && hardReview.includes("Claude-family"),
	"hard-review content must retain both GPT-family and Claude-family requirements",
);
assert(setupPrompt.includes("setup-manifest.json"), "setup prompt must reference the manifest");
assert(setupPrompt.includes("pi-subagents"), "setup prompt must name the profile owner");
assert(
	setupPrompt.includes("${PI_CODING_AGENT_DIR:-$HOME/.pi/agent}"),
	"setup prompt must honor the active Pi agent directory",
);
assert(
	setupPrompt.includes("modelContextWindows"),
	"setup prompt must offer the context-window override step",
);
assert(
	!setupPrompt.includes("pi --list-models"),
	"setup verification must not launch Pi's migration-capable model listing",
);
assert(
	setupPrompt.includes("fitch_setup_models"),
	"setup must inspect models through the running session",
);
assert(
	setupPrompt.includes("keep-or-overwrite"),
	"setup prompt must define rerun semantics for existing overrides",
);
assert(
	setupPrompt.includes("long-context tier"),
	"setup prompt must disclose the OpenAI pricing consequence",
);
const defaultRoute = `${jsonString(settingsExample.defaultProvider, "settings defaultProvider")}/${jsonString(
	settingsExample.defaultModel,
	"settings defaultModel",
)}`;
assert(
	requiredModels.some(([preferred]) => preferred === defaultRoute),
	"settings default model must be the preferred route of a required entry",
);
const enabledModels = jsonStrings(settingsExample.enabledModels, "settings enabledModels");
assert(enabledModels.includes(defaultRoute), "settings default model must be enabled");
assert(
	["off", "minimal", "low", "medium", "high", "xhigh", "max"].includes(
		jsonString(settingsExample.defaultThinkingLevel, "settings defaultThinkingLevel"),
	),
	"settings thinking level must be valid",
);
assert(
	settingsExample.compactView === true,
	"settings example must carry the optional compact-view preference",
);
assert(
	setupPrompt.includes("/compact-view off"),
	"setup must explain how to restore the normal view",
);
assert(
	new Set(enabledModels).size === enabledModels.length,
	"settings enabledModels must be unique",
);
for (const route of enabledModels) {
	assert(
		manifestModelRoutes.has(route),
		`settings enabled model ${route} must be a manifest-managed route`,
	);
}
const retry = requireRecord(settingsExample.retry, "settings retry");
const maxRetries = retry.maxRetries;
assert(
	typeof maxRetries === "number" && Number.isSafeInteger(maxRetries) && maxRetries > 0,
	"settings example must carry a retry budget",
);
const retryProvider = requireRecord(retry.provider, "settings retry provider");
const timeoutMs = retryProvider.timeoutMs;
assert(
	typeof timeoutMs === "number" && Number.isSafeInteger(timeoutMs) && timeoutMs > 0,
	"settings example must carry a provider timeout",
);

assert(
	!setupPrompt.includes("~/.pi/agent/AGENTS.md"),
	"setup prompt must not hardcode the default working-agreement path",
);
assert(
	setupPrompt.includes("recorded target is under `pi-fitch-kit/agents/`"),
	"setup prompt must safely retire legacy profile links",
);
assert(setupPrompt.includes("consentBehaviors"), "setup prompt must honor consent-gated behavior");
assert(
	setupPrompt.includes("openai-codex-fast.json"),
	"setup prompt must preserve fast-mode state during legacy removals",
);
assert(
	setupPrompt.includes("retiredExtensionLinks"),
	"setup prompt must migrate approved extension collisions",
);
assert(setupPrompt.includes("targetSuffix"), "setup prompt must verify retired link provenance");
assert(
	setupPrompt.includes("pi-codex-context.json"),
	"setup prompt must preserve legacy compaction consent files",
);
assert(
	setupPrompt.includes("apply the same filters to the selected package"),
	"setup prompt must preserve Ponytail filters when replacing a retired source",
);
assert(
	setupPrompt.includes("enable, disable, or keep"),
	"setup must offer explicit consent revocation",
);
assert(
	setupPrompt.includes("filtered, pinned, or duplicate"),
	"setup must normalize stale kit package entries",
);
assert(
	setupPrompt.includes("exactly one removal command per scope and package identity"),
	"setup must not issue duplicate removal commands for one package identity",
);
assert(
	setupPrompt.includes("stop immediately on the first failed command"),
	"setup must fail-stop after partial mutation",
);
assert(
	!setupPrompt.includes("piCorePatch"),
	"the retired core patch must not survive in the setup prompt",
);
assert(
	!setupPrompt.includes("@latest"),
	"setup prompt must reject mutable npm specs without spelling one",
);

console.log(
	JSON.stringify({ ok: true, manifestChecked: true, duplicateAgentSurfaceAbsent: true }, null, 2),
);
