#!/usr/bin/env node
import { mkdtempSync, readdirSync, lstatSync, readlinkSync, rmSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const packageAgents = resolve(__dirname, "..", "agents");

const agentDir = mkdtempSync(join(tmpdir(), "pi-fitch-kit-agent-"));
process.env.PI_CODING_AGENT_DIR = agentDir;

try {
  const extension = await import("../extensions/sync-agents.ts");
  const events = [];
  const notices = [];
  let sessionStart;

  extension.default({
    on(event, handler) {
      events.push(event);
      if (event === "session_start") sessionStart = handler;
    },
  });

  if (typeof sessionStart !== "function") {
    throw new Error(`Expected session_start handler, got events: ${events.join(", ")}`);
  }

  await sessionStart({}, { hasUI: true, ui: { notify: (message, level) => notices.push({ message, level }) } });

  const syncedDir = join(agentDir, "agents");
  const syncedAgents = readdirSync(syncedDir).sort();
  if (syncedAgents.length === 0) throw new Error("Expected synced agent symlinks");

  for (const agent of syncedAgents) {
    const target = join(syncedDir, agent);
    if (!lstatSync(target).isSymbolicLink()) throw new Error(`${agent} is not a symlink`);
    const linkTarget = resolve(dirname(target), readlinkSync(target));
    if (dirname(linkTarget) !== packageAgents) {
      throw new Error(`${agent} points outside package agents: ${linkTarget}`);
    }
  }

  // Symlink safety cases the extension must honor on resync:
  // a foreign symlink is preserved, a dangling foreign symlink is preserved
  // without throwing, and a dangling owned symlink is repaired.
  const { symlinkSync, unlinkSync } = await import("node:fs");
  const foreignSource = join(agentDir, "foreign-reviewer.md");
  writeFileSync(foreignSource, "user-owned reviewer\n", "utf-8");
  const foreignLink = join(syncedDir, "reviewer.md");
  unlinkSync(foreignLink);
  symlinkSync(foreignSource, foreignLink);

  const danglingForeignLink = join(syncedDir, "writer.md");
  unlinkSync(danglingForeignLink);
  symlinkSync(join(agentDir, "missing-user-file.md"), danglingForeignLink);

  const danglingOwnedLink = join(syncedDir, "scout.md");
  const ownedTarget = resolve(dirname(readlinkSync(join(syncedDir, "oracle.md"))), "renamed-away.md");
  unlinkSync(danglingOwnedLink);
  symlinkSync(ownedTarget, danglingOwnedLink);

  await sessionStart({}, { hasUI: false, ui: { notify: () => {} } });

  if (resolve(dirname(foreignLink), readlinkSync(foreignLink)) !== foreignSource) {
    throw new Error("Resync replaced a foreign symlink it does not own");
  }
  if (readlinkSync(danglingForeignLink) !== join(agentDir, "missing-user-file.md")) {
    throw new Error("Resync replaced a dangling foreign symlink");
  }
  const repaired = resolve(dirname(danglingOwnedLink), readlinkSync(danglingOwnedLink));
  if (repaired !== join(packageAgents, "scout.md")) {
    throw new Error(`Resync did not repair a dangling owned symlink: ${repaired}`);
  }

  const conflictPath = join(syncedDir, "worker.md");
  rmSync(conflictPath, { force: true });
  writeFileSync(conflictPath, "local override\n", "utf-8");
  const bashForeignLink = join(syncedDir, "planner.md");
  unlinkSync(bashForeignLink);
  symlinkSync(foreignSource, bashForeignLink);
  const sync = spawnSync("bash", [join(__dirname, "sync-agents.sh")], {
    env: { ...process.env, PI_CODING_AGENT_DIR: agentDir },
    encoding: "utf-8",
  });
  if (sync.status !== 0) throw new Error(`Manual sync failed: ${sync.stderr || sync.stdout}`);
  if (lstatSync(conflictPath).isSymbolicLink() || readFileSync(conflictPath, "utf-8") !== "local override\n") {
    throw new Error("Manual sync overwrote an existing non-symlink agent file");
  }
  if (resolve(dirname(bashForeignLink), readlinkSync(bashForeignLink)) !== foreignSource) {
    throw new Error("Manual sync replaced a foreign symlink it does not own");
  }

  // Manifest consistency: the setup prompt treats setup-manifest.json as the
  // source of truth, so drift between it, the agent profiles, and package.json
  // must fail this check.
  const root = resolve(__dirname, "..");
  const manifest = JSON.parse(readFileSync(join(root, "setup-manifest.json"), "utf-8"));
  const packageJson = JSON.parse(readFileSync(join(root, "package.json"), "utf-8"));

  const assert = (condition, message) => {
    if (!condition) throw new Error(message);
  };

  assert(
    JSON.stringify(packageJson.pi.extensions) === JSON.stringify(manifest.kitResources.extensions.map((p) => `./${p}`)),
    "package.json pi.extensions must match manifest kitResources.extensions",
  );
  assert(
    JSON.stringify(packageJson.pi.prompts) === JSON.stringify(manifest.kitResources.prompts.map((p) => `./${p}`)),
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

  const profileFiles = readdirSync(join(root, "agents")).filter((name) => name.endsWith(".md"));
  assert(
    profileFiles.length === manifest.kitResources.agentProfiles,
    `manifest says ${manifest.kitResources.agentProfiles} agent profiles, found ${profileFiles.length}`,
  );

  const allowedModels = new Set([...manifest.requiredModels, ...manifest.optionalModels]);
  for (const name of profileFiles) {
    const body = readFileSync(join(root, "agents", name), "utf-8");
    const models = [
      ...(body.match(/^model:\s*(.+)$/m)?.[1].split(",") ?? []),
      ...(body.match(/^fallbackModels:\s*(.+)$/m)?.[1].split(",") ?? []),
    ].map((model) => model.trim());
    assert(models.length > 0, `${name} declares no model`);
    for (const model of models) {
      assert(allowedModels.has(model), `${name} uses ${model}, which is not in the manifest model lists`);
    }
  }

  for (const pkg of manifest.corePackages) {
    assert(
      /^npm:(@?[\w./-]+)@\d+\.\d+\.\d+$/.test(pkg.source) || /^git:github\.com\/[\w-]+\/[\w-]+@[0-9a-f]{40}$/.test(pkg.source),
      `corePackages ${pkg.id} is not pinned to an exact npm version or 40-char commit: ${pkg.source}`,
    );
  }

  const setupPromptPath = manifest.kitResources.prompts.find((path) => path.endsWith("/fitch-setup.md"));
  assert(setupPromptPath, "manifest must include prompts/fitch-setup.md");
  const setupPrompt = readFileSync(join(root, setupPromptPath), "utf-8");
  assert(setupPrompt.includes("setup-manifest.json"), "setup prompt must reference the manifest");
  assert(
    setupPrompt.includes(`all ${manifest.kitResources.agentProfiles} files`),
    "setup prompt profile count drifted from the manifest",
  );

  console.log(JSON.stringify({ ok: true, events, syncedAgents, notices, manualSyncConflictPreserved: true, manifestChecked: true }, null, 2));
} finally {
  rmSync(agentDir, { recursive: true, force: true });
}
