#!/usr/bin/env node
import { existsSync, lstatSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const manifest = JSON.parse(readFileSync(join(root, "setup-manifest.json"), "utf-8"));
const packageJson = JSON.parse(readFileSync(join(root, "package.json"), "utf-8"));

const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};

assert(
  JSON.stringify(packageJson.pi.extensions) === JSON.stringify(manifest.kitResources.extensions.map((path) => `./${path}`)),
  "package.json pi.extensions must match manifest kitResources.extensions",
);
assert(
  JSON.stringify(packageJson.pi.prompts) === JSON.stringify(manifest.kitResources.prompts.map((path) => `./${path}`)),
  "package.json pi.prompts must match manifest kitResources.prompts",
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
assert(manifest.kitResources.extensions.length === 1, "the kit should bundle only the Anthropic image guard");

for (const pkg of manifest.corePackages) {
  assert(
    /^npm:(@?[\w./-]+)@\d+\.\d+\.\d+$/.test(pkg.source) || /^git:github\.com\/[\w-]+\/[\w-]+@[0-9a-f]{40}$/.test(pkg.source),
    `corePackages ${pkg.id} is not pinned to an exact npm version or 40-char commit: ${pkg.source}`,
  );
}
const subagents = manifest.corePackages.find(({ id }) => id === "subagents");
assert(
  subagents?.source === "git:github.com/fitchmultz/pi-subagents@3dd2c4932b8aff8a40ed25f98023aebd35685830",
  "subagents must use the merged profile-owning release",
);
assert(manifest.optionalIntegrations.includes("GitHub"), "active GitHub MCP integration must be selectable");

const mcp = manifest.corePackages.find(({ id }) => id === "mcp");
assert(
  mcp?.source === "git:github.com/fitchmultz/pi-mcp-adapter@cef3ed0c9670b04519ee0eeb5bb91fc346efff89",
  "MCP adapter must retain the reviewed UI capability isolation",
);

const agentSkills = manifest.corePackages.find(({ id }) => id === "agent-skills");
assert(
  agentSkills?.source === "git:github.com/fitchmultz/pi-agent-skills@c3e0e1f7da7a65a090582266326432aef8053954",
  "agent-skills must retain the reviewed deslop guidance",
);

const codexContext = manifest.corePackages.find(({ id }) => id === "codex-context");
assert(
  codexContext?.source === "git:github.com/fitchmultz/pi-codex-context@b2c52ebd47fac2b38750168ea0d648ecd6c03a96",
  "codex-context must retain default-off routing",
);
assert(codexContext?.consent?.required === true, "cross-provider compaction must require explicit consent");
assert(codexContext?.consent?.default === "disabled", "cross-provider compaction must default off");
assert(
  JSON.stringify(codexContext?.consent?.destinations) ===
    JSON.stringify(["xai/grok-4.5", "openai-codex/gpt-5.6-luna"]),
  "compaction destinations must stay explicit",
);
assert(codexContext?.consent?.configPath === "${PI_CODING_AGENT_DIR:-$HOME/.pi/agent}/pi-codex-context.json", "consent config path must honor the Pi agent directory");
assert(codexContext?.consent?.config?.customCompactionEnabled === true, "consent config must be explicit");

const editSession = manifest.corePackages.find(({ id }) => id === "edit-session");
assert(editSession?.source === "npm:pi-edit-session-in-place@0.1.27", "edit-session must retain forward-open Node support");

const browser = manifest.corePackages.find(({ id }) => id === "agent-browser")?.externalPrerequisite;
assert(browser?.version === "0.33.0", "Agent Browser prerequisite must match the wrapper's tested 0.33.0 baseline");
assert(
  browser?.installCommand === "npm install --global agent-browser@0.33.0",
  "Agent Browser install must use the exact tested version",
);

const setupPromptPath = manifest.kitResources.prompts.find((path) => path.endsWith("/fitch-setup.md"));
assert(setupPromptPath, "manifest must include prompts/fitch-setup.md");
const setupPrompt = readFileSync(join(root, setupPromptPath), "utf-8");
assert(setupPrompt.includes("setup-manifest.json"), "setup prompt must reference the manifest");
assert(setupPrompt.includes("pi-subagents"), "setup prompt must name the profile owner");
assert(setupPrompt.includes("recorded target is under `pi-fitch-kit/agents/`"), "setup prompt must safely retire legacy profile links");
assert(setupPrompt.includes("consent.required"), "setup prompt must honor consent-gated behavior");
assert(!setupPrompt.includes("@latest"), "setup prompt must reject mutable npm specs without spelling one");

console.log(JSON.stringify({ ok: true, manifestChecked: true, duplicateAgentSurfaceAbsent: true }, null, 2));
