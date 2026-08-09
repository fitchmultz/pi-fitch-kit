---
description: Install or verify the Fitch Pi workflow safely
argument-hint: "[verify]"
---

Run the Fitch Pi setup in `${1:-setup}` mode. This is a main-session-led setup procedure, not a custom wizard. Use structured questions when available, otherwise ask concise plain-text questions.

## Authority

1. Locate this prompt's installed `@fitch/pi-kit` package root from Pi's package/resource information. Read `<package-root>/setup-manifest.json` as the single source of truth. Also read the installed Pi documentation for packages, prompts, extensions, settings, security, and models before changing anything.
2. Use only the unpinned sources in the manifest. Run each user-scoped package install as `pi install <source> --no-approve` so project-local configuration cannot affect installation. Never append a ref or version, vendor another package, or silently substitute a model or component.
3. Never read or copy authentication files, credential stores, browser profiles, raw sessions, private endpoints, generated service payloads, or service data. Provider and service authentication belongs to the user through documented login flows.
4. Do not make service writes, commits, pushes, merges, deployments, production changes, account changes, or security or privacy changes.

## Inspect

Resolve `<Pi agent dir>` once as `${PI_CODING_AGENT_DIR:-$HOME/.pi/agent}` and use it for every user-scoped path.

Inspect only non-secret state needed for the plan: `node --version`, `pi --version`, `pi list --no-approve`, `PI_OFFLINE=1 pi --list-models --no-approve`, package metadata and docs, path existence and type, and structural JSON keys. Ask before any online refresh. Do not print whole user configuration files. If JSON is malformed, managed markers conflict, or an intended path is an unrelated non-symlink, stop and ask rather than replacing it.

Require the manifest's Node and Pi versions and every route in `requiredModels`. The `optionalModels` routes need the user's own API authentication; their absence removes fallbacks and must be reported, not repaired silently. Treat model listing as catalog evidence, not authentication proof. Ask the user to complete documented provider login flows. Use a documented non-secret auth-status surface when available; otherwise ask before the smallest no-session live probe. Never resolve or print credentials. If any required model is unavailable, report the exact missing list and stop rather than substituting a similar model.

## Choose

Unless mode is `verify`, ask the user to choose:

1. Complete core, meaning every `corePackages` install plus the kit's bundled extensions, prompts, package-backed skills, and the reviewed `piCorePatch` whose manifest field `requiredForCompleteCore` is true. The patch still requires the separate mutation consent below; declining it is valid, but the final report must say Complete core is incomplete rather than silently omitting it. The `pi-subagents` package includes the fourteen specialist profiles and its general-purpose `delegate`. Otherwise choose a component selection from the manifest.
2. Whether to apply `piCorePatch` through the manifest's guarded status/apply scripts. Explain the exact Pi files affected, supported Pi version, stock backup and restore command, that `/reload` is insufficient, and that every running Pi process needs a full process restart. Default to disabled and never treat Complete core as mutation consent.
3. For each `consentBehaviors[].consent.required` behavior, ask whether to **enable, disable, or keep** the current state. For bundled `codex-context`, explain that enabling custom compaction can send messages selected for summarization, prior summaries, split-turn prefixes, and custom instructions to `xai/grok-4.5`, then fall back to `openai-codex/gpt-5.6-luna`, regardless of the active chat provider. Enable writes the manifest's exact `config`; disable writes the exact `disabledConfig` while preserving unrelated keys; keep makes no change. Missing config is already disabled. A rerun answer of “do not enable” is not permission to preserve an existing true value: require the explicit keep-or-disable choice.
4. Which `optionalIntegrations`, if any, they want to configure through the MCP adapter. Authentication is manual and per-user; do not test it by reading service payloads.
5. Whether to adopt the baseline working-agreement block, the optional process block, both, or neither, from `<package-root>/templates/working-agreement.md`.
6. Project-trust posture. Show `defaultProjectTrust` and the subagent `projectTrust.childRuns` options (`approve`, `inherit`, `no-approve`) with their tradeoffs. Untrusted repositories should use `no-approve`. Do not silently copy another person's trust settings.
7. Whether to copy the safe behavioral settings from `<package-root>/examples/settings.json`. Treat each key as optional. In particular, explain that `images.autoResize: false` preserves source image detail globally while the bundled Anthropic image guard still resizes images for that provider's inline limits.

## Preview and apply

Before any write or install, show one complete preview containing:

- every selected package source and `pi install <source> --no-approve` command;
- every filtered, pinned, or duplicate kit package entry to remove before reinstalling the one unfiltered, unpinned `kit.installSource` entry, grouped under exactly one removal command per scope and package identity;
- the `piCorePatch` status command and, only when separately selected, its guarded apply command, affected Pi root, backup path, restore command, and full process restart;
- every filesystem path that may change and whether it will be created, merged, symlinked, or left alone;
- the model mapping from the fourteen specialist profiles in the installed `pi-subagents/agents/` directory;
- the selected working-agreement and settings keys;
- package-backed skills that will load and any name collision with an existing user skill;
- every selected consent-gated data route, its exact destinations, and the exact config path and keys that enable it;
- the Agent Browser prerequisite sequence from the manifest, if selected: install the exact npm package, then optionally download its browser runtime;
- which changes require `/reload` or a fresh session.

Ask for confirmation of that preview. The confirmed selection is consent for only those exact install commands, file changes, and separately selected data routes. Do not treat Complete core as consent for a `consentBehaviors[].consent.required` behavior, and do not add repeated prompts for ordinary packages.

Preserve unrelated configuration. Use Pi package commands instead of replacing `settings.json`; merge selected JSON keys narrowly. Before package installation, structurally inspect the user-scoped `packages` entries and `pi list` results for the manifest's `kit.packageName`. A Complete-core or kit upgrade must normalize it to exactly one unfiltered, unpinned `kit.installSource`: group filtered, pinned, non-canonical, and duplicate kit entries by scope and resolved package identity, then run exactly one removal command per scope and package identity because Pi removes all entries for that identity in one call. Do not issue one command per duplicate source. Confirm the grouped entries are gone before installing the canonical source, and stop if any remain. Never remove a project-local entry without separately previewing its `--local` scope, and never remove an unrelated package merely because its path is nearby. Merge a selected working-agreement block into `<Pi agent dir>/AGENTS.md` by its complete managed markers while retaining unrelated text. Never add an unselected block. Stop on malformed JSON, partial, duplicate, or nested managed markers, or semantic conflicts.

Installing the kit is already consent for its bundled resources. Its two prompts, `anthropic-image-guard`, `clean-footer`, `codex-context`, and `session-name` load with the package; alternate-model compaction remains off without the separate consent above. Installing the `pi-subagents` package supplies the fourteen specialist defaults, `delegate`, and Intercom; do not create user-level profile copies or symlinks, or install standalone `pi-intercom`. If `pi list` shows the archived standalone Intercom package, include `pi remove <exact listed source>` in the preview, adding `--local` only when that listing is project-local. If it shows any user-scoped package identity in `retiredPackageSources`, including a legacy ref or URL form, include `pi remove <exact listed source>` in the preview. Follow either removal with `pi update --extensions` and require restart or reload. The retired core sources were installed user-wide; do not inspect or approve untrusted project configuration to search for unrelated local copies. Removing standalone `pi-codex-context` must not remove its user-global `openai-codex-fast.json` state or `pi-codex-context.json` consent config. Removing standalone `pi-session-name` must not remove Pi session files or their saved names. For upgrades from kit versions that did create profile links, inspect `<Pi agent dir>/agents/` with `lstat`: offer to unlink only a symlink whose recorded target is under `pi-fitch-kit/agents/` and whose basename now exists in the installed `pi-subagents/agents/`. Preview every path and get confirmation; never remove a regular file or a link with different provenance. The image guard applies only to Anthropic requests and matters primarily when global image auto-resizing is disabled. After `/reload`, verify the expected package-owned resources.

Installing `pi-agent-skills` loads the active public skill set from that package. Preserve other user skill roots and filters. If a skill name collides, show both sources and ask which one should remain active rather than deleting either copy.

Agent Browser has one prerequisite outside Pi package installation. Run the manifest's exact global npm command for the wrapper's tested 0.33.0 baseline. Its optional browser runtime download remains a separate command. Preview both steps and ask before the sequence. Declining leaves Agent Browser as a manual step and does not block unrelated components.

For integrations, install only the MCP adapter from the manifest and follow its current docs. Configure only selected `optionalIntegrations`; do not add unrelated presets. Preview the exact config path and shape, then stop for user authentication or organization-specific values. Never persist a mutable npm distribution tag; if a user separately requests a local stdio MCP server, resolve and preview an exact version first. Do not infer endpoints, inspect credentials, invoke service reads as a smoke, or make service writes.

Execute the confirmed plan sequentially and stop immediately on the first failed command. Do not run later installs, config writes, patch mutation, or smokes after a failure. Report commands and writes already completed, the failed step, and every remaining step so rerunning is unambiguous.

After resource or configuration changes, tell the user to run `/reload` or start a fresh session before in-session verification. If `anthropic-image-guard` was disabled or removed, require a full process restart because Pi 0.84.1 `/reload` does not clear its model-runtime provider override. If `piCorePatch` was applied, require a full process restart instead; `/reload` cannot load changed Pi core.

## Verify mode and smokes

If mode is `verify`, make no changes, installs, downloads, logins, or repairs. Ask whether to verify complete core or selected components, then report drift against the manifest, including package versions, normalized kit package identity and filters, loaded subagent defaults, extensions, prompts, skills, model availability, consent-gated config state and destinations, `piCorePatch` guarded status, required restart state, and the Agent Browser CLI version. Treat `recovery-needed` as drift and never run apply or restore from verify mode. Complete core cannot pass while a `requiredForCompleteCore` patch is stock, divergent, recovery-needed, or unverified.

In either mode, verification is read-only after any required reload. Use only harmless documented smokes: version and resource-list checks, local repository search, read-only subagent and intercom checks, a todo-list read, a non-authenticated browser page only if its runtime was approved, deterministic calculator input, and tool or schema discovery for integrations. Confirm `apply_edits` is active and the built-in `edit` and `write` tools are hidden. If a capability has no harmless smoke, report it as manual verification instead of inventing one.

Finish with selected components, installed sources, changed and skipped paths, model results, smoke results, `/reload` or full process restart status, `piCorePatch` status, and remaining manual authentication or setup. Do not claim success for a skipped or unverified capability.
