---
description: Install or verify the pinned Fitch Pi workflow safely
argument-hint: "[verify]"
---

Run the Fitch Pi setup in `${1:-setup}` mode. This is a main-session-led setup procedure, not a custom wizard. Use structured questions when available, otherwise ask concise plain-text questions.

## Authority

1. Locate this prompt's installed `@fitch/pi-kit` package root from Pi's package/resource information. Read `<package-root>/setup-manifest.json` as the single source of truth. Also read the active Pi 0.80.10 package, prompt, extension, settings, security, and model documentation before changing anything.
2. Use only sources and versions in the manifest. Run each user-scoped package install as `pi install <exact source> --no-approve` so project-local configuration cannot affect installation. Never convert a commit to a branch/tag, drop an npm version, vendor another Pi package, or silently substitute a model or component.
3. Never read or copy `auth.json`, credential/key/token stores, browser profiles, raw sessions, generated service payloads/responses, private endpoints, or service data. Provider and service authentication belongs to the user through documented login flows.
4. Do not make service writes, commits, pushes, merges, deployments, production changes, account changes, or security/privacy changes.

## Inspect

Inspect only non-secret state needed for the plan: `node --version`, `pi --version`, `pi list --no-approve`, `PI_OFFLINE=1 pi --list-models --no-approve`, package metadata/docs, path existence/type, and the structural keys of relevant JSON configuration. These forms prevent project-local resources and online catalog refreshes from affecting pre-approval inspection. Ask before any online refresh. Do not print whole user configuration files. If JSON is malformed, managed markers conflict, or an intended path is an unrelated non-symlink, stop and ask rather than replacing it.

Require the manifest's Node and Pi runtime requirements. Require every exact primary and fallback model listed in `requiredModels`; check the offline, no-approve Pi model list and any provider route supplied by a selected package as applicable. Treat model listing as catalog evidence, not authentication proof. Ask the user to complete the documented ChatGPT/Codex and Claude login flows. Use a documented non-secret auth-status surface when available; otherwise ask before the smallest no-session live provider probe. Never resolve or print credentials. Without auth-status or approved live-probe evidence, report authentication as unverified and do not claim setup complete.

A route supplied by a selected but not-yet-installed exact package may be marked pending in the preview, but verify it immediately after that package install and before working-agreement or integration writes. If any exact model is then unavailable, report the precise missing list and stop. Leave already approved package installs reported as partial setup and do not substitute a similarly named model.

## Choose

Unless mode is `verify`, ask the user to choose:

1. Complete core, meaning every `corePackages` entry plus the kit's bundled extensions, prompt, profiles, and selected working-agreement blocks; or component selection from the manifest.
2. Whether to install optional Cursor support.
3. Which, if any, WorkOS integrations (Linear, Slack, Horizon, Notion, Cloudflare) they want to configure. Authentication is manual and per-user; do not test by reading service payloads.
4. Whether to adopt the baseline working-agreement block, the optional WorkOS process block, both, or neither.

## Preview and apply

Before any write or install, show one complete preview containing:

- every selected exact package source and exact `pi install <source> --no-approve` command;
- every filesystem path that may change and whether it will be created, merged, symlinked, or left alone;
- the exact model mapping from all 13 files in `<package-root>/agents/`;
- the selected working-agreement blocks from `<package-root>/templates/working-agreement.md`;
- the subagent trust merge `projectTrust.childRuns: "inherit"` in `~/.pi/agent/extensions/subagent/config.json`;
- that `.pi/agent/AGENTS.md` is ignored unless the project already contains another Pi-recognized trust-gated resource and the project is trusted; do not create a trigger resource without explicit approval;
- any selected integration configuration path and the manual login step;
- the Agent Browser global prerequisite command and runtime-download command, if selected;
- which changes require `/reload` or a fresh session.

Ask for confirmation of that preview. The user's confirmed package selection is consent for those exact `pi install <source> --no-approve` commands. Do not add repeated per-package prompts.

Preserve unrelated configuration. Use Pi's package commands rather than replacing `settings.json`. Merge JSON keys narrowly. Merge a selected working-agreement block into `~/.pi/agent/AGENTS.md` by its complete managed markers, updating that block in place while retaining all unrelated text. Never add an unselected block. Stop on malformed JSON, partial/duplicate/nested managed markers, or semantic conflicts.

After the preview is confirmed, run `<package-root>/scripts/sync-agents.mjs` once to add missing profile symlinks. The script is add-only: it must preserve non-symlinks and every existing symlink, including broken ones, and report each skipped path for user decision rather than replacing or deleting it. Concurrent runs are safe because they only race to create the same missing link.

Agent Browser has two actions outside Pi package installation: the manifest's global npm prerequisite and browser runtime download. Ask for explicit approval immediately before running either action, even when complete core was selected. Declining leaves Agent Browser as a reported manual step and does not block unrelated components.

For integrations, install only the selected adapter package from the manifest. Follow its current docs for configuration, preview the exact config path/shape, and stop for user authentication or missing organization-specific values. Do not infer endpoints, inspect credentials, invoke service reads as a smoke, or make service writes.

After resource/configuration changes, tell the user to run `/reload` or start a fresh session before in-session verification.

## Verify mode and smokes

If mode is `verify`, make no changes, installs, downloads, logins, or repairs. Ask whether to verify complete core or selected components, then inspect and report drift against the manifest.

In either mode, verification is read-only after any required reload. Use only harmless documented smokes: version/list checks, resource discovery, deterministic calculator arithmetic, local repository search, read-only subagent/intercom checks, a non-authenticated browser page only if its runtime was explicitly installed, and tool/schema discovery for integrations. Do not use real service payloads to prove an integration and do not write service data. If a capability has no harmless smoke, report it as a manual verification step instead of inventing one.

Finish with selected components, exact installed sources, changed and skipped paths, exact model results, smoke results, `/reload` status, and remaining manual authentication or setup. Do not claim success for a skipped or unverified capability.
