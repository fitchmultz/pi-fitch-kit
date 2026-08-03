#!/usr/bin/env node
import { execFileSync, execSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync, existsSync, readFileSync } from "node:fs";
import { arch, platform } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const manifest = JSON.parse(readFileSync(join(root, "setup-manifest.json"), "utf8"));
const prerequisite = manifest.corePackages.find(({ id }) => id === "agent-browser")?.externalPrerequisite;
if (!prerequisite) throw new Error("Agent Browser prerequisite is missing from setup-manifest.json");

const requiredPlatforms = [
	"darwin-arm64",
	"darwin-x64",
	"linux-arm64",
	"linux-x64",
	"linux-musl-arm64",
	"linux-musl-x64",
	"win32-x64",
];
for (const key of requiredPlatforms) {
	const asset = prerequisite.nativeAssets[key];
	if (!asset || !asset.name || !/^[0-9a-f]{64}$/.test(asset.sha256)) {
		throw new Error(`Invalid native asset pin for ${key}`);
	}
}

if (process.argv.includes("--check")) {
	console.log(JSON.stringify({ ok: true, version: prerequisite.version, assets: requiredPlatforms.length }));
	process.exit(0);
}

function isMusl() {
	if (platform() !== "linux") return false;
	try {
		return execSync("ldd --version 2>&1 || true", { encoding: "utf8" }).toLowerCase().includes("musl");
	} catch {
		return existsSync("/lib/ld-musl-x86_64.so.1") || existsSync("/lib/ld-musl-aarch64.so.1");
	}
}

const os = platform() === "linux" && isMusl() ? "linux-musl" : platform();
const key = `${os}-${arch()}`;
const asset = prerequisite.nativeAssets[key];
if (!asset) throw new Error(`Unsupported Agent Browser platform: ${key}`);

const npmRoot = execFileSync("npm", ["root", "--global"], { encoding: "utf8" }).trim();
const packageRoot = join(npmRoot, prerequisite.package);
const packageJsonPath = join(packageRoot, "package.json");
if (!existsSync(packageJsonPath)) {
	throw new Error(`Install ${prerequisite.package}@${prerequisite.version} with --ignore-scripts before verification`);
}
const installed = JSON.parse(readFileSync(packageJsonPath, "utf8"));
if (installed.version !== prerequisite.version) {
	throw new Error(`Expected ${prerequisite.package}@${prerequisite.version}, found ${installed.version}`);
}

const binary = join(packageRoot, "bin", asset.name);
if (!existsSync(binary)) {
	throw new Error(`Pinned npm package is missing its native binary: ${binary}`);
}
const actual = createHash("sha256").update(readFileSync(binary)).digest("hex");
if (actual !== asset.sha256) {
	throw new Error(`Agent Browser digest mismatch for ${asset.name}: expected ${asset.sha256}, got ${actual}`);
}
if (platform() !== "win32") chmodSync(binary, 0o755);
console.log(JSON.stringify({ ok: true, asset: asset.name, sha256: actual, source: "npm-tarball" }));
