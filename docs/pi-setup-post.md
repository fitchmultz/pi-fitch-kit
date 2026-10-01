# My Pi harness, and why it is structured this way

_Updated 29 September 2026 for Pi 0.87.1 or newer (official or the fork) on Node.js 24.15 or newer._

A few people have asked about my terminal agent setup. The public, installable version is [`pi-fitch-kit`](https://github.com/fitchmultz/pi-fitch-kit).

I use [Pi](https://github.com/earendil-works/pi), a small terminal coding agent, as the runtime. The useful part is the composition around it:

1. public extensions for reliable tools;
2. fresh, bounded subagents with model routing;
3. task-selected skills and working agreements;
4. authenticated MCP access to the systems around the code.

The main session remains responsible for the task. This is not an autonomous swarm. Compaction always uses the current session model.

## Extensions

The normal path includes:

- [`pi-subagents`](https://github.com/fitchmultz/pi-subagents) for delegated work and session coordination;
- [`pi-mcp-adapter`](https://github.com/fitchmultz/pi-mcp-adapter) and [`pi-agent-browser-native`](https://github.com/fitchmultz/pi-agent-browser-native) for connected context and real browser work;
- native repository search and [`pi-apply-edits`](https://github.com/fitchmultz/pi-apply-edits) for discovery and reliable changes;
- small public tools for structured questions, persistent todos, working-directory changes, deterministic math, `/ctx` context inspection, timing, verbosity, stash, session editing, and raw message copy;
- [`ponytail`](https://github.com/fitchmultz/ponytail) to keep the code path boring and small.

The kit itself bundles stable session naming, read-only model status for setup, the Claude image boundary, shared fast-mode toggles for Anthropic Opus, OpenAI, and xAI routes, `/draft`, and `/side-question`. The profiles ship directly with `pi-subagents`, so there is no second copy or sync layer.

OpenAI Ultrafast works globally by default, like Fast. `/ultrafast` means toggle; `on` selects Ultrafast, `off` disables kit OpenAI tiers, and `toggle` changes Ultrafast to off or any other shared mode to Ultrafast. Add `--session` to on/off/toggle to override only this session with Ultrafast or off; status also accepts `--session` but never writes an override. `/ultrafast reset --session` clears that override and follows the current shared setting; reset without `--session` is invalid.

A session override takes precedence until cleared and survives same-ID resume, reload, `/tree`, and compaction in native session metadata. Forks and new IDs follow the shared state without inheriting the override. Global `/fast` and `/codex-fast` changes never clear it; read-only status shows shared and effective settings, including mismatches. Local off suppresses kit priority and Ultrafast injection, not native Auto or project defaults, so it does not guarantee standard processing. OpenAI modes follow normal agent payload hooks; built-in compaction and bare nested streams retain native policy. Changes do not retier in-flight requests; the maintained 0.99.1 fork uses ordinary request boundaries.

Existing priority controls and legacy `enabled: true` state remain unchanged. `/codex-fast ultrafast` is still a global alias without `--session`; `--ultrafast` remains shared and startup-only, conflicting with `--fast`. Invalid startup leaves state unchanged, blocks interactive requests until an explicit mode-changing command resolves it, or exits headless with clear stderr and a nonzero status before paid requests. Extension-sourced input is left unchanged, not silently swallowed. Startup and restored-Ultrafast notices disclose cost and entitlement.

Activation validates exact Astra on native direct OpenAI Responses or a plan-entitled native Codex Responses route before writing either scope; gateway, other models, Completions, and other proxies remain excluded. It never switches models, credentials, or endpoints. Off and session reset work on unsupported routes. Unsupported effective Ultrafast is inactive, not downgraded to priority. Shared footer labels are `ultrafast requested/unavailable`; local labels are `session ultrafast requested/unavailable` or `session OpenAI tiers off`, describing kit policy rather than confirmed processing or billing.

[API Ultrafast](https://developers.openai.com/api/docs/guides/ultrafast-mode) is limited to global processing and US data residency, with [6× standard API pricing](https://developers.openai.com/api/docs/pricing?latest-pricing=ultrafast). [Codex access](https://learn.chatgpt.com/docs/agent-configuration/speed) requires $500 Pro or eligible Enterprise/Edu, with workspace-owner enablement for Enterprise; other self-serve plans do not qualify even with purchased credits. Codex consumes 8× included allowance or 6× purchased credits/PAYG, not a promised 8× task-speed gain. Installation never opts you in or changes setup's model policy. Native 6× estimates need a fork release containing [commit `18acca18`](https://github.com/fitchmultz/pi/commit/18acca18fbc5d38e6fcf52da01bea8be2b4f3818) and a confirmed terminal Ultrafast response for exact Astra; official Pi 0.99.1 and older can send the tier but lack this accounting change. Existing payload/provider-stream raw hooks expose requested and returned tiers without persisting tier metadata or treating absent values as confirmation. The [fast-mode reference](../README.md#fast-modes) covers the limits and existing priority baselines; no live Ultrafast measurement is claimed.

For native macOS automation, [`macuse`](https://github.com/fitchmultz/macuse) is an experimental add-on for work browser DOM and CLI tools cannot reach. It runs on the Computer Use runtime installed with ChatGPT, whose private interfaces OpenAI can change without notice.

I keep `images.autoResize` off so agents can inspect original image detail. Anthropic has stricter inline limits, so the guard resizes only Claude-bound images, on any provider route that speaks the Anthropic Messages API, instead of shrinking every image for every model. The exact non-secret settings subset is checked in at [`examples/settings.json`](../examples/settings.json).

## Subagents

The sixteen `pi-subagents` specialist profiles cover scouting, context assembly, debugging, research, planning, monitoring, bounded implementation, focused fixes, general review, GPT review, Claude review, security review, over-engineering review, UI review, oracle decisions, and writing. Its general-purpose `delegate` remains available beside them.

The owning [`pi-subagents/agents`](https://github.com/fitchmultz/pi-subagents/tree/main/agents) files define each role's models and ordered fallbacks. The kit preserves user and project overrides, including cross-family reviewers. The settings example selects Astra through a ChatGPT/Codex subscription at medium reasoning, falling back to an OpenAI API key.

Every profile is a leaf. Almost every child starts with fresh context. The parent inspects the actual files and evidence, makes the final decision, and stays accountable for the outcome.

## Skills

[`pi-agent-skills`](https://github.com/fitchmultz/pi-agent-skills) packages the reusable operating procedures: clarification, dogfooding, handoff prompts, TDD, test auditing, Pi extension development, end-to-end shipping, UX review, verification, and strict review. [`diagram-creation`](https://github.com/fitchmultz/pi-agent-skills/tree/main/skills/diagram-creation) adds editable D2 plus rendered SVG/PNG technical diagrams and review crops. Subagents, Intercom, the MCP adapter, and Ponytail ship their own companion skills.

Skills load only when the task matches. They provide a procedure without bloating every prompt.

## Connected context

The current MCP layer is authenticated to an internal integration gateway, GitHub, Linear, two Slack workspaces, Cloudflare, Sentry, Datadog, Plain, Notion, and Granola.

That lets one session correlate repository state with planning context, conversation history, customer support, internal knowledge, meetings, and production telemetry. Each person authenticates their own access. The public kit contains no keys, private endpoints, profiles, sessions, or copied service data.

My personal runtime is fully approved. The working agreement and operator direction are policy controls, not a per-tool authorization system. A multi-user product would put stronger authorization in the surrounding identity and execution plane.

## A typical larger change

1. The parent retrieves the issue and relevant connected context.
2. Native repository search and, when useful, a fresh scout map the real code path.
3. The parent makes the design decision and usually implements it.
4. Agent Browser checks browser-visible behavior when tests cannot prove it.
5. Deterministic repository checks establish current evidence.
6. A fresh reviewer tries to falsify the completion claim.
7. Any changed diff gets a new reviewer pass; previous reviewer judgment never signs off new code.
8. The parent closes the loop and performs only authorized external actions.

Small work skips the ceremony. The machinery is for changes where being wrong is expensive or independent work can reduce elapsed time.

## Why this matters beyond my setup

This is already a working composition layer for a model-agnostic organization harness:

- multiple providers and per-role routing;
- modular extensions instead of a core fork;
- bounded agents, worktrees, review loops, and durable sessions;
- per-user authenticated service access;
- Git-backed policy, skills, profiles, and updateable package sources;
- browser, local terminal, and connected-system workflows in one runtime.

A product layer would add centralized provisioning, policy distribution, scoped credential brokerage, audit and cost visibility, managed local/cloud execution, and multi-user controls. Those are additive control-plane concerns; the reusable substrate is already here and dogfooded.

## Install it

```bash
npm install -g --ignore-scripts @earendil-works/pi-coding-agent
pi
# Complete provider login, then:
pi install git:github.com/fitchmultz/pi-fitch-kit
# Start a fresh Pi process, then:
/fitch-setup
```

`/fitch-setup` reads unpinned package sources from [`setup-manifest.json`](../setup-manifest.json), normalizes duplicate or filtered kit entries, previews every selected change, and stops for each user's own authentication. `/fitch-setup verify` reports drift without changing anything.

The [README](../README.md) is the navigation hub. The [full guide](./pi-setup.md) explains model ownership, launch policy, evidence rules, usage sample, and security boundaries.
