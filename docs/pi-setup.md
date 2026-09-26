# How I actually use Pi

_Updated 25 September 2026. The kit supports Pi 0.84.2 or newer on Node.js 24 or newer; qualified against official Pi and the maintained 0.87.1 fork. Complete core needs Pi 0.87.0 or newer because several of its packages, including `pi-apply-edits` 1.0, require it._

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
- kit boundary: a compact non-truncating footer, stable session naming, read-only in-session model status for setup, Anthropic-only image resizing, shared fast-mode toggles for Anthropic Opus, OpenAI, and xAI routes, `/draft`, `/side-question`, and in-place `/restart`, while `pi-subagents` owns its profile defaults;
- user-local only: provider definitions, agent-profile overrides, and Posthorse fresh-context windows on the supporting fork; none are copied into Complete core.

Most reusable extensions stay independent. The kit directly owns only the small runtime surfaces coupled to this harness; no external package depends on the kit.

[`macuse`](https://github.com/fitchmultz/macuse) is the experimental exception to the default stack. It adds native macOS Computer Use for tasks that cannot be handled through browser DOM or CLI tools. It runs on the Computer Use runtime installed with ChatGPT, and OpenAI can change that runtime's private interfaces without notice.

## Restarting Pi sessions

**Current managed fork (0.87.1):** the bundled CLI launches a worker and owns native `/restart` itself. The kit's execve helper remains inert in that worker; no helper socket, multi-session picker, or `/restart all` is provided there. Use the host's native `/restart` or shell-tool `pi restart`; see its `docs/restart.md` for continuation, queueing, readiness and recovery. Keep that native launcher path intact rather than bypassing it to enable the old helper. The kit's `smoke:restart -- --cases managed` checks actual same-session worker replacement without startup replay; `--cases unsupported` checks official refusal.

The remainder of this section describes the **legacy unsupervised helper**, not the current managed path. Restart requires [the Pi fork](https://github.com/fitchmultz/pi/blob/main/FORK.md) with the public `ctx.isBashRunning()`, `ctx.getPendingInputCount()` and `ctx.getPendingNextTurnCount()` APIs. Hosts without these facts, including official Pi, report restart as unavailable and refuse both default and explicit-stop requests. Installing the kit does not patch Pi.

`/restart` lists responding helper-enabled sessions. Choose one with Enter, mark several with Space, or choose All; `/restart all` skips the picker. The next choice defaults to restarting idle sessions and skipping busy ones. The initiating session goes last, and success requires a new process image confirming the exact saved file and session ID—not just an accepted request.

Busy includes agent/retry work, shell commands, compaction/tree operations, editor drafts, submitted or queued input and nextTurn context, Kit writer calls/dialogs, and owned child work. Native `isIdle()` covers agent/compaction/tree work; `isBashRunning()` covers the full Bash dispatch, including asynchronous earlier interceptors and replacement results; `getPendingInputCount()` covers prompt preparation and terminal-held input, including queues retained after tree cancellation; `getPendingNextTurnCount()` exposes context not yet saved. The helper reads these facts without observing or replacing shell execution. It asks the existing `pi-subagents` management bridge for every needed page and uses its detailed control/child state before declaring terminal-looking results idle. Completed-unreviewed history is not itself busy.

**Stop work and restart** requires confirmation. It interrupts reported owned foreground/background children through that same management bridge and waits for terminal ownership status. Native Pi's signal shutdown stops the parent's agent, shell, retry, and summary work before process replacement. Drafts, queued input/context, partial output, and unfinished writer dialogs may be discarded; this is not checkpoint-and-continue for in-flight work. A child whose stopping cannot be confirmed leaves its parent running. Unrelated parents' children are never targeted. A loaded/previously observed bridge or saved child ownership makes child status mandatory; absent `pi-subagents` is explicitly not applicable, not proof about external jobs managed elsewhere.

The replacement reuses Node's executable, Node options, Pi's CLI entry, launch cwd, and current environment. Pi's actual public parser interprets startup flags; the serializer retains restart-safe options but drops initial messages/file inputs and stale session/name selectors. It resumes the current saved file and reads current model/thinking at restart. A one-run `--api-key` stays bound to its original provider even after model switches: the new process binds that provider first, then restores the current model through Pi's public API. No argv, environment, or credentials are written to control records or the session journal.

Native session cwd and `pi-change-working-dir`'s branch-local virtual cwd remain separate. Native `--session-cwd` preserves the current native cwd independently of the saved header and launch directory. If `/tree` selected an earlier in-memory position, the helper appends one empty, inert native entry immediately before an approved actual restart to save that branch. Ordinary last-leaf restarts, listing, skips, and cancellations add no marker. Existing session and child history stays attached to the same parent ID.

Ephemeral sessions and nominated files not yet written cannot be resumed and are left unchanged. First helper activation during `/reload` reads complete native activity, including Bash and input dispatch started before the helper loaded. Recoverable launch state does not require a manual restart, but an unknown original API-key provider does. Reload of an already active helper retains the process-image identity; it never counts as a full restart.

Control uses one socket per process in a user-owned mode-0700 directory under the system temp directory, with mode-0600 sockets. `PI_FITCH_RESTART_DIR` overrides that directory for isolation or shorter socket paths. Requests can only inspect or restart the receiving process's captured session; they cannot supply executable paths, command arguments, environments, or child IDs. The helper does not scan operating-system processes or control Ghostty, and exposes no model-callable restart tool.

The supported host is the ordinary Unix Node Pi CLI on a real TTY. SDK/RPC/print hosts, Bun, native binaries, and unrecognized launchers remain inert. Exit/execve follows Pi's awaited cleanup and terminal restoration. Separately delivered external TERM/HUP cancels an armed restart; Node does not expose signal sender identity or guarantee distinct delivery of coalesced signals. Executable/CLI/session preflight catches missing paths before stopping work, but a later native exec failure can still terminate the process. Such a restart remains unconfirmed; use the saved session file to resume manually rather than an automatic restart loop. Native interrupted Bash history can also lack a useful cancellation flag, so it is never reported as successful work merely because shutdown finished.

## Model routing

[`pi-subagents/agents`](https://github.com/fitchmultz/pi-subagents/tree/main/agents) owns the specialist defaults. Primary models, ordered fallbacks, thinking levels, and context policy live in those files. The generic delegate inherits the parent model. User and project profiles take precedence and are preserved during kit setup; the setup preview shows the installed mapping rather than a copied table.

The public settings example selects `openai/gpt-6-astra` at medium reasoning; my personal main session uses `openai-codex/gpt-6-astra` instead. Updating the kit does not change that choice or replace explicit cross-family reviewer routes.

Use `modelOverrides` for intentional changes to native models. A full matching `models[]` definition replaces the native model and can hide new capabilities such as incremental system messages. Setup can preview a narrow migration while preserving deliberate context/output limits, reasoning maps, pricing, and all unrelated configuration. It never invents provider authentication or copies private endpoints.

On Pi 0.87, session naming uses the full-transcript context hook and keeps Pi's leading system message and later tool/prompt updates intact. Earlier supported hosts use the legacy path. Cache-friendly composition also requires native model capabilities and cooperating prompt extensions: a full-prompt override elsewhere can still rebuild the leading prompt.

The off-transcript `/draft` and `/side-question` writer retains tool-result screenshots while removing executable tool semantics. `/draft` Accept sends normally when idle or as native steering when busy. Each acceptance saves the draft and original input in session metadata outside model context. Run `/draft` without text to reopen the last accepted draft on the current branch after a send failure; Restore original returns the original command to the editor. Synchronous send errors keep the dialog open. Both commands inherit the active session's provider, model, and thinking level when writing starts. Optional `provider`, `model`, and `thinkingLevel` fields in `~/.pi/agent/write-prompt.json` override those values independently; omitted fields inherit. The existing `model: "provider/id"` format remains supported. Native Pi APIs resolve authentication, thinking capabilities, and output limits. Unsupported thinking levels are adjusted with a warning; malformed or unresolvable configuration stops the writer with a clear error instead of silently changing models. Main-agent verbosity hooks are not applied. See [writer configuration and examples](../README.md#draft-provider-model-and-thinking).

Native protocol async tools, live WebSocket steering, and positional reasoning updates belong to Pi's provider, agent, and session layers. They are not supplied by installing this kit. Existing background subagents continue to use their durable launch handles and completion notifications. Availability of newer native features must be checked against the selected Pi release and route.

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
