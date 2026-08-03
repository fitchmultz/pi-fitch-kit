# How I actually use Pi

_Last updated 3 August 2026 for Pi 0.83.0._

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

[`pi-fitch-kit`](https://github.com/fitchmultz/pi-fitch-kit) packages the opinionated composition layer: agent profiles, two small extensions, a safe settings example, exact dependency pins, and a setup prompt. The underlying extensions and skill packages remain independent public repositories.

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

FFF provides fast path and content search. The main session traces callers, tests, data boundaries, and repository conventions before it chooses where to change code.

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

- orchestration and communication: `pi-subagents`, `pi-intercom`;
- connected work: `pi-mcp-adapter`, `pi-agent-browser-native`;
- repository work: `pi-fff`, `pi-apply-edits`;
- task control: structured questions, persistent todos, session naming, and working-directory changes;
- deterministic support: calculator, tool duration, verbosity, compaction, session editing, stash, and raw message copy;
- kit boundaries: safe agent-profile syncing and Anthropic-only image resizing.

Small extensions are intentionally independent. The kit composes them; none has to depend on this personal distribution.

[`macuse`](https://github.com/fitchmultz/macuse) is the selective exception to the default stack. It adds native macOS app inspection and control for tasks that cannot be handled through browser DOM or CLI tools. I enable it only when needed and treat it as experimental because Codex app updates can break the integration surface.

## Model routing

The agent files are the runtime source of truth. Models, fallbacks, effort, and context policy live in frontmatter; role bodies contain only the job, evidence standard, boundaries, and output contract.

| Agent | Primary | Fallbacks | Thinking | Context |
|---|---|---|---|---|
| `scout` | `xai/grok-4.5` | Codex Luna, OpenAI Luna | high | fresh |
| `context-builder` | `xai/grok-4.5` | Codex Sol, OpenAI Sol | high | fresh |
| `debugger` | Codex Sol | Fable 5, OpenAI Sol | high | fresh |
| `researcher` | Codex Sol | OpenAI Sol, Opus 5 | xhigh | fresh |
| `planner` | Codex Sol | Fable 5, OpenAI Sol | xhigh | fresh |
| `worker` | `xai/grok-4.5` | Codex Sol, OpenAI Sol, Opus 5 | high | fresh |
| `fixer` | `xai/grok-4.5` | Codex Sol, OpenAI Sol, Opus 5 | high | fresh |
| `reviewer` | Codex Sol | OpenAI Sol, Codex Terra | high | fresh |
| `reviewer-gpt` | Codex Sol | OpenAI Sol, Codex Terra | xhigh | fresh |
| `reviewer-claude` | Fable 5 | Opus 5, `xai/grok-4.5` | xhigh | fresh |
| `reviewer-security` | Codex Sol | `xai/grok-4.5`, OpenAI Sol | xhigh | fresh |
| `oracle` | Codex Sol | OpenAI Sol | xhigh | fork |
| `ui-designer` | Fable 5 | Opus 5, Codex Sol, OpenAI Sol | xhigh | fresh |
| `writer` | Fable 5 | Opus 5 | high | fresh |

Full model identifiers are in [`agents/`](../agents/). The compact names above mean:

- Codex Sol: `openai-codex/gpt-5.6-sol`
- OpenAI Sol: `openai/gpt-5.6-sol`
- Codex Luna: `openai-codex/gpt-5.6-luna`
- OpenAI Luna: `openai/gpt-5.6-luna`
- Codex Terra: `openai-codex/gpt-5.6-terra`
- Fable 5: `anthropic/claude-fable-5`
- Opus 5: `anthropic/claude-opus-5`

The routing is not variety for its own sake. Grok handles fast work under a smart parent. Sol handles consequential reasoning and the GPT review path. Fable supplies an independent model family for writing, UI judgment, and cross-model review. Opus is the stronger Anthropic fallback.

Every profile is a leaf. `oracle` is the only fork-context role because its job is to compare a direction against the parent conversation; other roles receive fresh briefs and inspect current evidence.

Benchmark rationale and the 26 July 2026 Artificial Analysis plus CursorBench snapshot are available as [PDF](./Model_Reference_Sheet_Artificial_Analysis_2026-07-26.pdf) and [DOCX](./Model_Reference_Sheet_Artificial_Analysis_2026-07-26.docx).

## Active skills

The public skills are source-managed rather than copied through a home directory:

- [`pi-agent-skills`](https://github.com/fitchmultz/pi-agent-skills) carries clarification, dogfooding, diagrams, handoffs, TDD, extension development, end-to-end shipping, completion verification, and two strict review modes.
- `pi-subagents`, `pi-intercom`, and `pi-mcp-adapter` ship their own usage skills beside the implementation.
- [`ponytail`](https://github.com/DietrichGebert/ponytail) supplies the minimalism mode and its audit/review helpers.

Pi loads a skill only when the task matches. This keeps the default prompt small while giving specialized work an explicit procedure.

## MCP and authenticated context

The current connected services cover:

- an internal integration gateway;
- Linear planning context;
- primary and development Slack workspaces;
- Cloudflare infrastructure;
- Sentry and Datadog observability;
- Plain support context;
- Notion knowledge;
- Granola meetings.

`pi-mcp-adapter` provides searchable tool discovery so hundreds of service tools do not have to sit in the model's prompt at once. The gateway can expose direct tools for common operations and nested catalogs for rarer ones.

Authentication remains user-scoped. The setup process may inspect non-secret connection status, but it does not read credential stores or service payloads merely to claim that setup worked.

My personal runtime uses full approvals. MCP transports tool calls; it is not the authorization boundary. The working agreement tells the model when external writes need explicit user direction, but that is policy rather than a per-tool enforcement mechanism. A multi-user product needs its authorization controls in the surrounding identity and execution plane.

## Image quality boundary

My safe settings subset is checked in at [`examples/settings.json`](../examples/settings.json). The non-default image choice is intentional:

```json
{
  "images": {
    "autoResize": false
  }
}
```

Disabling global resize preserves original detail for image analysis. [`anthropic-image-guard.ts`](../extensions/anthropic-image-guard.ts) then enforces the stricter boundary only when the selected provider is Anthropic. Its eight-entry cache is cleared on session start and compaction, so preserving image quality does not create unbounded session memory. This is the same pattern used elsewhere in the setup: retain capability globally, then adapt at the narrow provider boundary that needs it.

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
| FFF repository search | 61 | 44% |
| Worker or fixer profiles | 9 | 6% |

The contrast is the point: the main session usually implements, while specialists most often provide reconnaissance and independent review. Connected services, browser work, and repository search are ordinary workflow, not demo features.

## Install and verify

```bash
npm install -g --ignore-scripts @earendil-works/pi-coding-agent@0.83.0
pi
# Complete provider login, then:
pi install git:github.com/fitchmultz/pi-fitch-kit@v0.2.2
# /reload, then:
/fitch-setup
```

The setup prompt reads [`setup-manifest.json`](../setup-manifest.json), shows one preview, and installs only exact selected sources. Agent Browser 0.33.2's npm package includes the native assets. Setup installs it with lifecycle scripts disabled, then checks the selected platform binary against its pinned SHA-256 digest before execution. The prompt offers the safe settings keys separately, preserves unrelated configuration, stops for authentication, and verifies loaded resources after reload.

`/fitch-setup verify` is read-only. It reports drift in package pins, profiles, extensions, prompts, skills, and model availability.

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

Top-level package sources are exact pins. Agent Browser's npm-bundled native executables have platform-specific SHA-256 pins in the release manifest and are verified before use.

Consequential external writes, production actions, account changes, and merges still require explicit authorization.

## From this setup to an organization harness

The current stack already proves the reusable substrate:

- multiple model providers with per-role routing and fallback;
- independent extension packages rather than a core fork;
- bounded multi-agent execution, worktrees, review loops, and local session coordination;
- authenticated access to planning, conversation, support, knowledge, and observability systems;
- Git-backed policy, skills, profiles, and reproducible package pins;
- durable local sessions, browser automation, and a clear permission boundary.

A product layer would add central provisioning, SSO, policy distribution, scoped credential brokerage, audit and cost visibility, managed local/cloud execution, and multi-user controls. Those concerns belong above the reusable Pi primitives, not inside every extension.

That is why this repository is useful beyond copying one setup: it is a running reference implementation of the composition layer an organization harness needs.
