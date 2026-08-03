---
description: Install or verify the pinned Fitch Pi workflow safely
argument-hint: "[verify]"
---

Run the Fitch Pi setup in `${1:-setup}` mode. This is a main-session-led setup procedure, not a custom wizard. Use structured questions when available, otherwise ask concise plain-text questions.

## Authority

1. Locate this prompt's installed `@fitch/pi-kit` package root from Pi's package/resource information. Read `<package-root>/setup-manifest.json` as the single source of truth. Also read the installed Pi documentation for packages, prompts, extensions, settings, security, and models before changing anything.
2. Use only sources and versions in the manifest. Run each user-scoped package install as `pi install <exact source> --no-approve` so project-local configuration cannot affect installation. Never convert a commit to a branch or tag, drop an npm version, vendor another package, or silently substitute a model or component.
3. Never read or copy authentication files, credential stores, browser profiles, raw sessions, private endpoints, generated service payloads, or service data. Provider and service authentication belongs to the user through documented login flows.
4. Do not make service writes, commits, pushes, merges, deployments, production changes, account changes, or security or privacy changes.

## Inspect

Inspect only non-secret state needed for the plan: `node --version`, `pi --version`, `pi list --no-approve`, `PI_OFFLINE=1 pi --list-models --no-approve`, package metadata and docs, path existence and type, and structural JSON keys. Ask before any online refresh. Do not print whole user configuration files. If JSON is malformed, managed markers conflict, or an intended path is an unrelated non-symlink, stop and ask rather than replacing it.

Require the manifest's Node and Pi versions and every route in `requiredModels`. The `optionalModels` routes need the user's own API authentication; their absence removes fallbacks and must be reported, not repaired silently. Treat model listing as catalog evidence, not authentication proof. Ask the user to complete documented provider login flows. Use a documented non-secret auth-status surface when available; otherwise ask before the smallest no-session live probe. Never resolve or print credentials. If any required model is unavailable, report the exact missing list and stop rather than substituting a similar model.

## Choose

Unless mode is `verify`, ask the user to choose:

1. Complete core, meaning every `corePackages` entry plus the kit's bundled extensions, prompts, agent profiles, and package-backed skills; or a component selection from the manifest.
2. Which `optionalIntegrations`, if any, they want to configure through the MCP adapter. Authentication is manual and per-user; do not test it by reading service payloads.
3. Whether to adopt the baseline working-agreement block, the optional process block, both, or neither, from `<package-root>/templates/working-agreement.md`.
4. Project-trust posture. Show `defaultProjectTrust` and the subagent `projectTrust.childRuns` options (`approve`, `inherit`, `no-approve`) with their tradeoffs. Untrusted repositories should use `no-approve`. Do not silently copy another person's trust settings.
5. Whether to copy the safe behavioral settings from `<package-root>/examples/settings.json`. Treat each key as optional. In particular, explain that `images.autoResize: false` preserves source image detail globally while the bundled Anthropic image guard still resizes images for that provider's inline limits.

## Preview and apply

Before any write or install, show one complete preview containing:

- every selected exact package source and `pi install <source> --no-approve` command;
- every filesystem path that may change and whether it will be created, merged, symlinked, or left alone;
- the exact model mapping from all 14 files in `<package-root>/agents/`;
- the selected working-agreement and settings keys;
- package-backed skills that will load and any name collision with an existing user skill;
- the Agent Browser prerequisite sequence from the manifest, if selected: install the exact npm package, then optionally download its browser runtime;
- which changes require `/reload` or a fresh session.

Ask for confirmation of that preview. The confirmed selection is consent for only those exact install commands and file changes. Do not add repeated per-package prompts.

Preserve unrelated configuration. Use Pi package commands instead of replacing `settings.json`; merge selected JSON keys narrowly. Merge a selected working-agreement block into `~/.pi/agent/AGENTS.md` by its complete managed markers while retaining unrelated text. Never add an unselected block. Stop on malformed JSON, partial, duplicate, or nested managed markers, or semantic conflicts.

Installing the kit is already consent for its bundled resources. Its two prompts load with the package. `sync-agents` links all 14 profiles under `~/.pi/agent/agents/` on session start, while preserving regular files and foreign symlinks. `anthropic-image-guard` applies only to Anthropic requests and matters primarily when global image auto-resizing is disabled. After `/reload`, verify the expected resources and report any skipped profile path for user decision.

Installing `pi-agent-skills` loads the active public skill set from that package. Preserve other user skill roots and filters. If a skill name collides, show both sources and ask which one should remain active rather than deleting either copy.

Agent Browser has one prerequisite outside Pi package installation. Run the manifest's exact global npm command for the wrapper's tested 0.33.0 baseline. Its optional browser runtime download remains a separate command. Preview both steps and ask before the sequence. Declining leaves Agent Browser as a manual step and does not block unrelated components.

For integrations, install only the MCP adapter from the manifest and follow its current docs. Preview the exact config path and shape, then stop for user authentication or organization-specific values. Do not infer endpoints, inspect credentials, invoke service reads as a smoke, or make service writes.

After resource or configuration changes, tell the user to run `/reload` or start a fresh session before in-session verification.

## Verify mode and smokes

If mode is `verify`, make no changes, installs, downloads, logins, or repairs. Ask whether to verify complete core or selected components, then report drift against the manifest, including package versions, agent symlinks, loaded extensions, prompts, skills, model availability, and the Agent Browser CLI version.

In either mode, verification is read-only after any required reload. Use only harmless documented smokes: version and resource-list checks, local repository search, read-only subagent and intercom checks, a todo-list read, a non-authenticated browser page only if its runtime was approved, deterministic calculator input, and tool or schema discovery for integrations. Confirm `apply_edits` is active and the built-in `edit` and `write` tools are hidden. If a capability has no harmless smoke, report it as manual verification instead of inventing one.

Finish with selected components, exact installed sources, changed and skipped paths, model results, smoke results, `/reload` status, and remaining manual authentication or setup. Do not claim success for a skipped or unverified capability.
