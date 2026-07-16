#!/usr/bin/env node
import {
  lstatSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  readlinkSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const sourceAgentsDir = resolve(__dirname, "../agents");

const agentPolicies = {
  "context-builder": { model: "cursor/grok-4.5:high", fallbackModels: "openai-codex/gpt-5.6-sol:medium", maxSubagentDepth: "1", allowSubagents: "true", output: "context.md" },
  fixer: { model: "openai-codex/gpt-5.6-sol", fallbackModels: "claude-code/fable", thinking: "high", maxSubagentDepth: "0" },
  oracle: { model: "openai-codex/gpt-5.6-sol", thinking: "xhigh", defaultContext: "fork", maxSubagentDepth: "0" },
  planner: { model: "openai-codex/gpt-5.6-sol", fallbackModels: "claude-code/fable", thinking: "xhigh", maxSubagentDepth: "1", allowSubagents: "true", output: "plan.md" },
  researcher: { model: "openai-codex/gpt-5.6-sol", fallbackModels: "claude-code/fable", thinking: "xhigh", maxSubagentDepth: "0", output: "research.md", defaultProgress: "false" },
  reviewer: { model: "openai-codex/gpt-5.6-sol", fallbackModels: "claude-code/fable", thinking: "xhigh", maxSubagentDepth: "0", output: "false" },
  scout: { model: "cursor/grok-4.5:high", fallbackModels: "openai-codex/gpt-5.6-sol:medium", maxSubagentDepth: "0", output: "context.md" },
  "ui-designer": { model: "openai-codex/gpt-5.6-sol", fallbackModels: "openai-codex/gpt-5.6-terra", thinking: "xhigh", systemPromptMode: "replace", maxSubagentDepth: "0", output: "false" },
  worker: { model: "openai-codex/gpt-5.6-sol", fallbackModels: "claude-code/fable", thinking: "medium", maxSubagentDepth: "0", allowSubagents: "false" },
};

function parseAgentFrontmatter(file) {
  const lines = readFileSync(file, "utf-8").replaceAll("\r\n", "\n").split("\n");
  const end = lines.indexOf("---", 1);
  if (lines[0] !== "---" || end < 2) throw new Error(`${basename(file)} has invalid frontmatter boundaries`);
  if (!lines.slice(end + 1).join("\n").trim()) throw new Error(`${basename(file)} has no system prompt`);

  const frontmatter = {};
  for (const line of lines.slice(1, end)) {
    if (!line.trim() || line.startsWith("#")) continue;
    const match = line.match(/^([\w-]+):\s*(.*)$/);
    if (!match) throw new Error(`${basename(file)} has frontmatter pi-subagents would ignore: ${line}`);
    const key = match[1];
    if (Object.hasOwn(frontmatter, key)) throw new Error(`${basename(file)} has duplicate frontmatter key: ${key}`);
    let value = match[2].trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    frontmatter[key] = value;
  }
  return frontmatter;
}

function validateAgentDefinitions() {
  const actualFiles = readdirSync(sourceAgentsDir).filter((name) => name.endsWith(".md")).sort();
  const expectedFiles = Object.keys(agentPolicies).map((name) => `${name}.md`).sort();
  if (JSON.stringify(actualFiles) !== JSON.stringify(expectedFiles)) {
    throw new Error(`Agent inventory mismatch: expected ${expectedFiles.join(", ")}; got ${actualFiles.join(", ")}`);
  }

  for (const [name, policy] of Object.entries(agentPolicies)) {
    const frontmatter = parseAgentFrontmatter(join(sourceAgentsDir, `${name}.md`));
    const expected = {
      name,
      model: policy.model,
      fallbackModels: policy.fallbackModels,
      thinking: policy.thinking,
      systemPromptMode: policy.systemPromptMode ?? "append",
      inheritProjectContext: "true",
      inheritSkills: "true",
      defaultContext: policy.defaultContext ?? "fresh",
      allowSubagents: policy.allowSubagents,
      maxSubagentDepth: policy.maxSubagentDepth,
      output: policy.output,
      defaultProgress: policy.defaultProgress,
      tools: undefined,
    };
    if (!frontmatter.description) throw new Error(`${name}.md is missing description`);
    const allowedKeys = new Set(["description", ...Object.entries(expected).filter(([, value]) => value !== undefined).map(([key]) => key)]);
    for (const key of Object.keys(frontmatter)) {
      if (!allowedKeys.has(key)) throw new Error(`${name}.md has unexpected policy key: ${key}`);
    }
    for (const [key, value] of Object.entries(expected)) {
      if (frontmatter[key] !== value) {
        throw new Error(`${name}.md ${key}: expected ${String(value)}, got ${String(frontmatter[key])}`);
      }
    }
  }
}

function pathExists(path) {
  try {
    lstatSync(path);
    return true;
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
}

validateAgentDefinitions();

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
  const firstTarget = join(syncedDir, readdirSync(syncedDir)[0]);
  const sourceDir = dirname(resolve(dirname(firstTarget), readlinkSync(firstTarget)));
  const stalePath = join(syncedDir, "removed-agent.md");
  const brokenPath = join(syncedDir, "scout.md");
  const selfLoopPath = join(syncedDir, "worker.md");
  const cycleAPath = join(syncedDir, "reviewer.md");
  const cycleBPath = join(syncedDir, "fixer.md");
  symlinkSync(join(sourceDir, "removed-agent.md"), stalePath);
  for (const path of [brokenPath, selfLoopPath, cycleAPath, cycleBPath]) rmSync(path);
  symlinkSync(join(sourceDir, "missing-scout.md"), brokenPath);
  symlinkSync(selfLoopPath, selfLoopPath);
  symlinkSync(cycleBPath, cycleAPath);
  symlinkSync(cycleAPath, cycleBPath);

  await Promise.all([
    sessionStart({}, { hasUI: false, ui: { notify() {} } }),
    sessionStart({}, { hasUI: false, ui: { notify() {} } }),
  ]);
  if (pathExists(stalePath)) throw new Error("Expected stale package-owned symlink to be removed");
  for (const path of [brokenPath, selfLoopPath, cycleAPath, cycleBPath]) {
    const expected = join(sourceDir, basename(path));
    if (resolve(dirname(path), readlinkSync(path)) !== expected) {
      throw new Error(`Expected malformed agent symlink to be repaired: ${path}`);
    }
  }

  const syncedAgents = readdirSync(syncedDir).sort();
  if (syncedAgents.length === 0) throw new Error("Expected synced agent symlinks");

  for (const agent of syncedAgents) {
    const target = join(syncedDir, agent);
    if (!lstatSync(target).isSymbolicLink()) throw new Error(`${agent} is not a symlink`);
    const linkTarget = resolve(dirname(target), readlinkSync(target));
    if (linkTarget !== join(sourceDir, agent)) {
      throw new Error(`${agent} points outside package agents: ${linkTarget}`);
    }
  }

  const conflictPath = join(syncedDir, "worker.md");
  rmSync(conflictPath);
  writeFileSync(conflictPath, "local override\n", "utf-8");
  const hasBash = process.platform !== "win32" && spawnSync("bash", ["--version"]).status === 0;
  if (hasBash) {
    const sync = spawnSync("bash", [join(__dirname, "sync-agents.sh")], {
      env: { ...process.env, PI_CODING_AGENT_DIR: agentDir },
      encoding: "utf-8",
    });
    if (sync.status !== 0) throw new Error(`Manual sync failed: ${sync.stderr || sync.stdout}`);
    if (lstatSync(conflictPath).isSymbolicLink() || readFileSync(conflictPath, "utf-8") !== "local override\n") {
      throw new Error("Manual sync overwrote an existing non-symlink agent file");
    }
  }

  await sessionStart({}, { hasUI: true, ui: { notify: (message, level) => notices.push({ message, level }) } });
  if (lstatSync(conflictPath).isSymbolicLink() || readFileSync(conflictPath, "utf-8") !== "local override\n") {
    throw new Error("Extension sync overwrote an existing non-symlink agent file");
  }
  if (!notices.some(({ level }) => level === "warning")) {
    throw new Error("Expected a warning for an existing non-symlink agent file");
  }

  console.log(
    JSON.stringify(
      {
        ok: true,
        events,
        syncedAgents,
        notices,
        agentDefinitionsValidated: true,
        concurrentSyncSafe: true,
        malformedSymlinksRepaired: true,
        staleSymlinkRemoved: true,
        manualSyncConflictPreserved: hasBash ? true : "skipped: bash unavailable or Windows",
        extensionConflictPreservedAndReported: true,
      },
      null,
      2,
    ),
  );
} finally {
  rmSync(agentDir, { recursive: true, force: true });
}
