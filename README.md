# pi-fitch-kit

Opinionated public-core package for the Pi workflow Mitch Fultz uses: one accountable main session, fresh specialists for bounded context/research/review, exact model routing, and evidence before completion.

> **Release status:** public Git package at `https://github.com/fitchmultz/pi-fitch-kit`. This revision is awaiting its immutable bootstrap pin. The npm package remains `private: true` to prevent accidental registry publication.

## Workflow

The main Pi session owns the task. It gathers connected context, maps the code, decides and usually implements, validates the real behavior, reviews specialist output, and reports the result. Subagents are optional focused help, not an autonomous scout-to-worker pipeline:

- `scout`, `researcher`, and `context-builder` gather bounded evidence.
- `debugger` proves root causes before remediation.
- `worker` and `fixer` handle isolated implementation or confirmed repair lists.
- `reviewer`, `reviewer-gpt`, and `reviewer-claude` provide fresh independent review.
- `planner`, `oracle`, and `ui-designer` cover broad decomposition, inherited-decision checks, and rendered product review.
- `writer` handles human-facing documentation, guides, announcements, and polished copy.

## Package resources

Pi loads exactly:

- `extensions/nested-agents.ts`, which live-loads `<cwd>/.pi/agent/AGENTS.md` only after the project contains another Pi-recognized trust-gated resource and the user trusts it;
- `extensions/calculator/index.ts`, the deterministic, bounded 40-digit calculator;
- `prompts/fitch-setup.md`, exposed as `/fitch-setup`.

The package also includes `scripts/sync-agents.mjs`. `/fitch-setup` runs it once, after preview and approval, to add missing profile symlinks. It never replaces or deletes an existing file or symlink, so concurrent setup runs are harmless. Its report separates newly created, unchanged, and skipped paths.

The 13 profile files remain canonical under `agents/`:

| Profile | Primary | Fallback | Thinking | Context |
|---|---|---|---|---|
| `scout` | `openai-codex/gpt-5.6-sol` | none | medium | fresh |
| `context-builder` | `openai-codex/gpt-5.6-sol` | none | medium | fresh |
| `debugger` | `openai-codex/gpt-5.6-sol` | `anthropic/claude-fable-5` | high | fresh |
| `researcher` | `openai-codex/gpt-5.6-sol` | `anthropic/claude-fable-5` | xhigh | fresh |
| `planner` | `openai-codex/gpt-5.6-sol` | `anthropic/claude-fable-5` | high | fresh |
| `worker` | `openai-codex/gpt-5.6-sol` | `anthropic/claude-fable-5` | high | fresh |
| `fixer` | `openai-codex/gpt-5.6-sol` | `anthropic/claude-fable-5` | medium | fresh |
| `reviewer` | `openai-codex/gpt-5.6-sol` | `openai-codex/gpt-5.6-terra` | high | fresh |
| `reviewer-gpt` | `openai-codex/gpt-5.6-sol` | `openai-codex/gpt-5.6-terra` | xhigh | fresh |
| `reviewer-claude` | `anthropic/claude-fable-5` | `anthropic/claude-opus-4-8` | xhigh | fresh |
| `oracle` | `openai-codex/gpt-5.6-sol` | none | xhigh | fork |
| `ui-designer` | `openai-codex/gpt-5.6-sol` | `anthropic/claude-fable-5` | high | fresh |
| `writer` | `anthropic/claude-fable-5` | `anthropic/claude-opus-4-8` | high | fresh |

Frontmatter owns runtime policy. Each model-facing body stays focused on the role's work, evidence standard, boundaries, and output rather than explaining model or launch configuration. All 13 profiles remain leaf agents.

The older files under `prompts/audit`, `prompts/execute`, `prompts/qa`, and `prompts/review` remain tracked historical workflow sources. They are not package resources and are not loaded by default.

`setup-manifest.json` is the setup authority for Pi 0.80.10, Node 24+, required models, exact external package sources, optional Cursor support, Agent Browser's external runtime, and setup choices. Third-party Pi packages are installed from those pins rather than vendored here.

## Setup

Requirements:

1. Node.js 24 or newer.
2. Pi exactly 0.80.10.
3. Exact access to `openai-codex/gpt-5.6-sol`, `openai-codex/gpt-5.6-terra`, `anthropic/claude-fable-5`, and `anthropic/claude-opus-4-8`. Setup stops rather than substitutes.
4. User-owned provider authentication through Pi's documented login flows. Cursor and WorkOS integrations are optional.

For development from a reviewed checkout:

```bash
npm install
pi install /absolute/path/to/pi-fitch-kit
```

Run `/reload` or start a fresh Pi session, then invoke `/fitch-setup` (or `/fitch-setup verify`). Profile links are not created until the setup preview is approved. Existing files and symlinks are skipped and reported, never overwritten.

### Public bootstrap

Paste this into Pi. It installs the immutable reviewed package commit rather than a branch or tag. The setup manifest deliberately does not try to pin the package to itself because a Git commit cannot contain its own hash:

```text
Read the active Pi package, prompt, extension, settings, security, and model documentation. Run exactly `pi install git:github.com/fitchmultz/pi-fitch-kit@__PUBLIC_COMMIT_REQUIRED_BEFORE_RELEASE__ --no-approve` to install the kit; do not substitute a branch, tag, package, version, or model. Do not read credentials, auth stores, browser profiles, raw sessions, or service payloads. Preview every command and changed path, preserve unrelated configuration, and stop on malformed/conflicting configuration. After installation, tell me to run /reload, then use /fitch-setup for the preview-first setup.
```

This pasteable prompt plus `/fitch-setup` is the bootstrap. There is no runtime bootstrap command or wizard framework.

## Setup behavior

`/fitch-setup` reads the manifest, inspects non-secret state, and offers complete core or component selection. It asks separately about Cursor, WorkOS service integrations, baseline working-agreement rules, and optional WorkOS process rules. Before applying anything it previews every exact package command, model mapping, path, merge, symlink, and reload requirement.

Configuration is merged narrowly. Managed working-agreement blocks update in place without replacing unrelated `AGENTS.md` content. Malformed JSON, broken markers, conflicting files, or missing exact models stop for a user decision. The global `agent-browser@0.32.0` prerequisite and its runtime download always require separate approval. Verification uses harmless local/read-only smokes and never service writes.

## Security

Pi packages and extensions run with the user's full permissions. Review this package and every pinned dependency before installation. Project trust is an input-loading gate, not a sandbox. Because `.pi/agent/AGENTS.md` does not itself trigger Pi's trust flow, nested instructions load only when the project already contains another Pi-recognized trust-gated resource and the effective trust decision is true.

This repository must not contain or inspect authentication files, tokens, private endpoints, browser profiles, raw Pi sessions, generated model caches, or copied service responses. Each user authenticates their own providers and integrations. Consequential external actions still require explicit authorization.

## Validation

```bash
npm run check
npm pack --dry-run --json >/tmp/pi-fitch-kit-pack.json
node -e "const p=require('/tmp/pi-fitch-kit-pack.json'); if(!p[0] || p[0].error) process.exit(1)"
```

`npm run check` type-checks against Pi 0.80.10, runs the calculator check, validates resources, profiles/models, immutable pins, add-only concurrent profile linking, trusted live nested instructions, and setup/working-agreement contracts, then loads the package in an isolated Pi resource loader to prove that exactly two extensions and `/fitch-setup` are discovered.

For runtime-facing edits, install the reviewed checkout in Pi and use `/reload` or a fresh session before harmless runtime verification.

## License

MIT
