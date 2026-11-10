---
description: Install or verify the Fitch Pi setup
argument-hint: "[verify]"
---

Run the Fitch Pi setup in `${1:-setup}` mode. Lead it as an ordinary session task: inspect, ask only for choices not already supplied, show one preview, apply, verify.

## Rules

1. Find this prompt's installed `@fitch/pi-kit` package root from Pi's package and resource information. `<package-root>/setup-manifest.json` is the source of truth for packages, model routes, and bundled resources. Read the installed Pi documentation for packages, settings, and models before you change anything.
2. Install only sources listed in the manifest, exactly as written, with `pi install <source> --no-approve`. Do not add a ref or version, and do not substitute a different package or model.
3. Do not read or copy authentication files, credential stores, browser profiles, saved sessions, or private endpoints. Provider and service login belongs to the user.
4. Make no service writes, commits, pushes, deployments, or account changes.
5. Preserve everything you were not asked to change. Merge only the selected JSON keys, and never print a whole configuration file. If a file is malformed or a path holds something unexpected, stop and ask.

## Inspect

Resolve `<Pi agent dir>` once as `${PI_CODING_AGENT_DIR:-$HOME/.pi/agent}`.

- Run `node --version`, `pi --version`, and `pi list --no-approve`. Compare the running Node and Pi versions with the manifest's `runtime` minimums. A version you cannot establish is unverified, not passing.
- Each package states its own Node and Pi minimums in its README; some are stricter than the kit's. Check them for the packages in scope. If the host is too old, report the required upgrade and stop before any write. Setup does not upgrade Node or Pi.
- Call `fitch_setup_models` with every key of the manifest's `modelContextWindows`. The result describes the running session, which can include routes from a trusted project. If the tool is unavailable, report model availability as unverified. Do not start another Pi process to list models: its startup migrations can change files.
- A package already installed from npm or from Git counts as installed. Pi treats the two channels as different packages, so keep the existing channel and never install a second copy.

## Choose

Skip this section in `verify` mode. Reuse choices already given and ask only for the rest:

1. **Packages.** Complete core means every `corePackages` entry. Otherwise let the user pick; show each entry's `id` and `provides`. Offer each `optionalPackages` entry separately, and only on its `platform`.
2. **Working agreement.** The baseline block, the process block, both, or neither, from `<package-root>/templates/working-agreement.md`.
3. **Settings.** Each key in `<package-root>/examples/settings.json` is a separate, optional choice. Explain the non-obvious ones:
   - `enabledModels` and the default model: offer only routes the session reports as available. If the example's default route is unavailable, ask which available route to use.
   - `images.autoResize: false` sends source images at full detail. The kit's image guard still resizes images sent to Claude.
   - `compaction` sets the reserve and the recent tail. With Posthorse installed, the same values set where context rolls over.
   - `defaultTools` turns on Pi's built-in `codemode`, `tool_search`, `grep`, `find`, and `ls`.
   - `extensions: ["-builtin:mcp"]` applies only with the MCP adapter installed. The adapter replaces Pi's built-in MCP support, and Pi reports that in a startup warning until the built-in is turned off. Add the entry to an existing `extensions` list; do not replace the list.
   - `compactView` exists only on a Pi that documents it. Skip it elsewhere.
4. **Context windows.** For each available route in `modelContextWindows`, whether to merge `providers.<provider>.modelOverrides.<model-id>.contextWindow` into `<Pi agent dir>/models.json`. Show the existing and proposed value for each route, and point out when the new window crosses a long-context price tier in that route's pricing. A route with a different existing value needs an explicit keep-or-overwrite answer. Leave a full `models[]` definition for the same route unchanged and report it, because it replaces the native model and the override would not apply.
5. **Project trust.** Explain Pi's `defaultProjectTrust` setting and its tradeoffs. Do not copy another person's trust setting.

## Preview and apply

Before any install or write, show one preview that lists:

- every `pi install <source> --no-approve` command;
- every `pi remove <source>` command for a listed source that matches `retiredPackageSources` in any ref or URL form, to run after its replacement is installed. Removal leaves that package's saved state in place;
- a kit entry that is duplicated or pinned, with the one removal and one reinstall of `kit.installSource` that fixes it. Resource filters on the kit entry are the user's choice: keep them;
- for a package with an `externalPrerequisite`, the commands its linked instructions give for that command-line tool;
- every file that changes, and whether it is created or merged;
- the selected settings keys and context windows, with any values they replace;
- which changes need a new Pi process.

Proceed when the choices cover everything in the preview. Ask about anything they do not cover.

Apply the steps in order and stop at the first failure. Inspect the error and the resulting state before you continue, and do not repeat a step whose outcome is unknown. If you cannot recover, report the completed steps, the failed step, the remaining steps, and what is needed to resume.

Merge a selected working-agreement block into `<Pi agent dir>/AGENTS.md` by its managed markers. Update an existing complete block in place, keep all other text, and never add an unselected block. Stop on partial, duplicated, or nested markers.

The MCP adapter installs without servers. Server configuration and login follow the adapter's own documentation and belong to the user. Do not add servers, infer endpoints, or read service data.

Setup never changes fast-mode state: the `*-fast.json` files in `<Pi agent dir>` and any session override stay as they are.

After installing or removing a package, the user must start a new Pi process before verification. Quit and relaunch Pi, or use `/restart` where the host provides it. A new conversation in the same process does not load new extension code. Settings-only changes need `/reload`.

## Verify

In `verify` mode, make no changes, installs, downloads, or logins. Check the packages the user named, or complete core when they named none.

In either mode, verification is read-only and happens after the required new process or reload. Report:

- each package in scope: installed or missing, and from which channel;
- any installed source listed in `retiredPackageSources`;
- whether the kit's bundled extensions, prompts, and theme loaded, and any resource filter that hides one;
- for each installed package, whether the tools or commands its README documents are registered;
- model route availability, and the context-window overrides compared with the manifest;
- the selected settings keys compared with the example. A different or absent value is information, not a failure.

Use only harmless checks: version output, package and resource listings, tool presence, and a deterministic calculation. Open a browser page only when the browser package was selected, and only a page that needs no login. Make no provider calls and no service reads. If a capability has no harmless check, list it as a manual step.

Finish with the selected components, installed sources, changed and skipped paths, model results, check results, whether a new process or reload is still needed, and the remaining manual steps, such as provider login, MCP server configuration, and browser setup. Do not report success for anything skipped or unverified.
