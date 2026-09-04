# How I actually use Pi

_Updated 25 August 2026 for Pi 0.84.2 or newer on Node.js 24 or newer._

The useful part of this setup is not the package count. It is the division of responsibility.

One main Pi session owns the task. It gathers context, makes decisions, usually edits the code, verifies the result, and explains what happened. Fresh specialist sessions help with reconnaissance, research, bounded parallel work, and independent review. Extensions provide reliable tools. Skills provide task-specific operating rules. MCP connects the coding loop to the systems around it.

This is not an autonomous swarm. The parent session is the lead engineer.

## Architecture

```text
Pi core
  ├─ public extensions and deterministic tools
  ├─ fresh, bounded subagents with per-role model routing
  ├─ task-selected skills and working agreements
  └─ user-authenticated MCP services
```

[`pi-fitch-kit`](https://github.com/fitchmultz/pi-fitch-kit) packages the opinionated composition layer: five bundled extensions, a safe settings example, unpinned package sources, and a setup prompt. The sixteen specialist profiles now ship with [`pi-subagents`](https://github.com/fitchmultz/pi-subagents) instead of being duplicated here. Most reusable extensions and all skill packages remain independent public repositories; the kit directly owns only its harness-coupled runtime.

## A representative task

Consider a behavior change that crosses an API and a browser-visible product. The issue is brief, relevant decisions live in connected services, and the current behavior must be checked before it changes.

### 1. The main session takes ownership

I start Pi in the repository and give it the issue or ask it to retrieve the issue through an authenticated integration.

The session reads my global working agreement and repository instructions. Those rules establish the boundaries: inspect before guessing, preserve unrelated work, ask before consequential external actions, and verify the real end state before claiming completion.

Delegating part of the work does not delegate responsibility for the outcome.

### 2. It gathers connected context

Through MCP, the session can read planning context, approved conversations, support history, internal documentation, meeting notes, and observability data. It retrieves only what the task needs instead of dumping entire services into model context.

Every person authenticates their own connections. The kit contains service names and setup choices, never credentials, private endpoints, or copied service data.

### 3. It maps the code before editing

Native repository search provides path and content discovery. The main session traces callers, tests, data boundaries, and repository conventions before it chooses where to change code.

For an unfamiliar or broad surface it may launch fresh specialists in parallel:

- `scout` maps the relevant code without editing;
- `researcher` checks current external documentation or API behavior;
- `context-builder` writes a compact evidence handoff across several systems;
- `debugger` reproduces a failure and proves its root cause without fixing it.

Fresh context is deliberate. Each child receives a bounded brief rather than inheriting the parent's assumptions.

### 4. The parent decides and usually implements

Most changes stay in the main session, which keeps design, implementation, and validation in one accountable place. `apply_edits` is the normal mutation surface.

A `worker` is useful when an implementation item is independent enough for an isolated worktree or true parallelism. A `fixer` receives a confirmed finding list and changes only those items. The parent then inspects the real files and diff; a child success report is evidence, not proof.

### 5. It verifies the behavior

The narrowest meaningful repository check runs first. Deterministic arithmetic goes through the calculator. If behavior is browser-visible, Agent Browser exercises the real flow and captures current evidence rather than treating unit tests as proof of the user experience.

### 6. Fresh reviewers challenge the claim

A reviewer starts without the implementation conversation and reconstructs the claim from requirements, current files, the diff, and validation output.

- `reviewer-gpt` is the normal independent code review.
- `reviewer-claude` adds a second model family when risk warrants it.
- `reviewer-security` focuses on trust boundaries, authorization, secrets, privacy, and abuse paths.
- `ui-designer` reviews visual and interaction quality.

Reviewer findings and verdicts are review history, never reusable validation evidence. Any diff change requires every currently required reviewer to analyze the updated diff again.

### 7. The main session closes the loop

The parent fixes valid findings, reruns the evidence that proves the behavior, reports remaining risk, and performs only external actions the user already authorized.

That is the recurring shape: connected evidence, focused help, parent ownership, and independent verification.

## Enabled extension stack

The [README extension index](../README.md#enabled-extensions) links every loaded public extension to its repository. The main groups are:

- orchestration and communication: `pi-subagents`, including its bundled Intercom runtime;
- connected work: `pi-mcp-adapter`, `pi-agent-browser-native`;
- repository work: native search plus `pi-apply-edits`;
- task control: clarification guidance, persistent todos, session naming, and working-directory changes;
- deterministic support: calculator, `/ctx` context inspection, tool duration, verbosity, session editing, stash, and raw message copy;
- kit boundary: a compact non-truncating footer, stable session naming, Anthropic-only image resizing, shared fast-mode toggles for Anthropic Opus, OpenAI, and xAI routes, `/draft`, and `/side-question`, while `pi-subagents` owns its profile defaults;
- user-local only: a force-disabled `nested-agents.ts` file and the loaded 500k Sol Pro alias outside the enabled model cycle, both documented in the README but excluded from Complete core.

Most reusable extensions stay independent. The kit directly owns only the small runtime surfaces coupled to this harness; no external package depends on the kit.

[`macuse`](https://github.com/fitchmultz/macuse) is the selective exception to the default stack. It adds native macOS app inspection and control for tasks that cannot be handled through browser DOM or CLI tools. I enable it only when needed and treat it as experimental because Codex app updates can break the integration surface.

## Model routing

The agent files are the runtime source of truth. Models, fallbacks, effort, and context policy live in frontmatter; role bodies contain only the job, evidence standard, boundaries, and output contract.

| Agent | Primary | Fallbacks | Thinking | Context |
|---|---|---|---|---|
| `scout` | OpenAI Sol | Codex Sol | high | fresh |
| `context-builder` | Gateway Opus | Direct Opus, Gateway Fable, OpenAI Sol | xhigh | fresh |
| `debugger` | Gateway Opus | Direct Opus, OpenAI Sol, Codex Sol | max | fresh |
| `researcher` | OpenAI Sol | Codex Sol | xhigh | fresh |
| `planner` | Gateway Opus | Direct Opus, Gateway Fable, OpenAI Sol | xhigh | fresh |
| `worker` | OpenAI Sol | Gateway Opus, Codex Sol | xhigh | fresh |
| `fixer` | Gateway Opus | Direct Opus, OpenAI Sol, Codex Sol | max | fresh |
| `reviewer` | Gateway Opus | Direct Opus, OpenAI Sol, Gateway Fable | max | fresh |
| `reviewer-gpt` | OpenAI Sol | Codex Sol | xhigh | fresh |
| `reviewer-claude` | Gateway Opus | Direct Opus, Gateway Fable | max | fresh |
| `reviewer-security` | Kimi Fast | OpenAI Sol, Codex Sol | max | fresh |
| `reviewer-ponytail` | Kimi Fast | Direct Fable | max | fresh |
| `oracle` | OpenAI Sol | Codex Sol | xhigh | fork |
| `ui-designer` | Gateway Opus | Direct Opus, Gateway Fable, Codex Sol | xhigh | fresh |
| `writer` | Gateway Fable | Direct Fable, Gateway Opus | high | fresh |
| `watcher` | OpenAI Sol | Kimi Fast | high | fresh |

`delegate` inherits the parent model. Full model identifiers are in [`pi-subagents/agents`](https://github.com/fitchmultz/pi-subagents/tree/main/agents):

- Gateway Opus: `cloudflare-ai-gateway/claude-opus-5`
- Gateway Fable: `cloudflare-ai-gateway/claude-fable-5`
- Direct Opus: `anthropic/claude-opus-5`
- Direct Fable: `anthropic/claude-fable-5`
- OpenAI Sol: `openai/gpt-5.6-sol`
- Codex Sol: `openai-codex/gpt-5.6-sol`
- Kimi Fast: `fireworks/accounts/fireworks/routers/kimi-k3-fast`

Gateway Opus handles the Claude-heavy analysis and review roles. OpenAI Sol handles fast reconnaissance, implementation, monitoring, and the GPT path. Kimi supplies focused security and deletion-oriented review. Gateway Fable handles writing. Direct Anthropic and Codex routes preserve portable fallbacks when the owner-specific gateway and router configuration is unavailable. Grok, GLM, and Gemini remain available in the main session's model cycle but are not current subagent primaries.

Every specialist is a leaf. `oracle` is the only fork-context role because its job is to compare a direction against the parent conversation; other roles receive fresh briefs and inspect current evidence.

Benchmark rationale and the 26 July 2026 Artificial Analysis plus CursorBench snapshot are available as [PDF](./Model_Reference_Sheet_Artificial_Analysis_2026-07-26.pdf) and [DOCX](./Model_Reference_Sheet_Artificial_Analysis_2026-07-26.docx).

## Active skills

The public skills are source-managed rather than copied through a home directory:

- [`pi-agent-skills`](https://github.com/fitchmultz/pi-agent-skills) carries clarification, dogfooding, TDD, extension development, end-to-end shipping, UX review, completion verification, and strict review modes. Its [`diagram-creation`](https://github.com/fitchmultz/pi-agent-skills/tree/main/skills/diagram-creation) skill produces editable D2 plus SVG/PNG architecture, sequence, data-flow, dependency, lifecycle, and before/after diagrams with generated review images.
- `pi-subagents` ships both orchestration and Intercom usage skills; `pi-mcp-adapter` ships its scripting skill.
- [`ponytail`](https://github.com/DietrichGebert/ponytail) supplies the active minimalism mode and focused review skill; my runtime filters its audit, debt, gain, and help variants.

Pi loads a skill only when the task matches. This keeps the default prompt small while giving specialized work an explicit procedure. My runtime filters the packaged `handoff` skill because subagent artifacts and Intercom cover that path.

## MCP and authenticated context

The current connected services cover:

- an internal integration gateway;
- GitHub repositories, issues, pull requests, checks, reviews, and releases;
- Linear planning context;
- primary and development Slack workspaces;
- Cloudflare infrastructure;
- Sentry and Datadog observability;
- Plain support context;
- Notion knowledge;
- Granola meetings.

`pi-mcp-adapter` provides searchable tool discovery so hundreds of service tools do not have to sit in the model's prompt at once. The gateway can expose direct tools for common operations and nested catalogs for rarer ones. Its optional `mcp_script` mode is trusted local code execution when enabled, not a sandbox or an authorization boundary. The setup uses only manifest-listed integrations and refuses mutable npm specs such as `@latest` for local stdio servers.

Authentication remains user-scoped. The setup process may inspect non-secret connection status, but it does not read credential stores or service payloads merely to claim that setup worked.

My personal runtime uses full approvals. MCP transports tool calls; it is not the authorization boundary. The working agreement tells the model when external writes need explicit user direction, but that is policy rather than a per-tool enforcement mechanism. A multi-user product needs its authorization controls in the surrounding identity and execution plane.

## Compaction policy

The settings example pins `compaction.reserveTokens: 64000` with `keepRecentTokens: 40000`, and the manifest's `modelContextWindows` merge flat 320k windows into `models.json` for the managed routes. Together they compact at a 256k threshold with roughly 60k of near-threshold generation runway. The override lowers the ~1M direct Anthropic routes, raises the 272k direct OpenAI and Codex routes, and pins the verified Claude gateway routes to the same policy. Any direct OpenAI request whose input crosses 272k bills at the long-context tier for the entire request. That is a deliberate quality-over-cost choice; decline the consent step to keep stock behavior. Gateway Grok, xAI Grok, Fireworks, and cf-google are full user-managed model definitions in my setup and already declare 320k; the public kit does not copy their private endpoints or pricing metadata.

## Image quality boundary

My safe settings subset is checked in at [`examples/settings.json`](../examples/settings.json). The non-default image choice is intentional:

```json
{
  "images": {
    "autoResize": false
  }
}
```

Disabling global resize preserves original detail for image analysis. [`anthropic-image-guard.ts`](../extensions/anthropic-image-guard.ts) then enforces the stricter boundary only for Claude models on the `anthropic-messages` API, whichever provider routes them (direct Anthropic, Cloudflare AI Gateway, proxies). It caches eight recent successful transformations, clears them on session start and compaction, retries failures, and omits sources above 32 MiB of base64 or contexts above 64 MiB before native decoding. This is the same pattern used elsewhere in the setup: retain capability globally, then adapt at the narrow provider boundary that needs it.

## Subagent launch policy

- Use `context: "fresh"` unless the task explicitly requires parent transcript history.
- Use `context: "fork"` only for oracle consistency checks.
- Hand off with compact files such as `context.md`, `plan.md`, or `review.md` instead of inherited transcripts.
- Use separate async reviewer runs so each completion can wake the parent without a polling loop.
- Use foreground execution only when an incomplete active goal needs same-turn child evidence.
- Use `outputMode: "file-only"` for bulky saved output and return only the decision-relevant summary inline.
- Keep the parent responsible for final decisions, verification, and user-facing status.

## Evidence and review discipline

Reusable evidence means deterministic, machine-produced validation: command output, instrumented runtime checks, and CI tied to the same clean tree and environment.

Manual observations are current-only. Reviewer findings, verdicts, and sign-off are review history. They may be carried forward as context, but they cannot satisfy a later reviewer pass or sign off a changed diff.

That distinction matters because fresh review is valuable precisely when the implementation story looks complete. A green test suite does not turn previous reviewer judgment into a cacheable artifact.

## Usage evidence

In a sample of 139 top-level sessions from 8–15 July 2026, counted from aggregate tool and session metadata rather than raw conversation content:

| Behavior | Sessions | Share |
|---|---:|---:|
| MCP integrations | 88 | 63% |
| Any subagent | 80 | 58% |
| File edits or writes | 79 | 57% |
| Fresh reviewer profiles | 72 | 52% |
| Browser automation or web search | 63 | 45% |
| Repository search through FFF (sample period) | 61 | 44% |
| Worker or fixer profiles | 9 | 6% |

The contrast is the point: the main session usually implements, while specialists most often provide reconnaissance and independent review. Connected services, browser work, and repository search are ordinary workflow, not demo features.

## Install and verify

```bash
npm install -g --ignore-scripts @earendil-works/pi-coding-agent
pi
# Complete provider login, then:
pi install git:github.com/fitchmultz/pi-fitch-kit
# /reload, then:
/fitch-setup
```

The setup prompt reads [`setup-manifest.json`](../setup-manifest.json), shows one preview, and installs only the selected unpinned sources. Upgrades normalize filtered, pinned, or duplicate kit entries to one canonical unfiltered source. Agent Browser stays at 0.36.0 because that is the released wrapper's tested baseline; the wrapper documents that compatibility baseline. The prompt offers the safe settings keys and the context-window overrides as separate consent steps, preserves unrelated configuration, stops on the first failed command with completed and remaining steps, and verifies loaded resources after reload.

`/fitch-setup verify` is read-only. It reports drift in package identity and filters, profiles, extensions, prompts, skills, model availability, consent-gated route state, and `models.json` context-window overrides.

## Trust and security boundaries

Pi extensions run with the permissions of the user who started Pi. Project trust controls whether project-local configuration loads; it is not a sandbox. My personal setup runs fully approved, so the working agreement and operator oversight are policy controls rather than per-tool technical enforcement.

A shared setup must not distribute:

- authentication files, OAuth state, keys, or tokens;
- private service endpoints;
- browser profiles;
- raw Pi sessions;
- generated model catalogs or caches;
- copied service responses.

The settings example omits trust policy intentionally. Choose `defaultProjectTrust` and subagent child trust for the environment rather than copying mine. Untrusted repositories should use `no-approve`.

Extension packages use bare Git or npm sources. The separate Agent Browser CLI version matches the wrapper's tested compatibility baseline.

Consequential external writes, production actions, account changes, and merges still require explicit authorization.

## From this setup to an organization harness

The current stack already proves the reusable substrate:

- multiple model providers with per-role routing and fallback;
- independent extension packages rather than a core fork;
- bounded multi-agent execution, worktrees, review loops, and local session coordination;
- authenticated access to planning, conversation, support, knowledge, and observability systems;
- Git-backed policy, skills, profiles, and updateable package sources;
- durable local sessions, browser automation, and a clear permission boundary.

A product layer would add central provisioning, SSO, policy distribution, scoped credential brokerage, audit and cost visibility, managed local/cloud execution, and multi-user controls. Those concerns belong above the reusable Pi primitives, not inside every extension.

That is why this repository is useful beyond copying one setup: it is a running reference implementation of the composition layer an organization harness needs.
