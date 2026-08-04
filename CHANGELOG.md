# Changelog

## 0.2.4

- Added an `anthropic-fast:on|off` footer indicator, matching the one in pi-codex-context. It appears only on Opus 5 and Opus 4.8, is colored by state, and clears on every other model, so the footer never claims fast mode where it does nothing.
- The footer watches the shared state file every 5 seconds, so a session picks up a toggle made in another session rather than showing stale state. Toggling inside a session updates its own footer immediately, so the poll only covers cross-session changes and does not need to be fast.

## 0.2.3 — 4 August 2026

- Verified against the live Claude subscription OAuth route on 4 August 2026: `speed: "fast"` and the beta header are both server-validated, the request is accepted, and identical output returned in 4.8s against 9.5s with fast mode off. Reported cost still doubles, which tracks Anthropic's metered pricing exactly for API-key routes and stands in as a premium-usage signal on subscription auth, where Pi's cost figures are notional.
- Added `/anthropic-fast [on|off]` to the Anthropic extension: off by default, persisted in the Pi agent directory, and limited to Opus 5 and Opus 4.8 because fast mode is Opus-only and bills double per token. Reported cost rates double with it so session totals match Anthropic's premium billing.
- Documented the accepted caveat: this override owns Anthropic streaming while loaded, so it should not be combined with another Anthropic provider override unreviewed, Pi should be restarted rather than reloaded after disabling or removing it, and it should be revalidated on each Pi upgrade.
- Pi's provider composer collapses full and simple stream calls into a single extension callback and drops the provenance, so the extension classifies full-stream callers by their Anthropic-native options and leaves everything else on the simple path. Requests that supply their own `client` bypass `options.fetch` in pi-ai and therefore stay at standard speed rather than risk `speed: "fast"` without its required beta header.

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
