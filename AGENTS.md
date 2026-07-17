# AGENTS.md

## Project shape

This repository is the public-core source for `@fitch/pi-kit`.

Canonical sources:

- `setup-manifest.json` for supported Pi/Node versions, exact models, pinned core packages, optional Cursor, and Agent Browser's external prerequisite.
- `package.json#pi` for the only resources Pi loads: trusted nested instructions, calculator, and `/fitch-setup`.
- `scripts/sync-agents.mjs` for add-only, setup-time profile linking.
- `agents/*.md` for exactly 11 reusable user-level subagent profiles and their model/thinking/context policy.
- `templates/working-agreement.md` for independently selectable baseline and WorkOS managed blocks.
- `prompts/fitch-setup.md` for the main-session-led setup procedure.

Keep `README.md` aligned with setup, resources, profiles, release status, and security boundaries. Old workflow prompts stay tracked under their existing subdirectories but are not default package resources.

## Commands

- Install dependencies: `npm install`
- Validate repository: `npm run check`
- Isolated resource smoke: `npm run smoke:package`
- Dry-run package: `npm pack --dry-run --json >/tmp/pi-fitch-kit-pack.json`
- Add missing agent links: `node scripts/sync-agents.mjs`
- Install a reviewed checkout: `pi install /absolute/path/to/pi-fitch-kit`
- Reload runtime changes: `/reload` or a fresh Pi session

Use npm with Node `>=24`. TypeScript must check against exact dev dependency `@earendil-works/pi-coding-agent@0.80.9`.

## Editing rules

- Do not edit synced files under `~/.pi/agent/agents/`; edit `agents/*.md` here.
- Keep exactly 11 profiles and preserve the Sol-backed `scout` mapping. Do not duplicate agent overrides in settings.
- Keep runtime Pi imports as wildcard optional peers. Runtime third-party libraries belong in `dependencies`.
- Do not vendor external Pi packages, add a bootstrap runtime command, or build a setup wizard. Use the manifest, pasteable bootstrap prompt, and `/fitch-setup`.
- Keep package installs immutable. Do not replace exact versions/commits with ranges, tags, or branches.
- Keep `private: true`. Bootstrap examples retain the public Git commit placeholder until an authorized release first commits the package, then replaces the placeholder in a docs-only commit with that immutable package commit. Do not put a self-referential install pin in `setup-manifest.json`.
- Nested project instructions must use `CONFIG_DIR_NAME`, require both `hasTrustRequiringProjectResources(cwd)` and `ctx.isProjectTrusted()`, re-read each turn, suppress duplicate context files, ignore empty/missing files, and never create trust-trigger resources.
- Agent sync is setup-time and add-only. It must skip every existing file or foreign symlink, never replace or remove a target, remain safe when processes race to create the same missing link, and report created, unchanged, and skipped paths separately.
- Setup must preview writes, preserve unrelated configuration, block on missing exact models or malformed/conflicting config, and never read credentials/raw sessions/browser profiles/service payloads or make service writes.
- Working-agreement updates must use complete managed markers and never replace unrelated `AGENTS.md` content.

## Validation

Run `npm run check` after changes to package metadata, lockfile, manifest, extensions, scripts, agents, prompts, templates, or docs. Run the configured pack dry-run before completion. Runtime verification must be harmless and must not authenticate, download browser runtimes, or access service payloads without the exact approval required by `/fitch-setup`.
