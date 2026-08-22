# pi-fitch-kit

This repository documents how I combine public extensions, model-routed subagents, skills, connected MCP services, and local policy.

The kit installs the public packages without forking or patching [Pi](https://github.com/badlogic/pi-mono). Credentials, private provider definitions, and user-local experiments stay user-managed.

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
| [`pi-todo-list`](https://github.com/fitchmultz/pi-todo-list) | Persistent nested task state that survives long sessions and compaction |
| [`pi-change-working-dir`](https://github.com/fitchmultz/pi-change-working-dir) | Safe mid-session movement into worktrees and monorepo subprojects |
| [`pi-calculator`](https://github.com/fitchmultz/pi-calculator) | Deterministic high-precision arithmetic instead of model estimation |

### Session quality and small friction reducers

| Extension | What I use it for |
|---|---|
| [`pi-ctx-info`](https://github.com/fitchmultz/pi-ctx-info) | `/ctx` breakdown of reported context usage, estimated composition, loaded resources, and the largest session entries |
| [`pi-verbosity-control`](https://github.com/ferologics/pi-verbosity-control) | Low routine answer verbosity on OpenAI routes |
| [`pi-tool-duration`](https://github.com/fitchmultz/pi-tool-duration) | Model-visible timing on slow tool calls |
| [`pi-edit-session-in-place`](https://github.com/fitchmultz/pi-edit-session-in-place) | Re-edit or remove an earlier user turn in the current branch |
| [`pi-stash`](https://github.com/fitchmultz/pi-stash) | Park and restore a draft message while handling another thought |
| [`pi-copy-message`](https://github.com/fitchmultz/pi-copy-message) | Copy raw session messages without terminal formatting |
| [`ponytail`](https://github.com/DietrichGebert/ponytail) | Persistent pressure toward reuse, deletion, native features, and the smallest root-cause fix |

### Extensions bundled by this kit

[`clean-footer`](extensions/clean-footer.ts) removes cumulative token, cache, cache-hit, and cost counters while retaining the working directory, session name, context usage, model, thinking level, and extension statuses. It uses two lines when everything fits and wraps whole status items onto additional lines instead of truncating them. `/clean-footer` toggles the compact and built-in footers for comparison.

[`session-name`](extensions/session-name.ts) provides the `name_session` tool and inert session-name metadata that keep `/resume` searchable without renaming sessions for every subtask. It preserves coordinator and numbered subagent identities unless the user confirms their removal. During migration, it defers to an already loaded standalone `name_session` tool until `/fitch-setup` removes that package and Pi reloads.

[`fast-mode`](extensions/fast-mode.ts) owns the provider fast toggles in one place. `/anthropic-fast [on|off|toggle|status]` requests Anthropic's research-preview fast mode for Opus 5 and Opus 4.8 at double the token price, with reported cost rates doubled to match; it is verified working on this setup's Claude subscription OAuth route, where identical output ran roughly 2x faster with the toggle on. `/codex-fast [on|off|toggle|status]` requests OpenAI's priority service tier on the `openai` and `openai-codex` providers, plus `cloudflare-ai-gateway` models whose id starts with `gpt-`, through Pi's stock `before_provider_request` hook. `/xai-fast [on|off|toggle|status]` requests the same `service_tier: "priority"` field on the `xai` provider and on `cloudflare-ai-gateway` models whose id starts with `grok-`. Both gateway routes are live-verified: the response echoes `service_tier: "priority"` through the gateway for `gpt-5.6-sol` and `grok-4.6`. Grok time-to-first-token is often unchanged when idle; the tier still buys queue priority under load. Reported cost is not request-doubled: Pi applies the 2x Responses multiplier when the response confirms priority (`grok-4.5`); Completions models including `grok-4.6` stay on catalog rates. Anthropic fast mode cannot ride the stock hooks: pi-ai assembles `anthropic-beta` (OAuth identity and feature markers) inside its client after extension header hooks run, and merges header sources last-write-wins, so a hook-written value would drop Pi's own markers. The extension therefore owns the `anthropic-messages` stream callback for exactly the `anthropic` and `cloudflare-ai-gateway` providers and appends the mandatory beta at fetch time, so `speed` and header travel atomically and gateway Opus gets the same toggle as the direct route. Other Opus proxies such as `github-copilot` and `opencode` stay stock, requests carrying a caller-supplied `client` stay on standard speed, and Pi-internal requests such as compaction run fast on an eligible model while the toggle is on. Toggle state lives in the shared per-user `anthropic-fast.json`, `openai-codex-fast.json`, and `xai-fast.json` files; the footer shows `fast` only while the toggle is on and an eligible model is selected, and follows changes made in other sessions.

Accepted caveats of owning that callback: do not combine it with another Anthropic or gateway provider override without reviewing both, since Pi merges registrations last-write-wins; start a fresh Pi process after disabling or removing it, because `/reload` does not clear model-runtime provider overrides; and revalidate it when upgrading Pi, since it depends on Pi's provider composition and header-merge behavior.

[`anthropic-image-guard`](extensions/anthropic-image-guard.ts) preserves full-resolution images for other models while resizing only Claude-bound images to Anthropic's inline limits, on every route that speaks `anthropic-messages` (direct, Cloudflare AI Gateway, proxies such as GitHub Copilot). Non-Claude models sharing that wire API keep their source images.

[`write-prompt`](extensions/write-prompt.ts) adds `/draft <text>` and `/side-question <text>`. Both use the current session system prompt and conversation off-transcript. `/draft` wraps the source and rewrites it into an agent request (it does not answer the text and does not receive tools), then Accept, Copy prompt, Tweak, or Deny. `/side-question` answers the question, then Copy answer, Ask again, or Dismiss; it never sends to the agent. Ask again goes back to the same writer. Copy does not touch the editor. Both use the active session model unless `~/.pi/agent/write-prompt.json` sets `{ "model": "provider/id" }`. That writer, including an override model, receives the current session context.

### Selective experimental extension

[`macuse`](https://github.com/fitchmultz/macuse) adds native macOS application inspection and control when a browser DOM or CLI is not enough. I enable it only for tasks that need native app automation. It is intentionally marked experimental because Codex app updates can break the integration surface.

### User-local extensions

One loaded extension and one disabled local extension remain intentionally outside Complete core. `nested-agents.ts` is present but force-disabled in my settings; when enabled, it appends repository-controlled `<cwd>/.pi/agent/AGENTS.md` instructions, so I keep it off rather than expose an untrusted-repository prompt-injection path. The loaded `gpt-5-6-sol-pro.ts` adds `reasoning.mode: "pro"` when I select a user-managed `openai/gpt-5.6-sol-pro` alias. That alias advertises a 500k context window but is not in `enabledModels`, so it does not change the active ten-route 320k policy. Neither extension is installed by this kit.

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

[`pi-subagents`](https://github.com/fitchmultz/pi-subagents) supplies both the orchestration runtime and the opinionated defaults: sixteen specialist profiles plus its general-purpose `delegate`. This kit uses that package instead of owning duplicate copies.

| Job | Profiles |
|---|---|
| Map and investigate | [`scout`](https://github.com/fitchmultz/pi-subagents/blob/main/agents/scout.md), [`context-builder`](https://github.com/fitchmultz/pi-subagents/blob/main/agents/context-builder.md), [`debugger`](https://github.com/fitchmultz/pi-subagents/blob/main/agents/debugger.md), [`researcher`](https://github.com/fitchmultz/pi-subagents/blob/main/agents/researcher.md) |
| Monitor changing state | [`watcher`](https://github.com/fitchmultz/pi-subagents/blob/main/agents/watcher.md) |
| Decide and plan | [`planner`](https://github.com/fitchmultz/pi-subagents/blob/main/agents/planner.md), [`oracle`](https://github.com/fitchmultz/pi-subagents/blob/main/agents/oracle.md) |
| Implement bounded work | [`worker`](https://github.com/fitchmultz/pi-subagents/blob/main/agents/worker.md), [`fixer`](https://github.com/fitchmultz/pi-subagents/blob/main/agents/fixer.md) |
| Challenge the result | [`reviewer`](https://github.com/fitchmultz/pi-subagents/blob/main/agents/reviewer.md), [`reviewer-gpt`](https://github.com/fitchmultz/pi-subagents/blob/main/agents/reviewer-gpt.md), [`reviewer-claude`](https://github.com/fitchmultz/pi-subagents/blob/main/agents/reviewer-claude.md), [`reviewer-security`](https://github.com/fitchmultz/pi-subagents/blob/main/agents/reviewer-security.md), [`reviewer-ponytail`](https://github.com/fitchmultz/pi-subagents/blob/main/agents/reviewer-ponytail.md), [`ui-designer`](https://github.com/fitchmultz/pi-subagents/blob/main/agents/ui-designer.md) |
| Human-facing output | [`writer`](https://github.com/fitchmultz/pi-subagents/blob/main/agents/writer.md) |

The parent session remains responsible for the task. Specialists return evidence; they do not become an autonomous hierarchy.

The current routing is:

- `cloudflare-ai-gateway/claude-opus-5` handles context assembly, debugging, planning, fixes, general review, Claude review, and UI judgment.
- `openai/gpt-5.6-sol` handles scouting, research, implementation, GPT review, monitoring, and oracle decisions.
- `fireworks/accounts/fireworks/routers/kimi-k3-fast` handles security and over-engineering review.
- `cloudflare-ai-gateway/claude-fable-5` handles writing.
- `delegate` inherits the parent model.

Direct Anthropic, OpenAI Codex, and alternate gateway routes provide ordered fallbacks. Gateway and Fireworks routes require the user's own provider configuration; the public direct routes keep the setup portable when those owner-specific routes are unavailable. `oracle` alone uses forked parent context. Every other specialist starts fresh, and every profile is a leaf agent.

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
| [`pi-extension-development`](https://github.com/fitchmultz/pi-agent-skills/tree/main/skills/pi-extension-development) | Build, debug, validate, package, and release Pi extensions against current runtime contracts |
| [`propose-then-ship-pi`](https://github.com/fitchmultz/pi-agent-skills/tree/main/skills/propose-then-ship-pi) | Rank one repository improvement, stop for direction, then implement, review, and ship it |
| [`tdd`](https://github.com/fitchmultz/pi-agent-skills/tree/main/skills/tdd) | Red-green-refactor when test-first behavior is explicitly required |
| [`thermo-nuclear-code-quality-review`](https://github.com/fitchmultz/pi-agent-skills/tree/main/skills/thermo-nuclear-code-quality-review) | Strict maintainability review for large or structurally risky diffs |
| [`ux-review`](https://github.com/fitchmultz/pi-agent-skills/tree/main/skills/ux-review) | Review user-visible workflows for completion, recovery, progress, and truthful outcomes |
| [`verification-before-completion`](https://github.com/fitchmultz/pi-agent-skills/tree/main/skills/verification-before-completion) | Require current evidence before completion, commit, PR, or passing-check claims |

Companion skills ship beside their extensions:

| Source | Skills |
|---|---|
| [`pi-subagents`](https://github.com/fitchmultz/pi-subagents/tree/main/skills) | `pi-subagents` orchestration and `pi-intercom` coordination guidance |
| [`pi-mcp-adapter`](https://github.com/fitchmultz/pi-mcp-adapter/tree/main/skills/mcp-scripting) | `mcp-scripting` for discovering and composing MCP calls |
| [`ponytail`](https://github.com/DietrichGebert/ponytail/tree/main/skills) | `ponytail`, `ponytail-review` (my runtime filters the audit, debt, gain, and help variants) |

`bro` is intentionally user-invoked only. My runtime filters the packaged `handoff` skill because subagent artifacts and Intercom cover that path; unfiltered `pi-agent-skills` installs still include it. The rest are selected by task fit rather than loaded into every prompt.

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
2. Native repository search and, when useful, a fresh `scout` map the real code path before editing.
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

Requires Node.js 24 or newer.

```bash
npm install -g --ignore-scripts @earendil-works/pi-coding-agent@0.84.2
pi
# Complete provider login in Pi, then:
pi install git:github.com/fitchmultz/pi-fitch-kit
# /reload, then:
/fitch-setup
```

`/fitch-setup` reads [`setup-manifest.json`](setup-manifest.json), previews every package install and file change, and asks which parts to apply. It never reads or copies credentials. Reruns normalize filtered, pinned, or duplicate kit entries to one canonical source. They also preview removal of retired standalone packages, the archived Intercom package, and legacy kit-owned profile symlinks; symlink cleanup never removes regular files or links from another source. A separate consent step merges the manifest's flat context-window overrides into `models.json` per route, keeping existing values unless explicitly overwritten. `/fitch-setup verify` reports all drift without changing anything.

The manifest is the source of truth for package channels, models, bundled resources, and optional service connections. It keeps the released `pi-agent-browser-native` wrapper paired with its tested Agent Browser 0.33.2 baseline instead of waiting on an unreleased wrapper update. [`examples/settings.json`](examples/settings.json) is a safe subset of my behavioral settings, not a credential-bearing config dump. It mirrors the direct OpenAI Sol default and current ten-route model cycle; setup filters unavailable owner-specific routes when applying `enabledModels`.

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
extensions/             compact footer, Anthropic image guard, fast-mode toggles, session naming, /draft, and /side-question
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

- `npm run check` type-checks and syntax-checks the bundled extensions, exercises the image guard boundary, the fast toggles, session naming, `/draft`, and `/side-question`, then validates unpinned package sources, manifest resources, package metadata alignment, the absence of retired patch and duplicate surfaces, the settings example's model, retry, and compaction values, and that every enabled or context-window route is manifest-managed with a sane value.
- `npm run regression:fast-mode` verifies the fast toggles at the wire through real pi-ai serialization: `speed` plus fetch-time beta append on direct and gateway Opus routes without dropping existing markers, beta deduplication, prebuilt-client bypass, full-stream option survival, OpenAI and xAI priority via the stock request hook, off-state passthrough, footer eligibility including proxy exclusion, and watcher cleanup.
- `npm run regression:session-name` verifies naming, metadata injection, protected identities, and single ownership during standalone-package migration.
- `npm run regression:write-prompt` verifies model-override parsing, accept/deny, boxed rewrite instructions, `/side-question` ask-again history, session-prefix rewriting, and that tweak rounds reuse the same writer history.
- `npm run smoke` loads the checkout through Pi's real resource loader, renders the compact footer at wide and narrow widths, checks its toggle, and requires the six bundled commands, `name_session`, one provider request hook, five extensions, and two prompts.
- `npm run smoke:lifecycle` uses an isolated Pi agent dir for real install, stale-filter and duplicate-identity normalization, and resource reload.

For the detailed workflow, model table, evidence, and security rationale, read [docs/pi-setup.md](docs/pi-setup.md). For the short version, read [docs/pi-setup-post.md](docs/pi-setup-post.md).
