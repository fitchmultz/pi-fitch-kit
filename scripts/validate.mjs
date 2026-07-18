#!/usr/bin/env node
import {
  existsSync,
  lstatSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  readlinkSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { spawn } from "node:child_process";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const read = (path) => readFileSync(join(root, path), "utf8");
const json = (path) => JSON.parse(read(path));
const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};
const same = (actual, expected, message) =>
  assert(JSON.stringify(actual) === JSON.stringify(expected), `${message}\nexpected ${JSON.stringify(expected)}\nactual   ${JSON.stringify(actual)}`);
const includesAll = (text, needles, label) => {
  for (const needle of needles) assert(text.includes(needle), `${label} missing ${JSON.stringify(needle)}`);
};
const run = (command, args, env) => new Promise((resolveRun, rejectRun) => {
  const child = spawn(command, args, { env, stdio: ["ignore", "pipe", "pipe"] });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => { stdout += chunk; });
  child.stderr.on("data", (chunk) => { stderr += chunk; });
  child.on("error", rejectRun);
  child.on("exit", (code, signal) => {
    if (code === 0) resolveRun({ stdout, stderr });
    else rejectRun(new Error(`${command} ${args.join(" ")} failed (${code ?? signal}): ${stderr || stdout}`));
  });
});

const packageJson = json("package.json");
const manifest = json("setup-manifest.json");
const lock = json("package-lock.json");

same(packageJson.pi.extensions, [
  "./extensions/nested-agents.ts",
  "./extensions/calculator/index.ts",
], "Pi extension resources changed");
same(packageJson.pi.prompts, ["./prompts/fitch-setup.md"], "Pi must load exactly /fitch-setup");
assert(packageJson.name === "@fitch/pi-kit" && packageJson.private === true, "Package name/private publication guard changed");
assert(packageJson.license === "MIT", "Package must declare MIT");
assert(packageJson.repository?.url === "git+https://github.com/fitchmultz/pi-fitch-kit.git", "Public Git repository metadata changed");
assert(packageJson.homepage === "https://github.com/fitchmultz/pi-fitch-kit#readme", "Public Git homepage changed");
same(packageJson.files, [
  "agents/",
  "extensions/",
  "scripts/sync-agents.mjs",
  "scripts/sync-agents.sh",
  "prompts/fitch-setup.md",
  "templates/working-agreement.md",
  "setup-manifest.json",
  "docs/pi-setup.md",
  "README.md",
  "CHANGELOG.md",
  "LICENSE",
], "Published file allowlist changed");
assert(packageJson.engines?.node === ">=24", "Node engine must be >=24");
same(packageJson.dependencies, { "decimal.js": "10.6.0", "expr-eval-fork": "3.0.3" }, "Calculator runtime pins changed");
assert(packageJson.devDependencies?.["@earendil-works/pi-coding-agent"] === "0.80.10", "Pi dev types must be pinned to 0.80.10");
for (const peer of ["@earendil-works/pi-ai", "@earendil-works/pi-coding-agent"]) {
  assert(packageJson.peerDependencies?.[peer] === "*", `${peer} must remain a wildcard peer`);
  assert(packageJson.peerDependenciesMeta?.[peer]?.optional === true, `${peer} must remain optional`);
}
assert(lock.packages?.[""]?.engines?.node === ">=24", "Lockfile Node engine is stale");
assert(lock.packages?.["node_modules/@earendil-works/pi-coding-agent"]?.version === "0.80.10", "Lockfile Pi dev version is stale");
for (const resource of [...packageJson.pi.extensions, ...packageJson.pi.prompts]) {
  assert(existsSync(join(root, resource)), `Missing Pi resource ${resource}`);
}

const expectedAgents = {
  "context-builder.md": ["openai-codex/gpt-5.6-sol", undefined, "medium", "fresh"],
  "fixer.md": ["openai-codex/gpt-5.6-sol", "anthropic/claude-fable-5", "high", "fresh"],
  "oracle.md": ["openai-codex/gpt-5.6-sol", undefined, "high", "fork"],
  "planner.md": ["openai-codex/gpt-5.6-sol", "anthropic/claude-fable-5", "high", "fresh"],
  "researcher.md": ["openai-codex/gpt-5.6-sol", "anthropic/claude-fable-5", "high", "fresh"],
  "reviewer-claude.md": ["anthropic/claude-fable-5", "anthropic/claude-opus-4-8", "high", "fresh"],
  "reviewer-gpt.md": ["openai-codex/gpt-5.6-sol", "openai-codex/gpt-5.6-terra", "high", "fresh"],
  "reviewer.md": ["openai-codex/gpt-5.6-sol", "openai-codex/gpt-5.6-terra", "high", "fresh"],
  "scout.md": ["openai-codex/gpt-5.6-sol", undefined, "medium", "fresh"],
  "ui-designer.md": ["openai-codex/gpt-5.6-sol", "anthropic/claude-fable-5", "high", "fresh"],
  "worker.md": ["openai-codex/gpt-5.6-sol", "anthropic/claude-fable-5", "high", "fresh"],
};
const agentNames = readdirSync(join(root, "agents")).filter((name) => name.endsWith(".md")).sort();
same(agentNames, Object.keys(expectedAgents).sort(), "Agent profiles must be exactly the expected 11 files");
for (const name of agentNames) {
  const source = read(`agents/${name}`);
  const frontmatter = source.match(/^---\n([\s\S]*?)\n---/)?.[1];
  assert(frontmatter, `${name} has no frontmatter`);
  const fields = Object.fromEntries(frontmatter.split("\n").map((line) => {
    const separator = line.indexOf(":");
    return [line.slice(0, separator), line.slice(separator + 1).trim()];
  }));
  same([fields.model, fields.fallbackModels, fields.thinking, fields.defaultContext], expectedAgents[name], `${name} model policy changed`);
  assert(!("tools" in fields), `${name} must not hardcode a tools allowlist`);
}

const exactCoreSources = [
  "git:github.com/fitchmultz/pi-subagents@3dc8b01c365594b73dbe1db0d041ae20715394b7",
  "git:github.com/fitchmultz/pi-intercom@e604bb84cb41542c1a2f7e7fd0327c66084617dc",
  "git:github.com/DietrichGebert/ponytail@16f29800fd2681bdf24f3eb4ccffe38be3baec6b",
  "git:github.com/fitchmultz/pi-ask-question@06fe72b3326cc178c821754a524021a4da83162d",
  "npm:@ff-labs/pi-fff@0.10.0",
  "npm:pi-agent-browser-native@0.2.68",
  "npm:pi-mcp-adapter@2.11.0",
  "npm:pi-codex-goal@0.1.37",
  "npm:@fitchmultz/pi-stash@0.1.24",
  "npm:pi-verbosity-control@0.3.0",
  "npm:pi-tool-duration@0.1.4",
  "npm:pi-edit-session-in-place@0.1.26",
  "npm:pi-copy-message@1.0.11",
];
same(manifest.runtime, { pi: "0.80.10", node: ">=24" }, "Runtime contract changed");
same(manifest.requiredModels, [
  "openai-codex/gpt-5.6-sol",
  "openai-codex/gpt-5.6-terra",
  "anthropic/claude-fable-5",
  "anthropic/claude-opus-4-8",
], "Required exact models changed");
same(manifest.corePackages.map(({ source }) => source), exactCoreSources, "Core package pins changed");
same(manifest.optionalPackages, [{ id: "cursor", source: "npm:pi-cursor-sdk@0.1.59" }], "Optional Cursor pin changed");
same(manifest.kit, { repository: "https://github.com/fitchmultz/pi-fitch-kit" }, "Kit metadata must not contain a self-referential install pin");
const browser = manifest.corePackages.find(({ id }) => id === "agent-browser");
same(browser?.externalPrerequisite, {
  package: "agent-browser",
  version: "0.32.0",
  installCommand: "npm install --global agent-browser@0.32.0",
  runtimeDownloadCommand: "agent-browser install",
}, "Agent Browser prerequisite changed");
same(manifest.kitResources.extensions.map((path) => `./${path}`), packageJson.pi.extensions, "Manifest/package extension resources diverged");
assert(manifest.kitResources.agentSyncScript === "scripts/sync-agents.mjs", "Manifest agent sync script diverged");
assert(`./${manifest.kitResources.prompt}` === packageJson.pi.prompts[0], "Manifest/package prompt resource diverged");
assert(manifest.kitResources.agentProfiles === agentNames.length, "Manifest profile count diverged");

const setupPrompt = read("prompts/fitch-setup.md");
includesAll(setupPrompt, [
  "setup-manifest.json",
  "Complete core",
  "component selection",
  "pi install <exact source> --no-approve",
  "pi list --no-approve",
  "PI_OFFLINE=1 pi --list-models --no-approve",
  "Ask before any online refresh",
  "Never read or copy `auth.json`",
  "raw sessions",
  "service payloads/responses",
  "stop",
  "do not substitute a similarly named model",
  "catalog evidence, not authentication proof",
  "Never resolve or print credentials",
  "Preview and apply",
  "preserve non-symlinks and every existing symlink",
  "Ask for explicit approval immediately before running either action",
  "`/reload`",
  "mode is `verify`",
  "make no changes, installs, downloads, logins, or repairs",
  "Do not make service writes",
  "not a custom wizard",
], "Setup prompt");
const agreement = read("templates/working-agreement.md");
for (const marker of [
  "<!-- fitch-pi-kit:baseline:start -->",
  "<!-- fitch-pi-kit:baseline:end -->",
  "<!-- fitch-pi-kit:workos:start -->",
  "<!-- fitch-pi-kit:workos:end -->",
]) {
  assert(agreement.split(marker).length === 2, `Working agreement marker must occur once: ${marker}`);
}
includesAll(agreement, ["Never replace unrelated content", "stop and ask", "external writes", "Use Linear", "reviewer-gpt"], "Working agreement");
const readme = read("README.md");
const setupGuide = read("docs/pi-setup.md");
const releasePlaceholder = "__PUBLIC_COMMIT_REQUIRED_BEFORE_RELEASE__";
const kitSource = "git:github.com/fitchmultz/pi-fitch-kit";
const bootstrapRef = (text, label) => {
  assert(text.split(kitSource).length === 2, `${label} must reference the kit Git source exactly once`);
  const escapedKitSource = kitSource.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = text.match(new RegExp("`pi install " + escapedKitSource + "@([^`\\s]+) --no-approve`"));
  assert(match, `${label} must contain exactly one complete backticked kit install command`);
  const ref = match[1];
  assert(ref === releasePlaceholder || /^[0-9a-f]{40}$/.test(ref), `${label} bootstrap pin is neither the release placeholder nor a full commit`);
  return ref;
};
const releaseHashFixture = "a".repeat(40);
const validBootstrapFixture = "`pi install " + kitSource + "@" + releaseHashFixture + " --no-approve`";
assert(bootstrapRef(validBootstrapFixture, "Valid bootstrap fixture") === releaseHashFixture, "Valid bootstrap fixture failed");
for (const invalid of [
  "`pi install " + kitSource + "@main --no-approve`",
  "`pi install " + kitSource + "@" + releaseHashFixture + " --no-approve && echo unsafe`",
  `${validBootstrapFixture}\n${validBootstrapFixture}`,
]) {
  let rejected = false;
  try { bootstrapRef(invalid, "Invalid bootstrap fixture"); } catch { rejected = true; }
  assert(rejected, `Unsafe bootstrap fixture passed validation: ${invalid}`);
}
const readmeRef = bootstrapRef(readme, "README");
const guideRef = bootstrapRef(setupGuide, "Setup guide");
assert(readmeRef === guideRef, "Bootstrap examples pin different package commits");
if (readmeRef !== releasePlaceholder) {
  assert(!readme.includes(releasePlaceholder) && !setupGuide.includes(releasePlaceholder), "Released docs retain the pre-release placeholder");
}
includesAll(readme, ["private: true", "/fitch-setup", "not loaded by default", "--no-approve"], "README");
includesAll(read("CHANGELOG.md"), ["0.1.0 - Unreleased", "/fitch-setup", "eleven agent profiles"], "CHANGELOG");
includesAll(read("AGENTS.md"), ["public-core source", "exactly 11", "private: true", "CONFIG_DIR_NAME", "setup-time and add-only"], "AGENTS.md");
includesAll(setupGuide, ["/fitch-setup", "--no-approve"], "Setup guide");

for (const file of ["index.ts", "eval.ts", "decimal.ts", "check.ts"]) {
  assert(existsSync(join(root, "extensions/calculator", file)), `Missing calculator file ${file}`);
}

const agentDir = mkdtempSync(join(tmpdir(), "pi-fitch-kit-agent-"));
const nestedCwd = mkdtempSync(join(tmpdir(), "pi-fitch-kit-nested-"));
process.env.PI_CODING_AGENT_DIR = agentDir;
try {
  const expectedSourceDir = join(root, "agents");
  const targetDir = join(agentDir, "agents");
  mkdirSync(targetDir, { recursive: true });
  const conflictPath = join(targetDir, "worker.md");
  writeFileSync(conflictPath, "local override\n", "utf8");
  const foreignSource = join(agentDir, "foreign-scout.md");
  writeFileSync(foreignSource, "foreign scout\n", "utf8");
  const foreignPath = join(targetDir, "scout.md");
  symlinkSync(foreignSource, foreignPath);
  const brokenForeignSource = join(agentDir, "missing-reviewer.md");
  const brokenForeignPath = join(targetDir, "reviewer.md");
  symlinkSync(brokenForeignSource, brokenForeignPath);
  const stalePath = join(targetDir, "obsolete.md");
  const staleSource = join(expectedSourceDir, "obsolete.md");
  symlinkSync(staleSource, stalePath);

  const { syncAgents } = await import(pathToFileURL(join(root, "scripts/sync-agents.mjs")));
  const sync = syncAgents(agentDir);
  const createdNames = agentNames.filter((name) => !["worker.md", "scout.md", "reviewer.md"].includes(name));
  same(sync.created.sort(), createdNames.map((name) => join(targetDir, name)).sort(), "Sync created-path report is wrong");
  same(sync.unchanged, [], "First sync unexpectedly reported unchanged paths");
  same(readdirSync(targetDir).sort(), [...agentNames, "obsolete.md"].sort(), "Sync changed an existing target");
  for (const name of agentNames.filter((name) => !["worker.md", "scout.md", "reviewer.md"].includes(name))) {
    const target = join(targetDir, name);
    assert(lstatSync(target).isSymbolicLink(), `${name} is not a symlink`);
    assert(resolve(dirname(target), readlinkSync(target)) === join(expectedSourceDir, name), `${name} points outside this package's agents directory`);
  }
  same(sync.skipped.map(({ path, reason }) => [path, reason]).sort(), [
    [brokenForeignPath, "foreign-symlink"],
    [foreignPath, "foreign-symlink"],
    [conflictPath, "non-symlink"],
  ].sort(), "Sync did not report every conflict");
  assert(!lstatSync(conflictPath).isSymbolicLink() && readFileSync(conflictPath, "utf8") === "local override\n", "Sync overwrote a non-symlink conflict");
  assert(resolve(dirname(foreignPath), readlinkSync(foreignPath)) === foreignSource, "Sync overwrote a foreign symlink");
  assert(resolve(dirname(brokenForeignPath), readlinkSync(brokenForeignPath)) === brokenForeignSource, "Sync overwrote a broken foreign symlink");
  assert(resolve(dirname(stalePath), readlinkSync(stalePath)) === staleSource, "Sync removed an existing stale symlink");

  const manual = await run("bash", [join(root, "scripts/sync-agents.sh")], { ...process.env, PI_CODING_AGENT_DIR: agentDir });
  const manualReport = JSON.parse(manual.stdout);
  same(manualReport.created, [], "Idempotent shell sync reported created paths");
  same(manualReport.unchanged.sort(), createdNames.map((name) => join(targetDir, name)).sort(), "Idempotent shell sync unchanged-path report is wrong");
  same(manualReport.skipped.map(({ path, reason }) => [path, reason]).sort(), sync.skipped.map(({ path, reason }) => [path, reason]).sort(), "Idempotent shell sync conflict report changed");
  const rerun = syncAgents(agentDir);
  same(rerun.created, [], "Idempotent direct sync reported created paths");
  same(rerun.unchanged.sort(), manualReport.unchanged.sort(), "Idempotent direct sync unchanged-path report changed");
  assert(!lstatSync(conflictPath).isSymbolicLink() && readFileSync(conflictPath, "utf8") === "local override\n", "Shell wrapper overwrote a non-symlink conflict");
  assert(resolve(dirname(foreignPath), readlinkSync(foreignPath)) === foreignSource, "Shell wrapper overwrote a foreign symlink");
  assert(resolve(dirname(brokenForeignPath), readlinkSync(brokenForeignPath)) === brokenForeignSource, "Shell wrapper overwrote a broken foreign symlink");
  assert(resolve(dirname(stalePath), readlinkSync(stalePath)) === staleSource, "Shell wrapper removed an existing stale symlink");

  const { CONFIG_DIR_NAME, hasTrustRequiringProjectResources } = await import("@earendil-works/pi-coding-agent");
  const nestedFile = join(nestedCwd, CONFIG_DIR_NAME, "agent", "AGENTS.md");
  let nestedHandler;
  const nestedExtension = await import(pathToFileURL(join(root, "extensions/nested-agents.ts")));
  nestedExtension.default({ on(event, handler) { if (event === "before_agent_start") nestedHandler = handler; } });
  assert(typeof nestedHandler === "function", "nested-agents did not register before_agent_start");
  const event = (contextFiles = []) => ({
    systemPrompt: "base",
    systemPromptOptions: { cwd: nestedCwd, contextFiles },
  });
  const ctx = (trusted) => ({ isProjectTrusted: () => trusted, cwd: nestedCwd });
  assert(await nestedHandler(event(), ctx(false)) === undefined, "Nested instructions loaded for an untrusted project");
  assert(await nestedHandler(event(), ctx(true)) === undefined, "Missing nested instructions were not ENOENT-safe");
  mkdirSync(dirname(nestedFile), { recursive: true });
  writeFileSync(nestedFile, "alpha\n", "utf8");
  assert(!hasTrustRequiringProjectResources(nestedCwd), "Nested instructions unexpectedly trigger Pi project trust");
  assert(await nestedHandler(event(), ctx(true)) === undefined, "Nested instructions loaded without a native Pi trust-gated resource");
  writeFileSync(join(nestedCwd, CONFIG_DIR_NAME, "settings.json"), "{}\n", "utf8");
  assert(hasTrustRequiringProjectResources(nestedCwd), "Fixture did not trigger Pi project trust");
  assert(await nestedHandler(event(), ctx(false)) === undefined, "Nested instructions loaded after project trust was declined");
  assert((await nestedHandler(event(), ctx(true)))?.systemPrompt === "base\n\nalpha\n", "Trusted nested instructions were not appended exactly once");
  assert(await nestedHandler(event([{ path: nestedFile }]), ctx(true)) === undefined, "Already loaded nested instructions were duplicated");
  writeFileSync(nestedFile, " \n", "utf8");
  assert(await nestedHandler(event(), ctx(true)) === undefined, "Empty nested instructions changed the prompt");
  writeFileSync(nestedFile, "beta\n", "utf8");
  const live = await nestedHandler(event(), ctx(true));
  assert(live?.systemPrompt === "base\n\nbeta\n", "Nested instruction edits were not read live per turn");
} finally {
  rmSync(agentDir, { recursive: true, force: true });
  rmSync(nestedCwd, { recursive: true, force: true });
}

const raceAgentDir = mkdtempSync(join(tmpdir(), "pi-fitch-kit-race-"));
try {
  const raceTargetDir = join(raceAgentDir, "agents");
  const env = { ...process.env, PI_CODING_AGENT_DIR: raceAgentDir };
  const raceRuns = await Promise.all([
    ...Array.from({ length: 4 }, () => run(process.execPath, [join(root, "scripts/sync-agents.mjs")], env)),
    ...Array.from({ length: 4 }, () => run("bash", [join(root, "scripts/sync-agents.sh")], env)),
  ]);
  const raceReports = raceRuns.map(({ stdout }) => JSON.parse(stdout));
  same(raceReports.flatMap(({ created }) => created).sort(), agentNames.map((name) => join(raceTargetDir, name)).sort(), "Concurrent sync created-path reports are wrong");
  for (const report of raceReports) {
    assert(report.skipped.length === 0, `Concurrent sync reported conflicts: ${JSON.stringify(report.skipped)}`);
    assert(report.created.length + report.unchanged.length === agentNames.length, "Concurrent sync omitted a profile from its report");
  }
  same(readdirSync(raceTargetDir).sort(), agentNames, "Concurrent sync target names differ from source profiles");
  for (const name of agentNames) {
    const target = join(raceTargetDir, name);
    assert(lstatSync(target).isSymbolicLink(), `Concurrent sync left ${name} as a non-symlink`);
    assert(resolve(dirname(target), readlinkSync(target)) === join(root, "agents", name), `Concurrent sync mislinked ${name}`);
  }
} finally {
  rmSync(raceAgentDir, { recursive: true, force: true });
}

console.log(JSON.stringify({
  ok: true,
  piResources: { extensions: packageJson.pi.extensions.length, prompts: packageJson.pi.prompts.length },
  agents: agentNames.length,
  corePins: exactCoreSources.length,
  optionalPins: manifest.optionalPackages.length,
  agentLinking: ["setup-time", "add-only", "created-vs-unchanged", "conflicts-reported", "concurrent-safe"],
  nestedInstructions: ["native-trust-resource-required", "trusted-only", "deduplicated", "empty-safe", "enoent-safe", "live-edit"],
  calculator: "source-and-pins-validated",
}, null, 2));
