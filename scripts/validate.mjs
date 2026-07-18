#!/usr/bin/env node
import { mkdtempSync, readdirSync, lstatSync, readlinkSync, rmSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

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
    if (!linkTarget.includes("/pi-fitch-kit/agents/")) {
      throw new Error(`${agent} points outside package agents: ${linkTarget}`);
    }
  }

  const conflictPath = join(syncedDir, "worker.md");
  rmSync(conflictPath, { force: true });
  writeFileSync(conflictPath, "local override\n", "utf-8");
  const sync = spawnSync("bash", [join(__dirname, "sync-agents.sh")], {
    env: { ...process.env, PI_CODING_AGENT_DIR: agentDir },
    encoding: "utf-8",
  });
  if (sync.status !== 0) throw new Error(`Manual sync failed: ${sync.stderr || sync.stdout}`);
  if (lstatSync(conflictPath).isSymbolicLink() || readFileSync(conflictPath, "utf-8") !== "local override\n") {
    throw new Error("Manual sync overwrote an existing non-symlink agent file");
  }

  console.log(JSON.stringify({ ok: true, events, syncedAgents, notices, manualSyncConflictPreserved: true }, null, 2));
} finally {
  rmSync(agentDir, { recursive: true, force: true });
}
