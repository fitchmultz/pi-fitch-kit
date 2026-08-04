# Changelog

## 0.2.2 — 4 August 2026

- Reorganized the public documentation around the active stack: linked extensions, the fourteen-agent bench, directly linked source-managed skills including `diagram-creation`, and authenticated MCP capabilities.
- Reconciled the release manifest with the currently loaded public packages, removed inactive routes, and made every extension install source unpinned.
- Made consolidated `pi-subagents` the sole source for the fourteen specialist profiles and Intercom, then removed this kit's duplicate profiles, sync machinery, and standalone Intercom package.
- Registered only `/fitch-setup` and `/github-open-issues-prs`; retained the rest of the prompt files as unloaded source material.
- Bundled the Anthropic image guard and a safe settings example so full-resolution image handling is reproducible without sharing private configuration; bounded source decoding and added success, failure, and oversize smoke coverage.
- Kept the released Agent Browser wrapper paired with its tested 0.33.0 CLI baseline instead of holding the kit release on an unreleased wrapper update; the CLI keeps the Node.js floor at 24.
- Removed the inactive Cursor model fallbacks from the public agent profiles.
- Added GitHub to the authenticated MCP catalog, documented optional MCP scripting as trusted local execution, prevented setup from persisting mutable npm package tags, and switched to the secured public MCP fork containing the UI capability-isolation fix.
- Made cross-provider custom compaction separately disclosed and consent-gated, with xAI and OpenAI Codex destinations recorded explicitly in the manifest.
- Switched `pi-edit-session-in-place` to its public Git source after removing the stale Node engine ceiling.
- Updated `deslop` to simplify ceremonial test tables while retaining malformed-input coverage at real trust boundaries.
- Documented Macuse as a linked, selective experimental extension for native macOS automation.
- Reframed the kit as a working composition-layer reference for a model-agnostic organization harness.

## 0.2.1 — 3 August 2026

- Made tagged releases explicit known-good setup snapshots instead of claiming continuous parity with the live installation.
- Reconciled replace-mode agent profiles, Luna fallbacks for `scout`, and Sol routing for `reviewer-security`.
- Pinned the documented install path to `v0.2.1`.

## Earlier history

Earlier prompt, routing, and package experiments remain available in Git history. The active public surface is documented by the latest tagged release.
