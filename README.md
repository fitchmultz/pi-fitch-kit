# pi-fitch-kit

My real Pi harness, packaged as a versioned, inspectable setup.

This repository shows the composition layer I use every day: public extensions, model-routed subagents, reusable skills, authenticated MCP connections, and a small amount of local policy. It is also a working prototype for a model-agnostic organization harness built on top of [Pi](https://github.com/badlogic/pi-mono), without forking Pi core.

Tagged releases are known-good snapshots. The current snapshot targets Pi `0.83.0`.

## Start here

1. [Enabled extensions](#enabled-extensions)
2. [Subagent bench](#subagent-bench)
3. [Active skills](#active-skills)
4. [Connected MCP services](#connected-mcp-services)
5. [How the workflow fits together](#how-the-workflow-fits-together)
6. [Install the snapshot](#install-the-snapshot)

Prompts are deliberately secondary. The daily workflow is driven by tools, agents, skills, and connected context.

## Enabled extensions

These are the extensions loaded in my current setup. Every external extension links to its source repository.

### Orchestration and connected work

| Extension | What I use it for |
|---|---|
| [`pi-subagents`](https://github.com/fitchmultz/pi-subagents) | Fresh specialists, parallel work, chains, isolated worktrees, async review, and durable artifacts |
| [`pi-intercom`](https://github.com/fitchmultz/pi-intercom) | Coordination between independent local Pi sessions and active child runs |
| [`pi-mcp-adapter`](https://github.com/nicobailon/pi-mcp-adapter) | One searchable gateway over configured MCP servers and their tools |
| [`pi-agent-browser-native`](https://github.com/fitchmultz/pi-agent-browser-native) | Live documentation, browser automation, screenshots, product QA, and authenticated web flows |

### Coding and task control

| Extension | What I use it for |
|---|---|
| [`pi-apply-edits`](https://github.com/fitchmultz/pi-apply-edits) | Atomic exact edits, whole-file rewrites, and plan-first multi-file changes |
| [`pi-fff`](https://github.com/dmtrKovalenko/fff/tree/main/packages/pi-fff) | Fast fuzzy path search and repository-aware content search |
| [`pi-ask-question`](https://github.com/fitchmultz/pi-ask-question) | Structured user decisions when ambiguity changes scope or safety |
| [`pi-todo-list`](https://github.com/fitchmultz/pi-todo-list) | Persistent nested task state that survives long sessions and compaction |
| [`pi-session-name`](https://github.com/fitchmultz/pi-session-name) | Searchable session names that follow the current task |
| [`pi-change-working-dir`](https://github.com/fitchmultz/pi-change-working-dir) | Safe mid-session movement into worktrees and monorepo subprojects |
| [`pi-calculator`](https://github.com/fitchmultz/pi-calculator) | Deterministic high-precision arithmetic instead of model estimation |

### Session quality and small friction reducers

| Extension | What I use it for |
|---|---|
| [`pi-codex-context`](https://github.com/fitchmultz/pi-codex-context) | OpenAI fast mode plus provider-agnostic compaction safeguards |
| [`pi-verbosity-control`](https://github.com/ferologics/pi-verbosity-control) | Low routine answer verbosity on OpenAI routes |
| [`pi-tool-duration`](https://github.com/fitchmultz/pi-tool-duration) | Model-visible timing on slow tool calls |
| [`pi-edit-session-in-place`](https://github.com/fitchmultz/pi-edit-session-in-place) | Re-edit or remove an earlier user turn in the current branch |
| [`pi-stash`](https://github.com/fitchmultz/pi-stash) | Park and restore a draft message while handling another thought |
| [`pi-copy-message`](https://github.com/fitchmultz/pi-copy-message) | Copy raw session messages without terminal formatting |
| [`ponytail`](https://github.com/DietrichGebert/ponytail) | Persistent pressure toward reuse, deletion, native features, and the smallest root-cause fix |

### Extensions bundled by this kit

| Extension | What it does |
|---|---|
| [`sync-agents`](extensions/sync-agents.ts) | Links the fourteen profiles in `agents/` into Pi's user agent directory without overwriting regular files or foreign links |
| [`anthropic-image-guard`](extensions/anthropic-image-guard.ts) | Preserves full-resolution images for other providers while resizing only Anthropic-bound images to that provider's inline limits |

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

That exposed stricter Anthropic image limits. The bundled guard fixes the boundary instead of giving up source quality everywhere: it runs only on Anthropic requests, reuses Pi's native image resizer, keeps eight recent transformations, clears that cache on compaction, and substitutes a clear omission note if resizing fails. The complete safe settings subset is in [`examples/settings.json`](examples/settings.json).

## Subagent bench

[`pi-subagents`](https://github.com/fitchmultz/pi-subagents) supplies the orchestration runtime. This kit supplies the opinionated profiles and model routing.

| Job | Profiles |
|---|---|
| Map and investigate | [`scout`](agents/scout.md), [`context-builder`](agents/context-builder.md), [`debugger`](agents/debugger.md), [`researcher`](agents/researcher.md) |
| Decide and plan | [`planner`](agents/planner.md), [`oracle`](agents/oracle.md) |
| Implement bounded work | [`worker`](agents/worker.md), [`fixer`](agents/fixer.md) |
| Challenge the result | [`reviewer`](agents/reviewer.md), [`reviewer-gpt`](agents/reviewer-gpt.md), [`reviewer-claude`](agents/reviewer-claude.md), [`reviewer-security`](agents/reviewer-security.md), [`ui-designer`](agents/ui-designer.md) |
| Human-facing output | [`writer`](agents/writer.md) |

The parent session remains responsible for the task. Specialists return evidence; they do not become an autonomous hierarchy.

The routing is intentional:

- `xai/grok-4.5` handles speed-sensitive scouting, context assembly, bounded implementation, and confirmed fixes.
- `openai-codex/gpt-5.6-sol` handles diagnosis, research, planning, GPT review, security review, and oracle decisions.
- `anthropic/claude-fable-5` supplies an independent model family for writing, UI judgment, and cross-model review, with Opus 5 behind it.
- `oracle` alone uses forked parent context. Every other role starts fresh, and every profile is a leaf agent.

The exact primary, fallback, thinking, context, tool, and output policy lives in each profile's frontmatter. See [the full setup guide](docs/pi-setup.md#model-routing) for the complete table.

## Active skills

Skills load task-specific operating instructions only when the work matches. The active public set is:

| Source | Skills |
|---|---|
| [`pi-agent-skills`](https://github.com/fitchmultz/pi-agent-skills) | `ask-clarifying-questions`, `bro`, `deslop`, `diagram-creation`, `dogfood`, `handoff`, `pi-extension-development`, `propose-then-ship-pi`, `tdd`, `thermo-nuclear-code-quality-review`, `verification-before-completion` |
| [`pi-subagents`](https://github.com/fitchmultz/pi-subagents/tree/main/skills/pi-subagents) | `pi-subagents` orchestration guidance |
| [`pi-intercom`](https://github.com/fitchmultz/pi-intercom/tree/main/skills/pi-intercom) | `pi-intercom` coordination guidance |
| [`pi-mcp-adapter`](https://github.com/nicobailon/pi-mcp-adapter/tree/main/skills/mcp-scripting) | `mcp-scripting` for discovering and composing MCP calls |
| [`ponytail`](https://github.com/DietrichGebert/ponytail/tree/main/skills) | `ponytail`, `ponytail-audit`, `ponytail-debt`, `ponytail-gain`, `ponytail-help`, `ponytail-review` |

`bro` is intentionally user-invoked only. The rest are selected by task fit rather than loaded into every prompt.

## Connected MCP services

MCP is the context and action bus around the coding loop. Authentication is per-user and is never stored in this repository.

The current setup has authenticated, read-only-discovery-verified connections for:

| Connection | Capability |
|---|---|
| `horizon` | Internal integration gateway, authenticated identity, integration API calls, and nested tool catalogs |
| Linear | Issues, projects, teams, and planning context |
| Slack, primary and development workspaces | Public and approved private conversation context, threads, users, and canvases |
| Cloudflare | Documentation plus typed account API access |
| Sentry | Issues, events, traces, releases, and project context |
| Datadog | Dashboards, monitors, metrics, logs, traces, and operational context |
| Plain | Support threads, customers, workspace data, and Sidekick sessions |
| Notion | Workspace search, pages, databases, comments, and meeting notes |
| Granola | Meeting notes, summaries, folders, and transcripts |

The organization-specific endpoint and authentication configuration stay private. [`setup-manifest.json`](setup-manifest.json) records only the service choices; `/fitch-setup` stops for each user's own login and never probes by reading service data.

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

## Install the snapshot

```bash
npm install -g --ignore-scripts @earendil-works/pi-coding-agent@0.83.0
pi
# Complete provider login in Pi, then:
pi install git:github.com/fitchmultz/pi-fitch-kit@v0.2.2
# /reload, then:
/fitch-setup
```

`/fitch-setup` reads [`setup-manifest.json`](setup-manifest.json), previews every exact package install and file change, and asks which parts to apply. It never reads or copies credentials. `/fitch-setup verify` reports drift without changing anything.

The manifest is the reproducible source of truth for package pins, models, bundled resources, and optional service connections. [`examples/settings.json`](examples/settings.json) is a safe subset of my behavioral settings, not a credential-bearing config dump.

## Prompts

The package registers only two prompts:

- `/fitch-setup` for installing or verifying the snapshot.
- `/github-open-issues-prs` for the one prompt-backed operational flow still on my normal path.

The older prompt files remain in `prompts/` as source material, but the package does not load them. Nothing is deleted; they simply no longer dominate autocomplete or the README.

## Trust and security boundaries

- Pi extensions run with the permissions of the user who started Pi. Project trust is not a sandbox.
- Every person authenticates their own model providers and services.
- The kit contains no keys, OAuth state, private endpoints, browser profiles, raw sessions, generated catalogs, or copied service responses.
- The settings example deliberately omits personal paths, package filters, credentials, and the trust default. Choose project trust explicitly.
- External writes, deployments, merges, account changes, and production actions remain user-authorized decisions.

## Repository map

```text
agents/                 fourteen specialist profiles and model policy
extensions/             agent sync and Anthropic image boundary guard
examples/settings.json  safe, non-secret behavioral settings
prompts/                 setup, one active operational prompt, and retained source material
setup-manifest.json      exact release pins and selectable integrations
templates/               optional working-agreement blocks
docs/                    full technical guide and shorter overview
scripts/                 manifest validation, package smoke, manual agent sync fallback
```

## Validation

```bash
npm install
npm run check
npm run smoke
```

- `npm run check` validates extension syntax, the image guard boundary, symlink ownership behavior, exact pins, agent model routes, manifest resources, and package metadata alignment.
- `npm run smoke` loads the checkout through Pi's real resource loader and requires exactly the two bundled extensions and two registered prompts.

For the detailed workflow, model table, evidence, and security rationale, read [docs/pi-setup.md](docs/pi-setup.md). For the short version, read [docs/pi-setup-post.md](docs/pi-setup-post.md).
