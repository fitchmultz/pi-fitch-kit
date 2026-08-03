# My Pi harness, and why it is structured this way

_Updated 3 August 2026 for Pi 0.83.0 on Node.js 24 or newer._

A few people have asked about my terminal agent setup. The public, installable version is [`pi-fitch-kit`](https://github.com/fitchmultz/pi-fitch-kit).

I use [Pi](https://github.com/badlogic/pi-mono), a small terminal coding agent, as the runtime. The useful part is the composition around it:

1. public extensions for reliable tools;
2. fresh, bounded subagents with model routing;
3. task-selected skills and working agreements;
4. authenticated MCP access to the systems around the code.

The main session remains responsible for the task. This is not an autonomous swarm.

## Extensions

The normal path includes:

- [`pi-subagents`](https://github.com/fitchmultz/pi-subagents) and [`pi-intercom`](https://github.com/fitchmultz/pi-intercom) for delegated work and session coordination;
- [`pi-mcp-adapter`](https://github.com/nicobailon/pi-mcp-adapter) and [`pi-agent-browser-native`](https://github.com/fitchmultz/pi-agent-browser-native) for connected context and real browser work;
- [`pi-fff`](https://github.com/dmtrKovalenko/fff/tree/main/packages/pi-fff) and [`pi-apply-edits`](https://github.com/fitchmultz/pi-apply-edits) for repository search and reliable changes;
- small public tools for structured questions, persistent todos, session naming, working-directory changes, deterministic math, compaction, timing, verbosity, stash, session editing, and raw message copy;
- [`ponytail`](https://github.com/DietrichGebert/ponytail) to keep the code path boring and small.

The kit itself bundles one extension for the Anthropic image-provider boundary. The profiles ship directly with `pi-subagents`, so there is no second copy or sync layer.

For native macOS automation, [`macuse`](https://github.com/fitchmultz/macuse) is a selective experimental add-on. I enable it only when browser DOM and CLI tools are insufficient; Codex app updates can break its integration surface.

I keep `images.autoResize` off so agents can inspect original image detail. Anthropic has stricter inline limits, so the guard resizes only Anthropic-bound images instead of shrinking every image for every model. The exact non-secret settings subset is checked in at [`examples/settings.json`](../examples/settings.json).

## Subagents

The fourteen `pi-subagents` specialist profiles cover scouting, context assembly, debugging, research, planning, bounded implementation, focused fixes, GPT review, Claude review, security review, UI review, oracle decisions, and writing. Its general-purpose `delegate` remains available beside them.

Grok 4.5 handles fast bounded work. GPT-5.6 Sol handles diagnosis, research, planning, and the GPT review path. Claude Fable 5 supplies an independent model family for writing, UI judgment, and cross-model review, with Opus 5 behind it.

Every profile is a leaf. Almost every child starts with fresh context. The parent inspects the actual files and evidence, makes the final decision, and stays accountable for the outcome.

## Skills

[`pi-agent-skills`](https://github.com/fitchmultz/pi-agent-skills) packages the reusable operating procedures: clarification, dogfooding, handoffs, TDD, Pi extension development, end-to-end shipping, verification, and strict review. [`diagram-creation`](https://github.com/fitchmultz/pi-agent-skills/tree/main/skills/diagram-creation) adds editable D2 plus rendered SVG/PNG technical diagrams and review crops. Subagents, Intercom, the MCP adapter, and Ponytail ship their own companion skills.

Skills load only when the task matches. They provide a procedure without bloating every prompt.

## Connected context

The current MCP layer is authenticated to an internal integration gateway, Linear, two Slack workspaces, Cloudflare, Sentry, Datadog, Plain, Notion, and Granola.

That lets one session correlate repository state with planning context, conversation history, customer support, internal knowledge, meetings, and production telemetry. Each person authenticates their own access. The public kit contains no keys, private endpoints, profiles, sessions, or copied service data.

My personal runtime is fully approved. The working agreement and operator direction are policy controls, not a per-tool authorization system. A multi-user product would put stronger authorization in the surrounding identity and execution plane.

## A typical larger change

1. The parent retrieves the issue and relevant connected context.
2. FFF and, when useful, a fresh scout map the real code path.
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
- Git-backed policy, skills, profiles, and package pins;
- browser, local terminal, and connected-system workflows in one runtime.

A product layer would add centralized provisioning, policy distribution, scoped credential brokerage, audit and cost visibility, managed local/cloud execution, and multi-user controls. Those are additive control-plane concerns; the reusable substrate is already here and dogfooded.

## Install it

```bash
npm install -g --ignore-scripts @earendil-works/pi-coding-agent@0.83.0
pi
# Complete provider login, then:
pi install git:github.com/fitchmultz/pi-fitch-kit@v0.2.2
# /reload, then:
/fitch-setup
```

`/fitch-setup` reads exact package pins from [`setup-manifest.json`](../setup-manifest.json), previews every selected change, and stops for each user's own authentication. `/fitch-setup verify` reports drift without changing anything.

The [README](../README.md) is the navigation hub. The [full guide](./pi-setup.md) explains the model table, launch policy, evidence rules, usage sample, and security boundaries.
