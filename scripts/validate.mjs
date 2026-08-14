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

assert(manifest.schemaVersion === 6, "setup manifest schema must match the patch-free revocable-consent shape");
assert(manifest.runtime.pi === "0.84.2", "the kit must pin the validated Pi runtime");
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
  assert(packageJson.devDependencies[dependency] === manifest.runtime.pi, `${dependency} must pin the exact validated Pi version`);
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
assert(!existsSync(join(root, "extensions", "codex-context.ts")), "codex-context is retired; fast-mode owns both fast toggles");
assert(
  JSON.stringify(manifest.kitResources.extensions) ===
    JSON.stringify([
      "extensions/anthropic-image-guard.ts",
      "extensions/clean-footer.ts",
      "extensions/fast-mode.ts",
      "extensions/session-name.ts",
    ]),
  "the kit must bundle the image-guard, clean-footer, fast-mode, and session-name extensions",
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

assert(!manifest.corePackages.some(({ id }) => id === "codex-context"), "codex-context is retired, not a core package");
assert(!manifest.corePackages.some(({ id }) => id === "session-name"), "session-name now belongs to the kit");
for (const source of [
  "git:github.com/fitchmultz/pi-codex-context",
  "git:github.com/fitchmultz/pi-session-name",
]) {
  assert(
    manifest.retiredPackageSources.includes(source),
    `upgrades must remove the retired standalone package: ${source}`,
  );
}
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
assert(browser?.version === "0.33.2", "Agent Browser prerequisite must match the wrapper's tested 0.33.2 baseline");
assert(
  browser?.installCommand === "npm install --global agent-browser@0.33.2",
  "Agent Browser install must use the exact tested version",
);

const setupPromptPath = manifest.kitResources.prompts.find((path) => path.endsWith("/fitch-setup.md"));
assert(setupPromptPath, "manifest must include prompts/fitch-setup.md");
const setupPrompt = readFileSync(join(root, setupPromptPath), "utf-8");
assert(setupPrompt.includes("setup-manifest.json"), "setup prompt must reference the manifest");
assert(setupPrompt.includes("pi-subagents"), "setup prompt must name the profile owner");
assert(setupPrompt.includes("${PI_CODING_AGENT_DIR:-$HOME/.pi/agent}"), "setup prompt must honor the active Pi agent directory");
assert(!setupPrompt.includes("~/.pi/agent/AGENTS.md"), "setup prompt must not hardcode the default working-agreement path");
assert(setupPrompt.includes("recorded target is under `pi-fitch-kit/agents/`"), "setup prompt must safely retire legacy profile links");
assert(setupPrompt.includes("consentBehaviors"), "setup prompt must honor consent-gated behavior");
assert(setupPrompt.includes("openai-codex-fast.json"), "setup prompt must preserve fast-mode state during legacy removals");
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
