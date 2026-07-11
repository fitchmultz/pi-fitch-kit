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

function pathExists(path) {
  try {
    lstatSync(path);
    return true;
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
}

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
