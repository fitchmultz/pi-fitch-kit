#!/usr/bin/env node

import { execFileSync, spawnSync } from "node:child_process";
import { copyFileSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import { basename, delimiter, dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const PI_PACKAGE = "@earendil-works/pi-coding-agent";
const PATCH_EXECUTABLE = "/usr/bin/patch";
const SHLOCK_EXECUTABLE = "/usr/bin/shlock";
const projectRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const patchPath = join(projectRoot, "patches/pi-0.84.1-compaction.patch");
const patchSha256 = "e22b2060d2e92e35499386eaf32cde9fe66de6d871b247ae5394c0a945bac486";
const legacyPatches = [
  {
    version: "0.4.3",
    path: join(projectRoot, "patches/archive/pi-0.84.1-compaction-v0.4.3.patch"),
    sha256: "9350641094f70ac3a98fd3b02a236861fbbbc13503855637a1dc2ff53971dd08",
    agentSession: "e55bf39d43ab95468a8949dd72c541adc1e54421c8666f9d06e06e4b9efa7227",
  },
  {
    version: "0.4.2",
    path: join(projectRoot, "patches/archive/pi-0.84.1-compaction-v0.4.2.patch"),
    sha256: "5f68de3bb9689ad983168a683bd2cc43426e19325071b75d6fd36425ac191b24",
    agentSession: "cd1f9b9a0b6ad10239394568be5961c5a7d8fc117830e1a09650eb5ade176c6a",
  },
];
const commonFiles = {
  "dist/core/agent-session.js": {
    stock: "91e72d5497f665e731cbd79da6a6e826d8cae7d2ce156a7dee39f8ca205e32c8",
    patched: "ee4ffc5bcdfc8b348280f0b370f17f839deb7f11fdeefb9e72b020bbeb1758e2",
  },
  "dist/core/compaction/compaction.js": {
    stock: "fcb12f1eb4d38578978e1a8e3e382a3fccfd5e0ccf87bc86979a9a8d9c145c7b",
    patched: "476b9cd8329f3b6ea94a7aeca663b1bd3992319b04f088ffd6025ce7959cec2e",
  },
};
const interactiveModeHashes = {
  "0.84.0": {
    stock: "1efe4f58c10593e0d283b3e6d5bf4fd342d8e5d681f1fbc9dfbb7cc03fe4b266",
    patched: "702beb350dcb588bd52e0f061e9d9d72ef62ed85a061ed7b9fc650e9daa607e3",
  },
  "0.84.1": {
    stock: "da01f077caca6e7c440ea05e7226a64dffdfd96e8e53a1ffaca4bd7d6e186261",
    patched: "28c7d6d73fbf0fd69beb750cb622251732113bb55d1903644bb4fe93bbd6516f",
  },
};
let piVersion;
let files;

function fail(message) {
  throw new Error(message);
}

function sha256(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function canonicalPath(path) {
  try {
    return realpathSync(path);
  } catch {
    return resolve(path ?? "");
  }
}

function assertSafePath(root, target, allowMissing = false) {
  const absolute = resolve(target);
  if (absolute !== root && !absolute.startsWith(`${root}${sep}`)) {
    fail(`Refusing path outside Pi package root: ${absolute}`);
  }
  let current = root;
  for (const part of relative(root, absolute).split(sep).filter(Boolean)) {
    current = join(current, part);
    let stat;
    try {
      stat = lstatSync(current);
    } catch (error) {
      if (allowMissing && error?.code === "ENOENT") return;
      throw error;
    }
    if (stat.isSymbolicLink()) fail(`Refusing symlinked Pi path: ${current}`);
  }
}

function acquireLock(root) {
  if (!existsSync(SHLOCK_EXECUTABLE)) fail(`Required lock executable not found: ${SHLOCK_EXECUTABLE}`);
  const lockPath = join(root, ".pi-fitch-kit.lock");
  assertSafePath(root, lockPath, true);
  const result = spawnSync(
    SHLOCK_EXECUTABLE,
    ["-f", lockPath, "-p", String(process.pid)],
    { encoding: "utf8" },
  );
  if (result.status !== 0) {
    const owner = existsSync(lockPath) ? readFileSync(lockPath, "utf8").trim() : "unknown";
    fail(`Pi core operation already in progress (pid ${owner}): ${lockPath}`);
  }
  return () => {
    try {
      if (readFileSync(lockPath, "utf8").trim() === String(process.pid)) {
        rmSync(lockPath, { force: true });
      }
    } catch {
      // Do not remove a lock we can no longer prove we own.
    }
  };
}

function parseArgs() {
  const args = process.argv.slice(2);
  const action = args.shift() ?? "status";
  if (!["apply", "restore", "status"].includes(action)) {
    fail("Usage: reapply-pi-core-compaction.mjs <apply|restore|status> [--pi-root <path>]");
  }
  let explicitRoot;
  let hasExplicitRoot = false;
  while (args.length > 0) {
    const flag = args.shift();
    if (flag !== "--pi-root" || args.length === 0 || hasExplicitRoot) {
      fail("Usage: reapply-pi-core-compaction.mjs <apply|restore|status> [--pi-root <path>]");
    }
    explicitRoot = args.shift();
    hasExplicitRoot = true;
    if (explicitRoot.trim() === "") fail("--pi-root must not be empty");
  }
  return { action, explicitRoot };
}

function resolvePiRoot(explicitRoot) {
  if (explicitRoot !== undefined) return realpathSync(resolve(explicitRoot));
  const activePath = (process.env.PATH ?? "")
    .split(delimiter)
    .filter((entry) => !resolve(entry).endsWith(`${sep}node_modules${sep}.bin`))
    .join(delimiter);
  const executable = execFileSync("which", ["pi"], {
    encoding: "utf8",
    env: { ...process.env, PATH: activePath },
  }).trim();
  const realExecutable = realpathSync(executable);
  const root = dirname(dirname(realExecutable));
  const cliPath = join(root, "dist/cli.js");
  if (!existsSync(cliPath)) {
    fail(`Unable to resolve a Pi package root from ${realExecutable}; pass --pi-root explicitly`);
  }
  if (realExecutable !== realpathSync(cliPath)) {
    fail(`Refusing unexpected Pi executable: ${realExecutable}; pass --pi-root explicitly`);
  }
  return root;
}

function verifyInstallation(root) {
  const packageJsonPath = join(root, "package.json");
  if (!existsSync(packageJsonPath)) fail(`Not a Pi package root: ${root}`);
  const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf8"));
  const interactiveMode = interactiveModeHashes[packageJson.version];
  if (packageJson.name !== PI_PACKAGE || !interactiveMode) {
    fail(`Refusing ${packageJson.name ?? "unknown package"}@${packageJson.version ?? "unknown version"} at ${root}; expected ${PI_PACKAGE}@${Object.keys(interactiveModeHashes).join(" or ")}`);
  }
  piVersion = packageJson.version;
  files = {
    ...commonFiles,
    "dist/modes/interactive/interactive-mode.js": interactiveMode,
  };
  for (const relativePath of Object.keys(files)) {
    assertSafePath(root, join(root, relativePath));
  }
  assertSafePath(root, join(root, "dist/cli.js"));
}

function verifyPatch(path, expected) {
  if (sha256(path) !== expected) fail(`Patch checksum mismatch: ${path}`);
}

function state(root) {
  const hashes = Object.fromEntries(
    Object.keys(files).map((relativePath) => [relativePath, sha256(join(root, relativePath))]),
  );
  if (Object.entries(files).every(([path, expected]) => hashes[path] === expected.stock)) {
    return { name: "stock" };
  }
  if (Object.entries(files).every(([path, expected]) => hashes[path] === expected.patched)) {
    return { name: "patched" };
  }
  const legacyPatch = legacyPatches.find(
    ({ agentSession }) =>
      hashes["dist/core/agent-session.js"] === agentSession &&
      Object.entries(files).every(
        ([path, expected]) => path === "dist/core/agent-session.js" || hashes[path] === expected.patched,
      ),
  );
  if (legacyPatch) return { name: "legacy-patched", legacyPatch };
  const detail = Object.entries(hashes).map(([path, hash]) => `${path}: ${hash}`).join("\n");
  fail(`Pi core diverges from both reviewed stock and patched states; refusing mutation:\n${detail}`);
}

function backupPaths(root) {
  const backupRoot = join(root, ".pi-fitch-kit-backup", `pi-${piVersion}-compaction`);
  return {
    backupRoot,
    manifestPath: join(backupRoot, "manifest.json"),
    journalPath: join(backupRoot, "journal.json"),
  };
}

function verifyBackup(root) {
  const { backupRoot, manifestPath } = backupPaths(root);
  assertSafePath(root, backupRoot, true);
  if (!existsSync(backupRoot)) return false;
  if (!existsSync(manifestPath)) fail(`Backup manifest missing: ${manifestPath}`);
  assertSafePath(root, manifestPath);
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  if (canonicalPath(manifest.packageRoot) !== root || manifest.version !== piVersion) {
    fail(`Backup belongs to an unexpected installation: ${manifestPath}`);
  }
  for (const [relativePath, expected] of Object.entries(files)) {
    const backupPath = join(backupRoot, relativePath);
    assertSafePath(root, backupPath);
    if (sha256(backupPath) !== expected.stock) {
      fail(`Backup preimage mismatch: ${backupPath}`);
    }
  }
  return true;
}

function backupStock(root) {
  const { backupRoot } = backupPaths(root);
  if (verifyBackup(root)) return;
  const backupParent = dirname(backupRoot);
  assertSafePath(root, backupParent, true);
  mkdirSync(backupParent, { recursive: true });
  const stagingPrefix = `${basename(backupRoot)}.tmp-`;
  for (const entry of readdirSync(backupParent)) {
    if (!entry.startsWith(stagingPrefix)) continue;
    const stale = join(backupParent, entry);
    assertSafePath(root, stale);
    rmSync(stale, { recursive: true, force: true });
  }
  const stagingRoot = mkdtempSync(`${backupRoot}.tmp-`);
  try {
    for (const [relativePath, expected] of Object.entries(files)) {
      const source = join(root, relativePath);
      if (sha256(source) !== expected.stock) fail(`Stock preimage changed before backup: ${source}`);
      const destination = join(stagingRoot, relativePath);
      mkdirSync(dirname(destination), { recursive: true });
      copyFileSync(source, destination);
      if (sha256(destination) !== expected.stock) {
        fail(`Staged backup preimage mismatch: ${destination}`);
      }
    }
    writeFileSync(
      join(stagingRoot, "manifest.json"),
      `${JSON.stringify({ packageRoot: root, package: PI_PACKAGE, version: piVersion, patchSha256, files }, null, 2)}\n`,
      "utf8",
    );
    renameSync(stagingRoot, backupRoot);
  } finally {
    rmSync(stagingRoot, { recursive: true, force: true });
  }
  verifyBackup(root);
}

function writeJournal(root, action, before) {
  const { journalPath } = backupPaths(root);
  const temporary = `${journalPath}.tmp-${process.pid}-${randomUUID()}`;
  writeFileSync(
    temporary,
    `${JSON.stringify({ packageRoot: root, version: piVersion, action, before })}\n`,
    "utf8",
  );
  renameSync(temporary, journalPath);
}

function clearJournal(root) {
  rmSync(backupPaths(root).journalPath, { force: true });
}

function readRecoveryJournal(root, hasBackup = verifyBackup(root)) {
  const { journalPath } = backupPaths(root);
  if (!existsSync(journalPath)) return undefined;
  if (!hasBackup) fail(`Verified stock backup missing for recovery journal: ${journalPath}`);
  assertSafePath(root, journalPath);
  const journal = JSON.parse(readFileSync(journalPath, "utf8"));
  if (canonicalPath(journal.packageRoot) !== root || journal.version !== piVersion) {
    fail(`Recovery journal belongs to an unexpected installation: ${journalPath}`);
  }
  const target = journal.action === "apply" ? "patched" : journal.action === "restore" ? "stock" : undefined;
  if (!target) fail(`Recovery journal has an invalid action: ${journalPath}`);
  return { journal, target };
}

function recoverInterruptedMutation(root) {
  const pending = readRecoveryJournal(root);
  if (!pending) return false;
  const { backupRoot } = backupPaths(root);
  try {
    if (state(root).name === pending.target) {
      clearJournal(root);
      return false;
    }
  } catch {
    // Mixed state: restore the verified stock preimage below.
  }
  for (const [relativePath] of Object.entries(files)) {
    const source = join(backupRoot, relativePath);
    const destination = join(root, relativePath);
    const temporary = `${destination}.pi-fitch-kit-recovery-${randomUUID()}`;
    copyFileSync(source, temporary);
    renameSync(temporary, destination);
  }
  if (state(root).name !== "stock") fail("Interrupted Pi core mutation recovery did not restore stock");
  checkSyntax(root);
  clearJournal(root);
  return true;
}

function readStatus(root) {
  const hasBackup = verifyBackup(root);
  const pending = readRecoveryJournal(root, hasBackup);
  let current;
  try {
    current = state(root);
  } catch (error) {
    if (!pending) throw error;
    current = { name: "mixed" };
  }
  if (current.name !== "stock" && !hasBackup) {
    fail(`Verified stock backup missing for ${current.name} installation`);
  }
  if (pending) {
    return {
      state: "recovery-needed",
      currentState: current.name,
      pendingAction: pending.journal.action,
    };
  }
  return {
    state: current.name,
    ...(current.legacyPatch ? { legacyPatchVersion: current.legacyPatch.version } : {}),
  };
}

function runPatch(root, reverse, dryRun, source = patchPath) {
  if (!existsSync(PATCH_EXECUTABLE)) fail(`Required patch executable not found: ${PATCH_EXECUTABLE}`);
  const args = ["--batch", "--forward", "--no-backup-if-mismatch", "--reject-file=-", "-p1", "-d", root];
  if (reverse) args.unshift("--reverse");
  if (dryRun) args.unshift("--dry-run");
  const result = spawnSync(PATCH_EXECUTABLE, args, { encoding: "utf8", input: readFileSync(source) });
  if (result.status !== 0) {
    fail(`Patch ${dryRun ? "preflight" : "mutation"} failed:\n${result.stdout}${result.stderr}`);
  }
}

function checkSyntax(root) {
  for (const relativePath of Object.keys(files)) {
    execFileSync(process.execPath, ["--check", join(root, relativePath)], { stdio: "pipe" });
  }
}

function planSteps(action, before) {
  if (action === "restore") {
    return [{ reverse: true, source: before.legacyPatch?.path ?? patchPath }];
  }
  if (before.legacyPatch) {
    // One-step migration: reverse the superseded reviewed patch, verify the
    // exact stock intermediate, then apply the current patch. Main has already
    // required the legacy install's verified stock backup before this plan runs.
    // Failures roll back to the same legacy-patched pre-state.
    return [
      { reverse: true, source: before.legacyPatch.path, verify: "stock" },
      { reverse: false, source: patchPath },
    ];
  }
  return [{ reverse: false, source: patchPath }];
}

function mutateAndVerify(root, action, before, steps) {
  const snapshots = Object.fromEntries(
    Object.keys(files).map((relativePath) => [relativePath, readFileSync(join(root, relativePath))]),
  );
  try {
    for (const step of steps) {
      runPatch(root, step.reverse, false, step.source);
      if (step.verify && state(root).name !== step.verify) {
        fail(`Expected ${step.verify} state mid-${action}, found a divergent intermediate`);
      }
    }
    const expected = action === "apply" ? "patched" : "stock";
    const after = state(root);
    if (after.name !== expected) fail(`Expected ${expected} state after ${action}, found ${after.name}`);
    checkSyntax(root);
    clearJournal(root);
    return after;
  } catch (error) {
    try {
      for (const [relativePath, contents] of Object.entries(snapshots)) {
        writeFileSync(join(root, relativePath), contents);
      }
      const restored = state(root);
      if (
        restored.name !== before.name ||
        restored.legacyPatch?.version !== before.legacyPatch?.version
      ) {
        fail(`Rollback restored ${restored.name}, expected ${before.name}`);
      }
      checkSyntax(root);
      clearJournal(root);
    } catch (rollbackError) {
      throw new AggregateError([error, rollbackError], `Pi core ${action} failed and rollback could not be verified`);
    }
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Pi core ${action} failed; restored and verified the ${before.name} pre-operation state.\n${message}`, { cause: error });
  }
}

function main() {
  const { action, explicitRoot } = parseArgs();
  const root = resolvePiRoot(explicitRoot);
  verifyInstallation(root);
  const report = (result) => console.log(
    JSON.stringify({ ok: true, action, packageRoot: root, version: piVersion, ...result }, null, 2),
  );
  if (action === "status") {
    report(readStatus(root));
    return;
  }
  const releaseLock = acquireLock(root);
  try {
    const recovered = recoverInterruptedMutation(root);
    const before = state(root);
    const hasBackup = verifyBackup(root);
    if (before.name !== "stock" && !hasBackup) {
      fail(`Verified stock backup missing for ${before.name} installation`);
    }
    if ((action === "apply" && before.name !== "patched") ||
        (action === "restore" && before.name === "patched")) {
      verifyPatch(patchPath, patchSha256);
    }
    if (before.legacyPatch) {
      verifyPatch(before.legacyPatch.path, before.legacyPatch.sha256);
    }

    if (action === "apply" && before.name === "patched") {
      report({ state: "already-patched", changed: false, ...(recovered ? { recovered: true } : {}) });
      return;
    }
    if (action === "restore" && before.name === "stock") {
      report({ state: "already-stock", changed: false, ...(recovered ? { recovered: true } : {}) });
      return;
    }

    const steps = planSteps(action, before);
    runPatch(root, steps[0].reverse, true, steps[0].source);
    if (before.name === "stock") backupStock(root);
    writeJournal(root, action, before.name);
    const after = mutateAndVerify(root, action, before, steps);
    report({
      state: after.name,
      changed: true,
      ...(before.legacyPatch
        ? { migratedFrom: "legacy-patched", legacyPatchVersion: before.legacyPatch.version }
        : {}),
      ...(recovered ? { recovered: true } : {}),
    });
  } finally {
    releaseLock();
  }
}

main();
