import type { Dirent } from "node:fs";
import { lstat, mkdir, readdir, readlink, realpath, symlink, unlink } from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

import { getAgentDir, type ExtensionAPI, withFileMutationQueue } from "@earendil-works/pi-coding-agent";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const sourceDir = join(packageRoot, "agents");
const targetDir = join(getAgentDir(), "agents");

async function pathType(path: string): Promise<"symlink" | "other" | "missing"> {
  try {
    return (await lstat(path)).isSymbolicLink() ? "symlink" : "other";
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return "missing";
    throw error;
  }
}

async function mutationQueuePath(path: string): Promise<string> {
  if ((await pathType(path)) !== "symlink") return path;
  try {
    return await realpath(path);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ELOOP" || code === "ENOENT") return `${path}.pi-fitch-kit-sync`;
    throw error;
  }
}

type SyncResult = { linked: number; removed: number; skipped: number };
let syncQueue = Promise.resolve();

async function syncAgentsOnce(): Promise<SyncResult> {
  let sourceEntries: Dirent[];
  try {
    sourceEntries = await readdir(sourceDir, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { linked: 0, removed: 0, skipped: 0 };
    throw error;
  }

  await mkdir(targetDir, { recursive: true });

  let linked = 0;
  let removed = 0;
  let skipped = 0;
  const sourceNames = new Set(
    sourceEntries.filter((entry) => entry.isFile() && entry.name.endsWith(".md")).map((entry) => entry.name),
  );

  for (const entry of await readdir(targetDir, { withFileTypes: true })) {
    if (!entry.isSymbolicLink() || !entry.name.endsWith(".md")) continue;

    const target = join(targetDir, entry.name);
    await withFileMutationQueue(await mutationQueuePath(target), async () => {
      if ((await pathType(target)) !== "symlink") return;
      const current = resolve(dirname(target), await readlink(target));
      if (current.startsWith(`${sourceDir}${sep}`) && !sourceNames.has(entry.name)) {
        await unlink(target);
        removed += 1;
      }
    });
  }

  for (const name of sourceNames) {
    const source = join(sourceDir, name);
    const target = join(targetDir, name);

    await withFileMutationQueue(await mutationQueuePath(target), async () => {
      const type = await pathType(target);
      if (type === "other") {
        skipped += 1;
        return;
      }
      if (type === "symlink") {
        const current = resolve(dirname(target), await readlink(target));
        if (current === source) {
          linked += 1;
          return;
        }
        await unlink(target);
      }

      await symlink(source, target);
      linked += 1;
    });
  }

  return { linked, removed, skipped };
}

export function syncAgents(): Promise<SyncResult> {
  const run = syncQueue.then(syncAgentsOnce, syncAgentsOnce);
  syncQueue = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

export default function fitchKit(pi: ExtensionAPI) {
  pi.on("session_start", async (_event, ctx) => {
    const result = await syncAgents();
    if (result.skipped > 0 && ctx.hasUI) {
      ctx.ui.notify(
        `pi-fitch-kit synced ${result.linked} agent symlink(s), removed ${result.removed} stale symlink(s); skipped ${result.skipped} non-symlink target(s) in ${targetDir}`,
        "warning",
      );
    }
  });
}
