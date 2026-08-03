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
  subagents?.source === "git:github.com/fitchmultz/pi-subagents@ba80ad1ba51798d824041e2f60a0b48231d9b4d5",
  "subagents must use the merged profile-owning release",
);
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

console.log(JSON.stringify({ ok: true, manifestChecked: true, duplicateAgentSurfaceAbsent: true }, null, 2));
