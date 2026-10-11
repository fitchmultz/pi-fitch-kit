# pi-fitch-kit

This is my [Pi](https://github.com/earendil-works/pi) setup, packaged so you can use it too. It gives you my everyday session tools and a guided way to choose extensions, specialist agents, skills, and service connections for your own coding workflow.

![The Fitch kit loads bundled tools into your main Pi session, which uses selected public extensions, task-specific skills, and optional authenticated MCP services.](.github/readme/kit-overview.png)

*The kit adds tools to your main Pi session; `/fitch-setup` helps you choose the rest.*

## Install and start

You need **Node.js 24.15+** and **Pi 1.0.0+**. The kit works with official Pi and [Fitch's Pi runtime](https://github.com/fitchmultz/pi).

If you already use Pi, install the kit:

```bash
pi install git:github.com/fitchmultz/pi-fitch-kit
```

Start a fresh Pi process, then run this in Pi's editor:

```text
/fitch-setup
```

When setup finishes, start another fresh Pi process if it installed extensions, then run `/fitch-setup verify` to check the result.

`/fitch-setup` walks through setup with your main agent. You'll see the package installs and file changes before they're applied, and you can choose the full core setup or individual components. `verify` checks your setup without changing anything. See the [setup reference](docs/reference.md#install-the-kit) for model requirements and migration details.

**New to Pi?** Install it with `npm install -g --ignore-scripts @earendil-works/pi-coding-agent`, launch `pi`, and complete your provider login before installing the kit.

Setup needs an available route from each [required model group](setup-manifest.json): Astra through OpenAI/Codex, and Claude through a supported route. Optional services need your own accounts and authentication. The kit is installed from Git; it is not published to npm.

## Try the bundled tools

The kit includes seven extensions, two prompt templates, and the `calm` theme. These load with the package; the wider extension stack is selected during setup.

| Try this in Pi | What happens |
|---|---|
| `/draft Explain why the test flakes and fix the cause` | Rewrites your request in a separate dialog. Review it, copy it, tweak it, or accept it into the conversation. |
| `/side-question What does this error mean?` | Answers using the session context in a separate dialog, without sending a new message to the main agent. |
| `/reader demo` | Opens a sample paged explanation without a model call. Right/Space advances, Left goes back, Escape closes. |
| `/reader` or `/reader list` | Reopens your saved reading place or browses earlier documents. Press `N` to write a section note; Ctrl+Enter asks the main agent to respond. |
| `/clean-footer` | Switches between the compact and built-in footers. The compact footer keeps context, model, session name, and extension status visible. |
| `/codex-fast status`, `/anthropic-fast status`, `/xai-fast status` | Checks the shared fast-mode settings. Read the cost and route limits before enabling them. |
| `/github-open-issues-prs` | Starts the bundled prompt for auditing open GitHub issues and pull requests. |

Session naming keeps `/resume` searchable. The Claude image guard adapts Claude-bound images to provider limits while preserving source detail for other models when global auto-resize is off. The setup model tool checks the running session's model registry without opening credential files or calling a provider.

Both writer commands use your current provider, model, and thinking level and make model calls. [Writer overrides](docs/reference.md#draft-provider-model-and-thinking), [reader controls and recovery](docs/reference.md#extensions-bundled-by-this-kit), and [image limits](docs/reference.md#why-the-image-guard-exists) are documented in the reference.

### Fast modes and cost

Fast modes are optional. Installing or updating the kit never selects Ultrafast or changes your default model routes.

- OpenAI priority: `/codex-fast on`; `/codex-fast off` disables the shared kit tier.
- OpenAI Ultrafast: `/ultrafast on` changes the shared mode; add `--session` for a session override. `/ultrafast reset --session` returns to the shared setting.
- Anthropic and xAI: `/anthropic-fast on` and `/xai-fast on` request their supported fast/priority modes.

**These modes can cost more.** Anthropic's supported Opus fast mode is a research preview with doubled token rates. Ultrafast is limited to exact `gpt-6-astra` on supported native OpenAI/Codex routes, with 6× API/credit pricing or 8× Codex included usage and specific access requirements. Footer labels show requested policy; provider billing is authoritative. See the [full fast-mode reference](docs/reference.md#fast-modes) before opting in.

## What setup adds

I keep the larger setup in separate public packages. `/fitch-setup` offers the packages in the [setup manifest](setup-manifest.json), and you can also install each one on its own.

| Add this capability | Project |
|---|---|
| Parallel specialists, isolated worktrees, and local session coordination | [pi-subagents](https://github.com/fitchmultz/pi-subagents) |
| Reliable file edits and previews | [pi-apply-edits](https://github.com/fitchmultz/pi-apply-edits) |
| Searchable access to configured MCP services | [pi-mcp-adapter](https://github.com/fitchmultz/pi-mcp-adapter) |
| Browser automation, screenshots, and product QA | [pi-agent-browser-native](https://github.com/fitchmultz/pi-agent-browser-native) |
| Task-specific procedures for debugging, QA, diagrams, and review | [pi-agent-skills](https://github.com/fitchmultz/pi-agent-skills) |
| A focus on small, useful implementations | [ponytail](https://github.com/fitchmultz/ponytail) |

The wider stack includes structured questions, persistent todos, working-directory changes, a calculator, context inspection, verbosity, timing, session editing, draft stash, and message copy. Browse the [complete extension catalog](docs/reference.md#enabled-extensions), [specialist profiles](docs/reference.md#subagent-bench), and [skill catalog](docs/reference.md#active-skills).

MCP connections can bring GitHub, Linear, Slack, Cloudflare, Sentry, Datadog, Plain, Notion, Granola, or your organization's gateway into the coding workflow. Connections are optional and user-authenticated; setup does not provide service access. [Connection and trust details](docs/reference.md#connected-mcp-services) explain the boundaries.

[macuse](https://github.com/fitchmultz/macuse) is an experimental macOS add-on outside the core setup. It relies on private interfaces in ChatGPT's Computer Use runtime, which OpenAI can change without notice.

## Settings and safety

Read the [settings example](examples/settings.json) before adopting it. Setup offers its keys separately, including image resizing and context-window budgets, and keeps existing choices unless you select a change. Compact view and integration instruction discovery need a Pi runtime that supports them; the kit doesn't patch or replace Pi to enable them.

Extensions run with your operating-system permissions. Project trust and a working agreement aren't a sandbox, so choose trust settings for your environment. Your credentials, OAuth state, private endpoints, browser profiles, and raw sessions stay with you; the kit doesn't include or copy them.

After setup changes extension code or dependencies, start a fresh Pi process. Use `/reload` for settings and non-code resources.

## Go deeper

- [Configuration and workflow reference](docs/reference.md): exact commands, package channels, runtime behavior, migration notes, and full catalogs.
- [How I actually use Pi](docs/pi-setup.md): a substantial task from connected context through implementation and delivery.
- [Short setup overview](docs/pi-setup-post.md): the reasoning behind the composition.
- [Development and validation](docs/development.md): local checks, regression commands, and CI host qualification.
- [Changelog](CHANGELOG.md): version history.

## License

[MIT](LICENSE).
