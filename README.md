# pi-fitch-kit

My real Pi harness, packaged as a versioned, inspectable setup.

This repository shows the composition layer I use every day: public extensions, model-routed subagents, reusable skills, authenticated MCP connections, and a small amount of local policy. It is also a working prototype for a model-agnostic organization harness built on top of [Pi](https://github.com/badlogic/pi-mono), without forking Pi core.

Extension installs follow their package's default channel instead of freezing refs or versions. The current kit targets and pins Pi `0.84.2` on Node.js `>=24.0.0`; Agent Browser 0.33.2 sets the Node floor. The kit is patch-free: it modifies no Pi core files. One accepted gap from that stance: stock Pi 0.84.2 does not classify OpenAI's bare transient `Sorry, something went wrong` response as retryable, so those turns fail instead of recovering. No retry-classification setting exists, and the kit declines to carry an extension shim around message handling, so the fix belongs upstream in pi-ai's retry classification.

## Start here

1. [Enabled extensions](#enabled-extensions)
2. [Subagent bench](#subagent-bench)
3. [Active skills](#active-skills)
4. [Connected MCP services](#connected-mcp-services)
5. [How the workflow fits together](#how-the-workflow-fits-together)
6. [Install the kit](#install-the-kit)

Prompts are deliberately secondary. The daily workflow is driven by tools, agents, skills, and connected context.

## Enabled extensions

These are the extensions loaded in my current setup. Every external extension links to its source repository.

### Orchestration and connected work

| Extension | What I use it for |
|---|---|
| [`pi-subagents`](https://github.com/fitchmultz/pi-subagents) | Fresh specialists, parallel work, chains, isolated worktrees, async review, durable artifacts, and coordination between local sessions |
| [`pi-mcp-adapter`](https://github.com/fitchmultz/pi-mcp-adapter) | One searchable gateway over configured MCP servers and their tools |
| [`pi-agent-browser-native`](https://github.com/fitchmultz/pi-agent-browser-native) | Live documentation, browser automation, screenshots, product QA, and authenticated web flows |

### Coding and task control

| Extension | What I use it for |
|---|---|
| [`pi-apply-edits`](https://github.com/fitchmultz/pi-apply-edits) | Atomic exact edits, whole-file rewrites, and plan-first multi-file changes |
| [`pi-fff`](https://github.com/dmtrKovalenko/fff/tree/main/packages/pi-fff) | Fast fuzzy path search and repository-aware content search |
| [`pi-ask-question`](https://github.com/fitchmultz/pi-ask-question) | Structured user decisions when ambiguity changes scope or safety |
| [`pi-todo-list`](https://github.com/fitchmultz/pi-todo-list) | Persistent nested task state that survives long sessions and compaction |
| [`pi-change-working-dir`](https://github.com/fitchmultz/pi-change-working-dir) | Safe mid-session movement into worktrees and monorepo subprojects |
| [`pi-calculator`](https://github.com/fitchmultz/pi-calculator) | Deterministic high-precision arithmetic instead of model estimation |

### Session quality and small friction reducers

| Extension | What I use it for |
|---|---|
| [`pi-verbosity-control`](https://github.com/ferologics/pi-verbosity-control) | Low routine answer verbosity on OpenAI routes |
| [`pi-tool-duration`](https://github.com/fitchmultz/pi-tool-duration) | Model-visible timing on slow tool calls |
| [`pi-edit-session-in-place`](https://github.com/fitchmultz/pi-edit-session-in-place) | Re-edit or remove an earlier user turn in the current branch |
| [`pi-stash`](https://github.com/fitchmultz/pi-stash) | Park and restore a draft message while handling another thought |
| [`pi-copy-message`](https://github.com/fitchmultz/pi-copy-message) | Copy raw session messages without terminal formatting |
| [`ponytail`](https://github.com/DietrichGebert/ponytail) | Persistent pressure toward reuse, deletion, native features, and the smallest root-cause fix |

### Extensions bundled by this kit

[`clean-footer`](extensions/clean-footer.ts) removes cumulative token, cache, cache-hit, and cost counters while retaining the working directory, session name, context usage, model, thinking level, and extension statuses. It uses two lines when everything fits and wraps whole status items onto additional lines instead of truncating them. `/clean-footer` toggles the compact and built-in footers for comparison.

[`session-name`](extensions/session-name.ts) provides the `name_session` tool and inert session-name metadata that keep `/resume` searchable without renaming sessions for every subtask. It preserves coordinator and numbered subagent identities unless the user confirms their removal. During migration, it defers to an already loaded standalone `name_session` tool until `/fitch-setup` removes that package and Pi reloads.

[`fast-mode`](extensions/fast-mode.ts) owns both provider fast toggles in one place. `/anthropic-fast [on|off|toggle|status]` requests Anthropic's research-preview fast mode for Opus 5 and Opus 4.8 at double the token price, with reported cost rates doubled to match; it is verified working on this setup's Claude subscription OAuth route, where identical output ran roughly 2x faster with the toggle on. `/codex-fast [on|off|toggle|status]` requests OpenAI's priority service tier on the `openai` and `openai-codex` providers through Pi's stock `before_provider_request` hook. Anthropic fast mode cannot ride the stock hooks: pi-ai assembles `anthropic-beta` (OAuth identity and feature markers) inside its client after extension header hooks run, and merges header sources last-write-wins, so a hook-written value would drop Pi's own markers. The extension therefore owns the `anthropic-messages` stream callback for exactly the `anthropic` and `cloudflare-ai-gateway` providers and appends the mandatory beta at fetch time, so `speed` and header travel atomically and gateway Opus gets the same toggle as the direct route. Other Opus proxies such as `github-copilot` and `opencode` stay stock, requests carrying a caller-supplied `client` stay on standard speed, and Pi-internal requests such as compaction run fast on an eligible model while the toggle is on. Toggle state lives in the shared per-user `anthropic-fast.json` and `openai-codex-fast.json` files; the footer shows `fast:on` or `fast:off` only while an eligible model is selected and follows changes made in other sessions.

Accepted caveats of owning that callback: do not combine it with another Anthropic or gateway provider override without reviewing both, since Pi merges registrations last-write-wins; start a fresh Pi process after disabling or removing it, because `/reload` does not clear model-runtime provider overrides; and revalidate it when upgrading Pi, since it depends on Pi's provider composition and header-merge behavior.

[`anthropic-image-guard`](extensions/anthropic-image-guard.ts) preserves full-resolution images for other models while resizing only Claude-bound images to Anthropic's inline limits, on every route that speaks `anthropic-messages` (direct, Cloudflare AI Gateway, proxies such as GitHub Copilot). Non-Claude models sharing that wire API keep their source images.

### Selective experimental extension

[`macuse`](https://github.com/fitchmultz/macuse) adds native macOS application inspection and control when a browser DOM or CLI is not enough. I enable it only for tasks that need native app automation. It is intentionally marked experimental because Codex app updates can break the integration surface.

### Why the image guard exists

Pi defaults `images.autoResize` to `true`, which protects provider limits by shrinking every image to at most 2000×2000. I disable it globally so vision-capable agents can inspect the original detail:

```json
{
  "images": {
    "autoResize": false
  }
}
```

That exposed stricter Anthropic image limits. The bundled guard fixes the boundary instead of giving up source quality everywhere: it runs only on Claude models over the `anthropic-messages` API regardless of which provider routes them, reuses Pi's native image resizer, keeps eight recent successful transformations, clears that cache on compaction, and retries later after resize failures. It omits sources above 32 MiB of base64 or contexts above 64 MiB before native decoding. The complete safe settings subset is in [`examples/settings.json`](examples/settings.json).

## Subagent bench

[`pi-subagents`](https://github.com/fitchmultz/pi-subagents) now supplies both the orchestration runtime and the opinionated defaults: fourteen specialist profiles plus its general-purpose `delegate`. This kit uses that package instead of owning duplicate copies.

| Job | Profiles |
|---|---|
| Map and investigate | [`scout`](https://github.com/fitchmultz/pi-subagents/blob/main/agents/scout.md), [`context-builder`](https://github.com/fitchmultz/pi-subagents/blob/main/agents/context-builder.md), [`debugger`](https://github.com/fitchmultz/pi-subagents/blob/main/agents/debugger.md), [`researcher`](https://github.com/fitchmultz/pi-subagents/blob/main/agents/researcher.md) |
| Decide and plan | [`planner`](https://github.com/fitchmultz/pi-subagents/blob/main/agents/planner.md), [`oracle`](https://github.com/fitchmultz/pi-subagents/blob/main/agents/oracle.md) |
| Implement bounded work | [`worker`](https://github.com/fitchmultz/pi-subagents/blob/main/agents/worker.md), [`fixer`](https://github.com/fitchmultz/pi-subagents/blob/main/agents/fixer.md) |
| Challenge the result | [`reviewer`](https://github.com/fitchmultz/pi-subagents/blob/main/agents/reviewer.md), [`reviewer-gpt`](https://github.com/fitchmultz/pi-subagents/blob/main/agents/reviewer-gpt.md), [`reviewer-claude`](https://github.com/fitchmultz/pi-subagents/blob/main/agents/reviewer-claude.md), [`reviewer-security`](https://github.com/fitchmultz/pi-subagents/blob/main/agents/reviewer-security.md), [`ui-designer`](https://github.com/fitchmultz/pi-subagents/blob/main/agents/ui-designer.md) |
| Human-facing output | [`writer`](https://github.com/fitchmultz/pi-subagents/blob/main/agents/writer.md) |

The parent session remains responsible for the task. Specialists return evidence; they do not become an autonomous hierarchy.

The routing is intentional:

- `xai/grok-4.6` handles speed-sensitive scouting, context assembly, bounded implementation, and confirmed fixes.
- `openai-codex/gpt-5.6-sol` handles diagnosis, research, planning, GPT review, security review, and oracle decisions.
- `anthropic/claude-fable-5` supplies an independent model family for writing, UI judgment, and cross-model review, with Opus 5 behind it.
- `oracle` alone uses forked parent context. Every other role starts fresh, and every profile is a leaf agent.

The exact primary, fallback, thinking, context, tool, and output policy lives in [`pi-subagents/agents`](https://github.com/fitchmultz/pi-subagents/tree/main/agents). See [the full setup guide](docs/pi-setup.md#model-routing) for the complete table.

## Active skills

Skills load task-specific operating instructions only when the work matches. [`pi-agent-skills`](https://github.com/fitchmultz/pi-agent-skills) carries the active reusable workflow set:

| Skill | What it adds |
|---|---|
| [`ask-clarifying-questions`](https://github.com/fitchmultz/pi-agent-skills/tree/main/skills/ask-clarifying-questions) | Stop only for ambiguity that materially changes scope, safety, or reversibility |
| [`bro`](https://github.com/fitchmultz/pi-agent-skills/tree/main/skills/bro) | User-invoked plain-language rewrite with no jargon |
| [`deslop`](https://github.com/fitchmultz/pi-agent-skills/tree/main/skills/deslop) | Remove AI-generated diff noise and ceremonial test tables without dropping real boundary coverage |
| [`diagram-creation`](https://github.com/fitchmultz/pi-agent-skills/tree/main/skills/diagram-creation) | Create editable D2 architecture, sequence, data-flow, dependency, lifecycle, and before/after diagrams with rendered SVG/PNG review artifacts |
| [`dogfood`](https://github.com/fitchmultz/pi-agent-skills/tree/main/skills/dogfood) | Exploratory QA through real browser and terminal/TUI flows |
| [`handoff`](https://github.com/fitchmultz/pi-agent-skills/tree/main/skills/handoff) | Produce paste-ready continuation and bounded delegation briefs |
| [`pi-extension-development`](https://github.com/fitchmultz/pi-agent-skills/tree/main/skills/pi-extension-development) | Build, debug, validate, package, and release Pi extensions against current runtime contracts |
| [`propose-then-ship-pi`](https://github.com/fitchmultz/pi-agent-skills/tree/main/skills/propose-then-ship-pi) | Rank one repository improvement, stop for direction, then implement, review, and ship it |
| [`tdd`](https://github.com/fitchmultz/pi-agent-skills/tree/main/skills/tdd) | Red-green-refactor when test-first behavior is explicitly required |
| [`thermo-nuclear-code-quality-review`](https://github.com/fitchmultz/pi-agent-skills/tree/main/skills/thermo-nuclear-code-quality-review) | Strict maintainability review for large or structurally risky diffs |
| [`verification-before-completion`](https://github.com/fitchmultz/pi-agent-skills/tree/main/skills/verification-before-completion) | Require current evidence before completion, commit, PR, or passing-check claims |

Companion skills ship beside their extensions:

| Source | Skills |
|---|---|
| [`pi-subagents`](https://github.com/fitchmultz/pi-subagents/tree/main/skills) | `pi-subagents` orchestration and `pi-intercom` coordination guidance |
| [`pi-mcp-adapter`](https://github.com/fitchmultz/pi-mcp-adapter/tree/main/skills/mcp-scripting) | `mcp-scripting` for discovering and composing MCP calls |
| [`ponytail`](https://github.com/DietrichGebert/ponytail/tree/main/skills) | `ponytail`, `ponytail-audit`, `ponytail-debt`, `ponytail-gain`, `ponytail-help`, `ponytail-review` |

`bro` is intentionally user-invoked only. The rest are selected by task fit rather than loaded into every prompt.

## Connected MCP services

MCP is the context and action bus around the coding loop. Authentication is per-user and is never stored in this repository.

The current setup has authenticated, read-only-discovery-verified connections for:

| Connection | Capability |
|---|---|
| `horizon` | Internal integration gateway, authenticated identity, integration API calls, and nested tool catalogs |
| GitHub | Repositories, issues, pull requests, checks, reviews, releases, and code search |
| Linear | Issues, projects, teams, and planning context |
| Slack, primary and development workspaces | Public and approved private conversation context, threads, users, and canvases |
| Cloudflare | Documentation plus typed account API access |
| Sentry | Issues, events, traces, releases, and project context |
| Datadog | Dashboards, monitors, metrics, logs, traces, and operational context |
| Plain | Support threads, customers, workspace data, and Sidekick sessions |
| Notion | Workspace search, pages, databases, comments, and meeting notes |
| Granola | Meeting notes, summaries, folders, and transcripts |

The organization-specific endpoint and authentication configuration stay private. [`setup-manifest.json`](setup-manifest.json) records only the service choices; `/fitch-setup` stops for each user's own login and never probes by reading service data. My personal runtime is fully approved: MCP is a tool transport, not an authorization layer, so operating boundaries come from the working agreement and the human directing the session. The optional `mcp_script` mode is trusted local code execution when enabled, not a sandbox or an authorization boundary. The setup configures only integrations listed in the manifest and never persists mutable npm specs such as `@latest`.

## How the workflow fits together

A typical substantial change looks like this:

1. The main session reads repository instructions and pulls the relevant issue or service context through MCP.
2. FFF and, when useful, a fresh `scout` map the real code path before editing.
3. The main session makes the design decision and usually implements it with `apply_edits`; independent `worker` tasks are the exception, not the default.
4. Agent Browser verifies browser-visible behavior when tests cannot prove the user experience.
5. Repository checks and deterministic tools establish current evidence.
6. A fresh reviewer reconstructs the claim from the diff and evidence. Any changed diff gets a new reviewer pass; old reviewer judgment is never cached as sign-off.
7. The main session closes the loop, records remaining risk, and performs only the external actions the user authorized.

The architecture stays modular:

```text
Pi core
  ├─ public extensions and tools
  ├─ bounded, model-routed subagents
  ├─ task-selected skills and policy
  └─ user-authenticated MCP services
```

This is already the working composition layer for a broader organization harness. Productizing it would add centralized provisioning, policy distribution, scoped credential brokerage, audit and cost visibility, managed local/cloud execution, and multi-user controls. It would not require turning the extensions into a monolith or locking the harness to one model provider.

## Install the kit

```bash
npm install -g --ignore-scripts @earendil-works/pi-coding-agent@0.84.2
pi
# Complete provider login in Pi, then:
pi install git:github.com/fitchmultz/pi-fitch-kit
# /reload, then:
/fitch-setup
```

`/fitch-setup` reads [`setup-manifest.json`](setup-manifest.json), previews every package install and file change, and asks which parts to apply. It never reads or copies credentials. Reruns normalize filtered, pinned, or duplicate kit entries to one canonical source. A separate consent step merges the manifest's flat context-window overrides into `models.json` per route, keeping existing values unless explicitly overwritten. They also preview removal of retired standalone packages, the archived Intercom package, and legacy kit-owned profile symlinks; symlink cleanup never removes regular files or links from another source. `/fitch-setup verify` reports all drift without changing anything.

The manifest is the source of truth for package channels, models, bundled resources, and optional service connections. It keeps the released `pi-agent-browser-native` wrapper paired with its tested Agent Browser 0.33.2 baseline instead of waiting on an unreleased wrapper update. [`examples/settings.json`](examples/settings.json) is a safe subset of my behavioral settings, not a credential-bearing config dump.

## Prompts

The package registers only two prompts:

- `/fitch-setup` for installing or verifying the kit.
- `/github-open-issues-prs` for the one prompt-backed operational flow still on my normal path.

The older prompt files remain in `prompts/` as source material, but the package does not load them. Nothing is deleted; they simply no longer dominate autocomplete or the README.

## Trust and security boundaries

- Pi extensions run with the permissions of the user who started Pi. Project trust is not a sandbox.
- My personal setup runs with full approvals and does not put a confirmation dialog in front of each MCP call. The working agreement is model policy, not a technical authorization boundary.
- Every person authenticates their own model providers and services.
- The kit contains no keys, OAuth state, private endpoints, browser profiles, raw sessions, generated catalogs, or copied service responses.
- Extension packages use bare Git or npm sources. Agent Browser's separate CLI prerequisite stays on the wrapper's tested upstream version.
- The settings example deliberately omits personal paths, package filters, credentials, and the trust default. Choose project trust explicitly.
- External writes, deployments, merges, account changes, and production actions remain user-authorized decisions.

## Repository map

```text
extensions/             compact footer, Anthropic image guard, fast-mode toggles, and session naming
examples/settings.json  safe, non-secret behavioral settings
prompts/                setup, one active operational prompt, and retained source material
themes/                 calm theme: event-horizon neutrals, single steel-blue accent family
setup-manifest.json     package sources and selectable integrations
templates/              optional working-agreement blocks
docs/                   technical guide and overview
scripts/                validation, package smoke, and focused regressions
```

## Validation

```bash
npm install
npm run check
npm run smoke
```

- `npm run check` type-checks and syntax-checks the bundled extensions, exercises the image guard boundary, both fast toggles, and session naming, then validates unpinned package sources, manifest resources, package metadata alignment, the absence of retired patch and duplicate surfaces, the settings example's compaction values, and that every manifest context-window override names a manifest-managed route with a sane value.
- `npm run regression:fast-mode` verifies both toggles at the wire through real pi-ai serialization: `speed` plus fetch-time beta append on direct and gateway Opus routes without dropping existing markers, beta deduplication, prebuilt-client bypass, full-stream option survival, OpenAI priority payloads, off-state passthrough, footer eligibility including proxy exclusion, and watcher cleanup.
- `npm run regression:session-name` verifies naming, metadata injection, protected identities, and single ownership during standalone-package migration.
- `npm run smoke` loads the checkout through Pi's real resource loader, renders the compact footer at wide and narrow widths, checks its toggle, and requires the three bundled commands, `name_session`, one provider request hook, four extensions, and two prompts.
- `npm run smoke:lifecycle` uses an isolated Pi agent dir for real install, stale-filter and duplicate-identity normalization, and resource reload.

For the detailed workflow, model table, evidence, and security rationale, read [docs/pi-setup.md](docs/pi-setup.md). For the short version, read [docs/pi-setup-post.md](docs/pi-setup-post.md).
