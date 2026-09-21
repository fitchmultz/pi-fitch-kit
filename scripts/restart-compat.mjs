import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

assert.notEqual(process.platform, "win32", "The native restart PTY contract requires a Unix runner");
const root = mkdtempSync(join(tmpdir(), "kit-restart-"));
const output = join(process.env.PI_COMPAT_EVIDENCE_DIR ?? root, "restart");
const mode = process.env.PI_COMPAT_HOST === "fork" ? "managed" : "unsupported";
const result = spawnSync("python3", ["scripts/session-restart-pty.py", "--node", process.execPath,
  "--output", output, "--runtime-dir", join(root, "runtime"), "--cases", mode], { stdio: "inherit" });
if (result.error) throw result.error;
assert.equal(result.status, 0, `Native ${mode} restart failed; retained journals and PTY evidence: ${output}`);
console.log(`Native ${mode} restart evidence: ${output}`);
