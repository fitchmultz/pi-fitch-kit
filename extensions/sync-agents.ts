import { existsSync, lstatSync, mkdirSync, readdirSync, readlinkSync, symlinkSync, unlinkSync } from "fs";
import { basename, dirname, join, resolve } from "path";
import { fileURLToPath } from "url";

import { getAgentDir, type ExtensionAPI } from "@earendil-works/pi-coding-agent";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const sourceDir = join(packageRoot, "agents");
const targetDir = join(getAgentDir(), "agents");

function syncAgents(): { linked: number; skipped: number } {
  if (!existsSync(sourceDir)) return { linked: 0, skipped: 0 };

  mkdirSync(targetDir, { recursive: true });

  let linked = 0;
  let skipped = 0;

  for (const entry of readdirSync(sourceDir, { withFileTypes: true })) {
    if (!entry.isFile()) continue;
    if (!entry.name.endsWith(".md") && !entry.name.endsWith(".chain.md")) continue;

    const source = join(sourceDir, entry.name);
    const target = join(targetDir, basename(entry.name));

    if (existsSync(target)) {
      const stat = lstatSync(target);
      if (!stat.isSymbolicLink()) {
        skipped += 1;
        continue;
      }
      const current = resolve(dirname(target), readlinkSync(target));
      if (current === source) {
        linked += 1;
        continue;
      }
      unlinkSync(target);
    }

    symlinkSync(source, target);
    linked += 1;
  }

  return { linked, skipped };
}

export default function fitchKit(pi: ExtensionAPI) {
  syncAgents();

  pi.on("session_start", async (_event, ctx) => {
    const result = syncAgents();
    if (result.skipped > 0 && ctx.hasUI) {
      ctx.ui.notify(
        `pi-fitch-kit synced ${result.linked} agent symlink(s); skipped ${result.skipped} non-symlink target(s) in ${targetDir}`,
        "warning",
      );
    }
  });
}
