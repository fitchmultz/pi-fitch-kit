# How I actually use Pi

_Updated 29 September 2026. The kit supports Pi 0.87.1 or newer on Node.js 24.15 or newer; qualified against official Pi 0.87.1 and the maintained 0.99.1 fork containing [commit `18acca18`](https://github.com/fitchmultz/pi/commit/18acca18fbc5d38e6fcf52da01bea8be2b4f3818)._

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

[`pi-fitch-kit`](https://github.com/fitchmultz/pi-fitch-kit) packages the opinionated composition layer: seven bundled extensions, a safe settings example, unpinned package sources, and a setup prompt. The sixteen specialist profiles now ship with [`pi-subagents`](https://github.com/fitchmultz/pi-subagents) instead of being duplicated here. Most reusable extensions and all skill packages remain independent public repositories; the kit directly owns only its harness-coupled runtime.

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

Most changes stay in the main session, which keeps design, implementation, and validation in one accountable place. The [`pi-apply-edits`](https://github.com/fitchmultz/pi-apply-edits) package provides `apply_patch`, `replace_text`, and `write_files` for mutations, with `preview_patch` for read-only inspection. Its own documentation defines the tool arguments and filesystem guarantees. Pair editor 1.0 with `pi-subagents` 0.39.1 or newer so completion tracking recognizes the new tools and committed paths from partial errors.

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
- task control: clarification guidance with `pi-ask-question`, persistent todos, session naming, and working-directory changes;
- deterministic support: calculator, `/ctx` context inspection, tool duration, verbosity, session editing, stash, and raw message copy;
- kit boundary: a compact non-truncating footer, stable session naming, a bounded paged reader for long explanations and section notes, read-only in-session model status for setup, Anthropic-only image resizing, shared fast-mode toggles for Anthropic Opus, OpenAI, and xAI routes, `/draft`, and `/side-question`, while `pi-subagents` owns its profile defaults;
- user-local only: provider definitions, agent-profile overrides, and Posthorse fresh-context windows on the supporting fork; none are copied into Complete core.

Most reusable extensions stay independent. The kit directly owns only the small runtime surfaces coupled to this harness; no external package depends on the kit.

[`macuse`](https://github.com/fitchmultz/macuse) is the experimental exception to the default stack. It adds native macOS Computer Use for tasks that cannot be handled through browser DOM or CLI tools. It runs on the Computer Use runtime installed with ChatGPT, and OpenAI can change that runtime's private interfaces without notice.

## Model routing

[`pi-subagents/agents`](https://github.com/fitchmultz/pi-subagents/tree/main/agents) owns the specialist defaults. Primary models, ordered fallbacks, thinking levels, and context policy live in those files. The generic delegate inherits the parent model. User and project profiles take precedence and are preserved during kit setup; the setup preview shows the installed mapping rather than a copied table.

The settings example selects `openai-codex/gpt-6-astra` (ChatGPT/Codex subscription) at medium reasoning, with `openai/gpt-6-astra` (OpenAI API key) as the fallback. Updating the kit does not change that choice or replace explicit cross-family reviewer routes.

Use `modelOverrides` for intentional changes to native models. A full matching `models[]` definition replaces the native model and can hide new capabilities such as incremental system messages. Setup can preview a narrow migration while preserving deliberate context/output limits, reasoning maps, pricing, and all unrelated configuration. It never invents provider authentication or copies private endpoints.

On Pi 0.87, session naming uses the full-transcript context hook and keeps Pi's leading system message and later tool/prompt updates intact. Earlier supported hosts use the legacy path. Cache-friendly composition also requires native model capabilities and cooperating prompt extensions: a full-prompt override elsewhere can still rebuild the leading prompt.

The off-transcript `/draft` and `/side-question` writer retains tool-result screenshots while removing executable tool semantics. `/draft` Accept sends normally when idle or as native steering when busy. Each acceptance saves the draft and original input in session metadata outside model context. Run `/draft` without text to reopen the last accepted draft on the current branch after a send failure; Restore original returns the original command to the editor. Synchronous send errors keep the dialog open. Both commands inherit the active session's provider, model, and thinking level when writing starts. Optional `provider`, `model`, and `thinkingLevel` fields in `~/.pi/agent/write-prompt.json` override those values independently; omitted fields inherit. The existing `model: "provider/id"` format remains supported. Native Pi APIs resolve authentication, thinking capabilities, and output limits. Unsupported thinking levels are adjusted with a warning; malformed or unresolvable configuration stops the writer with a clear error instead of silently changing models. Main-agent verbosity hooks are not applied. See [writer configuration and examples](../README.md#draft-provider-model-and-thinking).

The bundled [paged reader](../README.md#enabled-extensions) is a separate main-agent presentation path: `reader_present` stores long explanations as native session-only documents, and `/reader demo` is a no-model sample. Reading and local section drafts never call a model; Ctrl+Enter explicitly requests a response with the full original section and note. Busy requests wait locally until the current agent work succeeds; cancellation leaves them unsent rather than leaking into a later prompt. Replies are linked by feedback ID or by one unambiguous final-text answer, with ambiguous or incomplete responses retained in the library. Native session entries preserve cursors and notes on the active branch. Official Pi 0.87.1 defers a new session's first custom-entry disk write until its first assistant response, so a demo before that boundary is not yet restart-durable; the maintained fork persists the first custom entry immediately. Fullscreen native mouse controls begin with Pi 0.85.1, while keyboard controls work on older supported hosts.

Native protocol async tools, live WebSocket steering, and positional reasoning updates belong to Pi's provider, agent, and session layers. They are not supplied by installing this kit. Existing background subagents continue to use their durable launch handles and completion notifications. Availability of newer native features must be checked against the selected Pi release and route.

## Optional OpenAI Ultrafast

Installation never selects Ultrafast or changes setup's model policy. `/ultrafast [on|off|toggle|status]` controls the shared OpenAI setting by default: blank means toggle, on selects Ultrafast, off disables kit OpenAI tiers, and toggle changes Ultrafast to off or any other mode to Ultrafast. `/codex-fast ultrafast` remains a global alias, with no `--session` form. The existing `openai-codex-fast.json` still stores mutually exclusive off/priority/ultrafast; legacy `enabled: true` means priority. `/codex-fast on`, blank `/fast`, and existing Fast toggle semantics remain unchanged; blank `/codex-fast` reports status.

Add `--session` to on/off/toggle to set a session-specific override; status also accepts the flag but never writes one. `/ultrafast on --session` stores local Ultrafast; `/ultrafast off --session` suppresses both kit priority and Ultrafast injection. Local off does not guarantee standard processing: native Auto or project defaults can still select a tier. `/ultrafast toggle --session` changes effective Ultrafast to local off, otherwise to local Ultrafast. Only `/ultrafast reset --session` removes the override and resumes the current shared setting; unscoped reset is invalid.

Overrides take precedence until cleared and persist in native metadata across same-ID resume, reload, `/tree`, and compaction. Forks and new session IDs do not inherit overrides; they follow current shared state. Global `/fast` and `/codex-fast` changes never clear local overrides. Status commands are read-only and show shared and effective settings, including mismatches. OpenAI modes follow normal agent payload hooks; built-in compaction and bare nested streams bypass that hook and retain native policy. Changes do not retier in-flight requests; hosts with live successor chains may retain their tier until the next ordinary request.

Ultrafast activation validates exact `gpt-6-astra` and its native route before writing either scope: `openai`/`openai-responses` at the native global or US API endpoint, or plan-entitled `openai-codex`/`openai-codex-responses` at the native ChatGPT backend. It never switches models, credentials, or endpoints. Gateway, other models, Completions, and other proxies remain excluded. Off and session reset work on unsupported routes.

`--ultrafast` remains a shared, startup-only flag and conflicts with `--fast`; neither reapplies on reload, new, resume, or fork. Invalid startup leaves state unchanged. Interactive Pi blocks requests until an explicit mode-changing command resolves the error; headless Pi reports clear stderr and exits orderly with a nonzero status before paid requests. Extension-sourced input is left unchanged, not silently swallowed. Startup and restored-Ultrafast notices disclose cost and entitlement.

The shared footer says `ultrafast requested` or `ultrafast unavailable`; session overrides say `session ultrafast requested`, `session ultrafast unavailable`, or `session OpenAI tiers off`. Unsupported effective Ultrafast is inactive, never a priority fallback. Labels describe kit request policy, not server confirmation or entitlement. [API access](https://developers.openai.com/api/docs/guides/ultrafast-mode) permits global processing and US data residency only; EU and other non-US regional inference are excluded. [API pricing](https://developers.openai.com/api/docs/pricing?latest-pricing=ultrafast) is 6× standard (3× Fast), including whole-request long-context pricing above 272k input tokens. [Codex access](https://learn.chatgpt.com/docs/agent-configuration/speed) requires $500 Pro or eligible Enterprise/Edu; other self-serve plans cannot unlock it with credits, and Enterprise access requires workspace-owner enablement. Included allowance is consumed at 8×, purchased credits/PAYG at 6×. These are billing multipliers, not a promised task-speed gain.

The kit uses the stock payload hook, with no custom OpenAI provider or routing header. HTTP streaming is valid; OpenAI strongly recommends WebSockets. Native 6× monetary estimates require a fork release containing [commit `18acca18`](https://github.com/fitchmultz/pi/commit/18acca18fbc5d38e6fcf52da01bea8be2b4f3818) and a confirmed terminal `ultrafast` tier for exact Astra. Official Pi 0.99.1 and older can send the tier but lack this accounting change. Existing `onPayload`/`before_provider_request` and `onProviderStreamEvent`/`provider_stream_event` raw hooks expose requested and returned tiers without persisting tier metadata; missing, unknown, or `default` returned values do not confirm Ultrafast. See the [README fast-mode reference](../README.md#fast-modes) for prices, rate limits, transport details, and existing priority/Anthropic caveats. Live Ultrafast verification is not claimed.

## Active skills

The public skills are source-managed rather than copied through a home directory:

- [`pi-agent-skills`](https://github.com/fitchmultz/pi-agent-skills) carries clarification, dogfooding, handoff prompts, TDD, test auditing, extension development, end-to-end shipping, UX review, completion verification, and strict review modes. Its [`diagram-creation`](https://github.com/fitchmultz/pi-agent-skills/tree/main/skills/diagram-creation) skill produces editable D2 plus SVG/PNG architecture, sequence, data-flow, dependency, lifecycle, and before/after diagrams with generated review images.
- `pi-subagents` ships both orchestration and Intercom usage skills; `pi-mcp-adapter` ships its scripting skill.
- [`ponytail`](https://github.com/fitchmultz/ponytail) supplies the active minimalism mode plus its focused review and whole-repo audit skills; my runtime filters its debt, gain, and help variants.

Pi loads a skill only when the task matches. This keeps the default prompt small while giving specialized work an explicit procedure.

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

## Compact transcript view

Compact view is an optional native Pi feature, not a bundled extension. On [the supporting fork](https://github.com/fitchmultz/pi/blob/main/FORK.md), `/compact-view` toggles the current session; `/compact-view off` returns to the normal view. The preference is saved for new sessions without changing other open sessions. Click individual tool cards in fullscreen mode or use Ctrl+O to expand details.

The native default is off. The safe settings example includes `"compactView": true` as an optional preference, not a package-install default. `/fitch-setup` offers it separately only when the installed Pi documents the setting and command, preserves an existing value or absence unless a change is selected, and skips it on unsupported runtimes. Official Pi remains supported. Core renders the tool cards; `pi-subagents` owns compact routine coordination notices. Neither the kit nor the view changes model context or saved tool results.

## Compaction policy

The settings example uses `compaction.reserveTokens: 64000` and `keepRecentTokens: 40000`. The manifest offers 300k context budgets, giving a 236k compaction threshold. These are selected budgets, not claims that one size or effort level is universally optimal.

Setup derives each threshold from the selected window and effective reserve, previews changes, and preserves existing values unless an overwrite is approved. `modelOverrides` inherits native capability and pricing metadata. Raising a window may cross that route's long-context pricing tier; inspect the effective model rather than assuming direct OpenAI, Codex, and gateway routes share limits or billing. Custom provider definitions remain user-managed.

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
# Start a fresh Pi process, then:
/fitch-setup
```

The setup prompt reads [`setup-manifest.json`](../setup-manifest.json), checks model routes through the running session's `fitch_setup_models` tool, shows one preview, and installs only the selected unpinned sources. A new Pi CLI invocation for model listing would run startup migrations before printing results, so verification does not use one. Upgrades normalize filtered, pinned, or duplicate kit entries to one canonical unfiltered source. The prompt offers the safe settings keys and the context-window overrides as separate consent steps, preserves unrelated configuration, stops on the first failed command with completed and remaining steps, and verifies loaded resources in a fresh Pi process after extension-code or dependency changes. `/reload` refreshes settings and non-code resources; it does not activate new extension code on Pi 0.87. A new conversation in the same process is insufficient. Use native `/restart` on a supporting fork, or quit and relaunch the saved session.

`/fitch-setup verify` is read-only. It reports drift in package identity and filters, profiles, extensions, prompts, skills, current-session model availability (including whether project resources are trusted), consent-gated route state, and `models.json` context-window overrides.

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

Extension packages use bare Git or npm sources. The separate Agent Browser CLI version matches the wrapper's recommended baseline.

Consequential external writes, production actions, account changes, and merges still require explicit authorization.

## From this setup to an organization harness

The current stack already proves the reusable substrate:

- multiple model providers with per-role routing and fallback;
- independent extension packages, with narrow native APIs for runtime facts;
- bounded multi-agent execution, worktrees, review loops, and local session coordination;
- authenticated access to planning, conversation, support, knowledge, and observability systems;
- Git-backed policy, skills, profiles, and updateable package sources;
- durable local sessions, browser automation, and a clear permission boundary.

A product layer would add central provisioning, SSO, policy distribution, scoped credential brokerage, audit and cost visibility, managed local/cloud execution, and multi-user controls. Those concerns belong above the reusable Pi primitives, not inside every extension.

That is why this repository is useful beyond copying one setup: it is a running reference implementation of the composition layer an organization harness needs.
