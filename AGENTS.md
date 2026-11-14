# AGENTS.md

## Project shape

- This repo has two jobs. It ships the session extensions that are coupled to the harness and too small for their own repositories. It also publishes the Pi setup Mitch runs: a manifest of public packages, a settings example, a setup prompt, and a usage guide.
- Canonical sources:
  - `prompts/fitch-setup.md` and `prompts/audit/github-open-issues-prs.md` for the two registered slash commands.
  - `extensions/anthropic-image-guard.ts` for Claude-bound image handling when global auto-resize is off.
  - `extensions/clean-footer.ts` for a compact footer without cumulative token, cache, or cost counters.
  - `extensions/fast-mode.ts` for `/anthropic-fast`, `/codex-fast`, `/xai-fast`, `/google-tier`, and global/session-scoped `/ultrafast` controls.
  - `extensions/session-name.ts` for stable, searchable session naming and protected role identifiers.
  - `extensions/setup-models.ts` for read-only model availability in the running Pi session during setup.
  - `extensions/write-prompt.ts` for `/draft` rewrite, `/ambitious` concise ambition rewrites, `/unreasonable` demanding outcome-driven rewrites, `/side-question` off-transcript answers, accept/copy/tweak/deny, and `write-prompt.json` model override.
  - `examples/settings.json` for the public subset of Mitch's Pi settings.
  - `setup-manifest.json` for unpinned package sources, model routes with their context windows, and kit resources.
  - `templates/working-agreement.md` for the optional managed working-agreement blocks.
  - `package.json#pi` for the resources Pi loads from this package.
- The manifest, settings example, README package table, and `docs/pi-setup.md` describe the setup Mitch runs, not an aspiration. Its source of truth is the private `fitchmultz/dotfiles` repository: `.chezmoitemplates/pi/settings.json` for packages, models, and settings, and `.chezmoitemplates/pi/models.json` for context windows. When that configuration changes, update all four together. List only public packages and public providers.
- `pi-subagents` owns delegation: one agent type, no profiles. It is a core package in the manifest, not a kit dependency. Do not add agent profiles, routing tables, or agent-sync code here.
- Link to the owning repository for another package's tool names, minimum versions, install commands, and skill lists. A copy here goes stale.
- State the fast-mode and Ultrafast contract once, in `docs/reference.md#fast-modes`. Other files link to it.

## Commands

- Install deps: `npm install`
- Validate repo: `npm run check`
- Package load smoke: `npm run smoke`
- Install/update package in Pi from this checkout: `pi install "$PWD"`
- After changing extension code or dependencies, start a fresh Pi process before runtime verification. `/reload` refreshes settings and non-code resources; a new conversation in the old process is insufficient.

## Engineering standard

- Follow `docs/engineering-standard.md` (Strict Oxlint and Oxfmt Engineering Standard, v5.1.2). `npm run check` is the normal acceptance command.
- Relaxing any applicable rule, option, or threshold requires a quality exception recorded in `docs/engineering-records.md` with the evidence the standard's Section 2 requires.

## Editing rules

- Use npm and Node `^24.22.3 || >=26.13.1`; do not introduce another package manager.
- Support the latest stable official Pi and the current maintained Fitch build, not older releases. Pi 1.5.2 is the current technical minimum: the kit is built and qualified against its extension contracts, and its native dialog stack keeps parallel interactive confirmations safe. Qualify the two hosts separately; a matching version number does not identify the fork build. Use public APIs on both hosts; do not add shims for older hosts or restore dropped checkpoint, metadata/revision or usage-source APIs.
- The lockfile must resolve only to `https://registry.npmjs.org/`; rewrite any private mirror host after installing.
- Keep this package an opinionated composition layer. Independent extensions and skill packages must not depend on it.
- Keep only active public resources registered in `package.json#pi` and `setup-manifest.json`.
- Do not add duplicate subagent or skill copies. Point to the public owning package without pinning extension installs to a ref or version.

## Prompt templates

- Prompt filenames are slash-command names. Keep `package.json#pi.prompts` and `setup-manifest.json#kitResources.prompts` limited to prompts that belong in the active public setup.
- Prompt frontmatter should stay native and portable: use fields such as `description:` and `argument-hint:`.
- Do not add `model:`, `thinking:`, or extension-only skill injection to prompt frontmatter.
- Prefer Pi template defaults like `${1:-default}` for optional args; document quoted multi-word args when relevant.

## Extension and package work

- Before changing Pi runtime/package behavior, read the installed Pi docs/types for the touched surface, especially `docs/packages.md`, `docs/prompt-templates.md`, and `docs/extensions.md` under the installed Pi root.
- Keep `extensions/anthropic-image-guard.ts` scoped to Claude models on the `anthropic-messages` wire API (the API alone is shared by non-Claude vendors) and based on Pi's native `resizeImage`; preserve its pre-decode source limits and do not reintroduce global resizing logic.
- Keep `extensions/clean-footer.ts` free of cumulative token, cache, and cost counters; preserve context usage, model details, extension statuses, and wrapping without truncation. Verbosity comes from the controller's native `verbosity` status, never another config reader.
- Keep `extensions/fast-mode.ts` scoped. Preserve blank `/fast`, `/codex-fast on`, and `--fast` priority semantics: OpenAI and xAI priority ride `before_provider_request` for `openai`/`openai-codex`/`chatgpt-rotate`/`xai` plus `cloudflare-ai-gateway` models whose id starts with `gpt-` or is `o3`/`o4-mini` (including their exact `2025-04-16` snapshots) for the OpenAI toggle, or starts with `grok-` for the xAI toggle; other gateway o-series and namespaced Workers AI models stay excluded; Anthropic fast mode owns the `anthropic-messages` override for only the `anthropic` and `cloudflare-ai-gateway` providers, appends the beta at fetch time, and never sends `speed` when the header cannot be attached. Keep the gateway endpoint-placeholder resolution in `fastStream`, the existing state filenames, and the doubled Anthropic fast cost rates.
- Keep `/google-tier` in `extensions/google-tier.ts`: explicit Standard, Flex, or Priority in shared `google-tier.json`, no preference written on install, and native `config.serviceTier` payload injection only for `google` models using `google-generative-ai`. Keep native retries and returned-tier cost accounting in Pi, not a Google provider override.
- OpenAI Ultrafast is opt-in, global by default with optional `--session` metadata override and `reset --session` to inherit. Keep the existing shared state file and legacy priority meaning; global commands never clear local overrides. Preserve same-ID persistence and new-ID isolation. Local off suppresses kit tier injection, not native defaults. Follow [fast-mode reference](docs/reference.md#fast-modes) for the command, status, startup, access, and pricing contracts.
- Gate Ultrafast by exact `gpt-6-astra`, native global/US OpenAI Responses or Codex Responses route, and serialized payload model. Unsupported routes never fall back to priority. Use the stock payload hook without an OpenAI provider override or routing header; native cost accounting/diagnostics remain separate Pi work. Installation never opts in.
- Keep `extensions/session-name.ts` metadata inert and its coordinator/numbered-subagent removal confirmation intact.
- Keep `extensions/write-prompt.ts` off the main transcript: native provider-neutral streaming completion without tools, session provider/model/thinking inheritance with optional `write-prompt.json` overrides, flattened tool history retaining result images, built-in dialogs, and `copyToClipboard` for Copy. Only rewrite-command Accept calls `sendUserMessage`; preserve busy steering and original/draft recovery, with `/draft`, `/ambitious`, and `/unreasonable` saved drafts isolated by entry type. Keep ambitious at 1,800 Unicode characters; unreasonable has no kit-specific cap and raises execution standards without widening scope or authority. Its Tweak retains those rules. `/side-question` never sends.
- Do not reintroduce a kit `/restart`; the fork supplies native restart and official Pi users quit and relaunch.
- Runtime dependencies belong in `dependencies`; Pi core packages stay peer dependencies with `"*"` unless installed Pi docs say otherwise.

## Validation

- Writer native HTTP fixtures own transcript, tool isolation, and asynchronous delivery/recovery; the opt-in live writer harness owns real-output quality checks, not mocked completions. Keep its task-specific constraints and review-only protections; command fixtures retain config denial, cancellation, synchronous failure, and real keyboard menu actions. Extend those keepers instead of copying helper/export inventories; menu navigation expectations must be independent of the production action array.

- `scripts/validate.ts` checks that the manifest, package metadata, lockfile, settings example, and template agree with each other. It does not pin the wording of prompts or docs; do not add assertions that do.
- Run `npm run check` after edits to `package.json`, `setup-manifest.json`, `examples/settings.json`, `templates/`, `extensions/`, `scripts/`, or registered prompts; add `npm run smoke` when package resources changed.
- Run `npm run regression:fast-mode` after changing fast-mode toggles, eligibility, payload or header injection, or state handling.
- Run `node --test scripts/validate-regression.ts` after changing the validator.
- Run `npm run regression:session-name` after changing naming guidance, metadata injection, protected identities, or its migration gate.
- Run `npm run regression:write-prompt` after changing writer commands, config parsing, history, cancellation, or accept/copy/tweak/deny behavior.
- For runtime-facing changes, also verify Pi loads the package through `pi install ...` and a fresh Pi process when practical.
- Keep this file short and project-specific; point to `README.md` or Pi docs instead of copying generic coding rules.

## Dependency maintenance

- Frequently review and proactively update maintained packages and all runtime, development, build, test, and tooling dependencies; routine in-scope updates are authorized. Prioritize the latest stable official Pi release and intended `fitchmultz/pi` revision, qualifying each separately. Review the technical minimum and versioned guidance when updating the official cohort; do not infer the current fork's capabilities from the official version number.
- Review release, changelog, migration, and security notes across the upgrade range and check actual supported contracts. Use the npm/registry/lockfile rules above and compatible dependency cohorts. Adopt beneficial current APIs, conventions, patterns, and functionality instead of extending deprecated or outdated approaches.
- Align callers, setup instructions, documentation, generated resources, and fixtures. Preserve independent package boundaries, explicit review/model requirements, opt-in behavior, and existing user state.
- Carry updates through the applicable checks above, package smokes, exact-host compatibility, review, and CI gates. Record exact target identities, results, skips, and limits; never weaken checkers, safety, or support floors to pass an update.
- Roll out through existing approval, release, and installation gates with a recoverable prior version and rollback plan; honor explicit holds and fresh-process requirements. This authorization does not itself permit publication, active-runtime installation/restarts, private-data disclosure, or global model/auth changes.
