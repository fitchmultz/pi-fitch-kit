#!/usr/bin/env node
import { existsSync, lstatSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const manifest = JSON.parse(readFileSync(join(root, "setup-manifest.json"), "utf-8"));
const packageJson = JSON.parse(readFileSync(join(root, "package.json"), "utf-8"));
const packageLock = JSON.parse(readFileSync(join(root, "package-lock.json"), "utf-8"));

const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};

assert(manifest.schemaVersion === 7, "setup manifest schema must match the patch-free context-window shape");
const manifestModelRoutes = new Set([...manifest.requiredModels, ...manifest.optionalModels]);
assert(
  manifest.modelContextWindows && Object.keys(manifest.modelContextWindows).length > 0,
  "manifest must carry modelContextWindows",
);
for (const [route, value] of Object.entries(manifest.modelContextWindows)) {
  assert(manifestModelRoutes.has(route), `modelContextWindows route ${route} must be a manifest-managed model route`);
  assert(
    Number.isInteger(value) && value > 0 && value <= 2_000_000,
    `modelContextWindows value for ${route} must be a sane positive integer`,
  );
}
const piFloor = /^>=(\d+\.\d+\.\d+)$/.exec(manifest.runtime.pi)?.[1];
assert(piFloor === "0.84.2", "the kit must accept Pi 0.84.2 or newer");
assert(packageJson.engines.node === manifest.runtime.node, "package and manifest Node floors must match");
assert(packageJson.version === "0.10.1", "package version must match the approved kit release");
assert(packageLock.version === packageJson.version, "lockfile version must match package.json");
const resolvedOrigins = Object.values(packageLock.packages)
  .map((entry) => entry.resolved)
  .filter(Boolean)
  .map((resolved) => new URL(resolved).origin);
assert(resolvedOrigins.length > 0, "the lockfile must contain resolved package origins");
assert(
  resolvedOrigins.every((origin) => origin === "https://registry.npmjs.org"),
  `the public lockfile must use only the npm registry; found ${[...new Set(resolvedOrigins)].join(", ")}`,
);
assert(!existsSync(join(root, "patches")), "Pi core patch artifacts are retired; the kit must stay patch-free");
assert(
  !Object.keys(packageJson.scripts).some((script) => script.includes("pi-core")),
  "guarded Pi core scripts are retired with the patch stack",
);
for (const dependency of [
  "@earendil-works/pi-ai",
  "@earendil-works/pi-coding-agent",
  "@earendil-works/pi-tui",
]) {
  assert(packageJson.devDependencies[dependency] === piFloor, `${dependency} must pin the exact validated Pi floor for reproducible checks`);
  assert(packageJson.peerDependencies[dependency] === "*", `${dependency} must remain an unversioned Pi peer`);
  assert(packageJson.peerDependenciesMeta[dependency]?.optional === true, `${dependency} must remain an optional Pi peer`);
}
assert(
  JSON.stringify(packageJson.pi.extensions) === JSON.stringify(manifest.kitResources.extensions.map((path) => `./${path}`)),
  "package.json pi.extensions must match manifest kitResources.extensions",
);
assert(
  JSON.stringify(packageJson.pi.prompts) === JSON.stringify(manifest.kitResources.prompts.map((path) => `./${path}`)),
  "package.json pi.prompts must match manifest kitResources.prompts",
);
assert(
  JSON.stringify(packageJson.pi.themes) === JSON.stringify(manifest.kitResources.themes.map((path) => `./${path}`)),
  "package.json pi.themes must match manifest kitResources.themes",
);
for (const resource of [
  ...manifest.kitResources.extensions,
  ...manifest.kitResources.prompts,
  manifest.kitResources.workingAgreementTemplate,
  manifest.kitResources.settingsExample,
]) {
  assert(lstatSync(join(root, resource)).isFile(), `manifest resource missing: ${resource}`);
}

assert(!existsSync(join(root, "agents")), "agent profiles belong to pi-subagents, not the kit");
assert(!existsSync(join(root, "extensions", "sync-agents.ts")), "sync-agents is redundant with pi-subagents defaults");
assert(!existsSync(join(root, "extensions", "codex-context.ts")), "codex-context is retired; fast-mode owns the fast toggles");
assert(
  JSON.stringify(manifest.kitResources.extensions) ===
    JSON.stringify([
      "extensions/anthropic-image-guard.ts",
      "extensions/clean-footer.ts",
      "extensions/fast-mode.ts",
      "extensions/session-name.ts",
      "extensions/write-prompt.ts",
    ]),
  "the kit must bundle the image-guard, clean-footer, fast-mode, session-name, and write-prompt extensions",
);

for (const pkg of manifest.corePackages) {
  assert(
    /^npm:(?:@[\w.-]+\/)?[\w.-]+$/.test(pkg.source) || /^git:github\.com\/[\w-]+\/[\w-]+$/.test(pkg.source),
    `corePackages ${pkg.id} must use an unpinned npm or Git source: ${pkg.source}`,
  );
}
const subagents = manifest.corePackages.find(({ id }) => id === "subagents");
assert(
  subagents?.source === "git:github.com/fitchmultz/pi-subagents",
  "subagents must use the consolidated public source",
);
assert(!manifest.corePackages.some(({ id }) => id === "intercom"), "standalone intercom is retired into pi-subagents");
assert(manifest.optionalIntegrations.includes("GitHub"), "active GitHub MCP integration must be selectable");

const mcp = manifest.corePackages.find(({ id }) => id === "mcp");
assert(
  mcp?.source === "git:github.com/fitchmultz/pi-mcp-adapter",
  "MCP adapter must use the secured public fork",
);

const agentSkills = manifest.corePackages.find(({ id }) => id === "agent-skills");
assert(
  agentSkills?.source === "git:github.com/fitchmultz/pi-agent-skills",
  "agent-skills must use its public source",
);

const ctxInfo = manifest.corePackages.find(({ id }) => id === "ctx-info");
assert(ctxInfo?.source === "git:github.com/fitchmultz/pi-ctx-info", "ctx-info must follow its public source");

assert(!manifest.corePackages.some(({ id }) => id === "codex-context"), "codex-context is retired, not a core package");
assert(!manifest.corePackages.some(({ id }) => id === "session-name"), "session-name now belongs to the kit");
assert(!manifest.corePackages.some(({ id }) => id === "ask-question"), "ask-question is retired in favor of the clarification skill");
assert(!manifest.corePackages.some(({ id }) => id === "fff"), "fff is retired in favor of native repository search");
for (const source of [
  "git:github.com/fitchmultz/pi-codex-context",
  "git:github.com/fitchmultz/pi-session-name",
  "git:github.com/fitchmultz/pi-ask-question",
  "npm:@ff-labs/pi-fff",
]) {
  assert(
    manifest.retiredPackageSources.includes(source),
    `upgrades must remove the retired standalone package: ${source}`,
  );
}
assert(
  JSON.stringify(manifest.retiredExtensionLinks) === JSON.stringify([
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
assert(Array.isArray(manifest.consentBehaviors), "consentBehaviors must stay a declared list, even when empty");
for (const behavior of manifest.consentBehaviors) {
  assert(behavior?.consent?.required === true, "consent behaviors must require explicit consent");
  assert(behavior?.consent?.default === "disabled", "consent behaviors must default off");
}
assert(manifest.piCorePatch === undefined, "the retired Pi core patch must not reappear in the manifest");

assert(manifest.kit.packageName === "@fitch/pi-kit", "setup must identify duplicate kit package entries");

const editSession = manifest.corePackages.find(({ id }) => id === "edit-session");
assert(editSession?.source === "git:github.com/fitchmultz/pi-edit-session-in-place", "edit-session must follow its public Git source");

const browser = manifest.corePackages.find(({ id }) => id === "agent-browser")?.externalPrerequisite;
assert(browser?.version === "0.34.0", "Agent Browser prerequisite must match the wrapper's tested 0.34.0 baseline");
assert(
  browser?.installCommand === "npm install --global agent-browser@0.34.0",
  "Agent Browser install must use the exact tested version",
);

const setupPromptPath = manifest.kitResources.prompts.find((path) => path.endsWith("/fitch-setup.md"));
assert(setupPromptPath, "manifest must include prompts/fitch-setup.md");
const setupPrompt = readFileSync(join(root, setupPromptPath), "utf-8");
assert(setupPrompt.includes("setup-manifest.json"), "setup prompt must reference the manifest");
assert(setupPrompt.includes("pi-subagents"), "setup prompt must name the profile owner");
assert(setupPrompt.includes("sixteen specialist"), "setup prompt must describe the current specialist count");
assert(!setupPrompt.includes("fourteen specialist"), "setup prompt must not keep the retired specialist count");
assert(setupPrompt.includes("${PI_CODING_AGENT_DIR:-$HOME/.pi/agent}"), "setup prompt must honor the active Pi agent directory");
assert(setupPrompt.includes("modelContextWindows"), "setup prompt must offer the context-window override step");
assert(setupPrompt.includes("keep-or-overwrite"), "setup prompt must define rerun semantics for existing overrides");
assert(setupPrompt.includes("long-context tier"), "setup prompt must disclose the OpenAI pricing consequence");
const settingsExample = JSON.parse(readFileSync(join(root, "examples", "settings.json"), "utf-8"));
assert(settingsExample.defaultProvider === "openai", "settings example must default to direct OpenAI");
assert(settingsExample.defaultModel === "gpt-5.6-sol", "settings example must default to GPT-5.6 Sol");
assert(settingsExample.defaultThinkingLevel === "max", "settings example must default to max thinking");
assert(new Set(settingsExample.enabledModels).size === settingsExample.enabledModels.length, "settings enabledModels must be unique");
for (const route of settingsExample.enabledModels) {
  assert(manifestModelRoutes.has(route), `settings enabled model ${route} must be a manifest-managed route`);
}
assert(settingsExample.retry?.maxRetries === 5, "settings example must carry the active retry budget");
assert(settingsExample.retry?.provider?.timeoutMs === 120000, "settings example must carry the active provider timeout");
assert(settingsExample.compaction.reserveTokens === 64000, "settings example must carry the 64k compaction reserve");
assert(settingsExample.compaction.keepRecentTokens === 40000, "settings example must keep 40k recent tokens");
assert(!setupPrompt.includes("~/.pi/agent/AGENTS.md"), "setup prompt must not hardcode the default working-agreement path");
assert(setupPrompt.includes("recorded target is under `pi-fitch-kit/agents/`"), "setup prompt must safely retire legacy profile links");
assert(setupPrompt.includes("consentBehaviors"), "setup prompt must honor consent-gated behavior");
assert(setupPrompt.includes("openai-codex-fast.json"), "setup prompt must preserve fast-mode state during legacy removals");
assert(setupPrompt.includes("retiredExtensionLinks"), "setup prompt must migrate approved extension collisions");
assert(setupPrompt.includes("targetSuffix"), "setup prompt must verify retired link provenance");
assert(setupPrompt.includes("pi-codex-context.json"), "setup prompt must preserve legacy compaction consent files");
assert(setupPrompt.includes("enable, disable, or keep"), "setup must offer explicit consent revocation");
assert(setupPrompt.includes("filtered, pinned, or duplicate"), "setup must normalize stale kit package entries");
assert(
  setupPrompt.includes("exactly one removal command per scope and package identity"),
  "setup must not issue duplicate removal commands for one package identity",
);
assert(setupPrompt.includes("stop immediately on the first failed command"), "setup must fail-stop after partial mutation");
assert(!setupPrompt.includes("piCorePatch"), "the retired core patch must not survive in the setup prompt");
assert(!setupPrompt.includes("@latest"), "setup prompt must reject mutable npm specs without spelling one");

console.log(JSON.stringify({ ok: true, manifestChecked: true, duplicateAgentSurfaceAbsent: true }, null, 2));
