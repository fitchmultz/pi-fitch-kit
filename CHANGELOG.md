# Changelog

## 0.2.1 — 3 August 2026

- Made tagged releases explicit known-good setup snapshots instead of claiming continuous parity with the live installation.
- Reconciled the current agent profiles: replace-mode system prompts, Luna fallbacks for `scout`, and Sol routing for `reviewer-security`.
- Pinned the documented install path to `v0.2.1`.

## Live-setup rescan — 1 August 2026

- Added `pi-change-working-dir` to the manifest core packages and the guide's tool set.
- Removed the nested-instruction extension from the guide and the `/fitch-setup` local-equivalents offer; it is disabled in the live setup.
- Marked PR Hawk as currently disabled; noted `propose-then-ship` is excluded in favor of its pi port.
- Docs continue to state Opus 5 max as the default main model; a Fable 5 trial is an experiment, not the documented default.

## Shareable kit: pinned setup path plus current bench — 1 August 2026

- Rebuilt the installer path on the live package instead of the pre-symlink layout: `setup-manifest.json` (schema 2) pins every core package to an exact npm version or commit, lists required and optional model routes, and points at the kit's own `sync-agents` extension instead of a separate sync script.
- Rewrote `/fitch-setup` against the manifest: 14 profiles, current model mapping, `~/.agents/skills` preservation, `apply_edits` verification, explicit trust choices, and the same credential and preview boundaries as before.
- Restored `templates/working-agreement.md` with managed markers; renamed the optional block from WorkOS process to plain process and made its worktree rule repository-neutral.
- Model changes: `debugger` and `planner` moved to `openai-codex/gpt-5.6-sol` (Fable 5 first fallback, duplicate primary dropped from their chains); `reviewer-claude`, `ui-designer`, and the new `reviewer-security` lead with `anthropic/claude-fable-5`; `reviewer-gpt` and `ui-designer` run xhigh; `anthropic/claude-opus-5` at max is the default main-session model.
- Added `reviewer-security`, a fresh-context security and data-safety reviewer.
- Extended `npm run check` to fail on drift between the manifest, agent frontmatter models, kit resources, package pins, and the setup prompt; restored `npm run smoke` as an SDK package-load check on pi 0.83.0.
- Refreshed both guides for pi 0.83.0 and the current bench, and rewrote the README around the copy-this-setup path (`pi install git:github.com/fitchmultz/pi-fitch-kit` then `/fitch-setup`).
- Restored the MIT LICENSE and public repository metadata in `package.json`.

## Single-reviewer default gate — 26 July 2026

- Made `reviewer-gpt` the default review gate. `reviewer-claude` is no longer required on every gate and joins only when a change warrants cross-model coverage.
- Kept `/hard-review` as the explicit dual-reviewer command, so the Claude cross-model challenge is still one command away rather than removed.
- Updated `orchestrate` phase 7, the `orchestrate` agent roster, and `fix-issues` step 5, which all hard-coded launching both reviewers and tracking both run IDs.
- Replaced the stale "remediate every finding, including maintainability, naming, and polish" wording in `orchestrate` and `fix-issues` with the blocking-first disposition rule, since those two prompts still carried the churn-inducing bar that the reviewer profiles had already moved past.

## Convergent reviewer loop — 26 July 2026

- Gave every finding a `blocks|fix-if-cheap|follow-up` disposition alongside its severity in `reviewer`, `reviewer-gpt`, and `reviewer-claude`. The four-level severity scale was previously decorative because any finding at any level blocked acceptance, which made the review loop non-terminating on large diffs.
- Changed the acceptance sentinel from `No findings. Everything I checked is acceptable.` to `No blocking findings.`, so non-blocking items are still reported without holding up a shippable change.
- Kept detection strict. Reviewers apply judgment to a finding's disposition, never to whether it gets reported, and may not mark maintainership, structure, naming, or size concerns as blocking on preference alone.
- Told reviewers not to re-report findings the brief records as already declined. Fresh context meant every rerun re-litigated tradeoffs that had been consciously accepted in an earlier round.
- Left `ui-designer` and the `hard-review` prompt on the original sentinel; they are separate review surfaces, not part of the PR gate loop.

## Agent routing refresh on CursorBench 3.2 — 26 July 2026

- Promoted `debugger` and `planner` to `anthropic/claude-opus-5` at high effort, where Opus 5 scores 66.7% for $3.91/task against GPT-5.6 Sol high's 60.4% for $2.28. Diagnosis and planning errors propagate into downstream work, so the extra cost buys the most there. Both keep Fable 5 as a same-provider model-level fallback and their former Sol primary as the cross-provider fallback.
- Replaced the `anthropic/claude-fable-5` fallback with `anthropic/claude-opus-5` for `fixer`, `researcher`, and `ui-designer`, since Opus 5 wins on both score and cost at every effort level these overrides use.
- Gave `oracle` its first fallback, `cursor/gpt-5.6-sol@272k`. It was the only override with no fallback at all, and its fork context rules out an Anthropic route.
- Added `cursor/gpt-5.6-sol@272k` ahead of `openai-codex/gpt-5.6-terra` for `reviewer` and `reviewer-gpt`, so a Codex provider failure reaches the same Sol quality through a different provider before dropping to Terra.
- Added `xai/grok-4.5` as a third fallback for `reviewer-claude`, whose chain was previously Anthropic-only and could not survive a provider-level Anthropic failure.
- Left `scout`, `context-builder`, `worker`, and `writer` unchanged. Grok stays primary in the fast/value roles because it matches Opus 5 high's score at roughly a third of the cost, and Fable 5 keeps the writing role on Artificial Analysis writing evidence.
- Clarified that the Anthropic provider is environment-specific: the work machine uses Pi's `anthropic` provider and the personal machine uses `claude-code`. Only the `claude-code` route carries the fork-transcript restriction, and the README no longer claims otherwise.

## Model reference sheet refresh — 26 July 2026

- Refreshed the model reference sheet from the live CursorBench 3.2 leaderboard and renamed both files to `Model_Reference_Sheet_Artificial_Analysis_2026-07-26.{pdf,docx}`.
- Recorded the leaderboard growing from 42 to 50 entries: Claude Opus 5 at five effort levels and Gemini 3.6 Flash at three. No previously recorded score, cost, token, or step value changed.
- Added a refresh page covering what the new entries change, and rewrote the routing guide, cross-benchmark synthesis, and recommendation tables around Opus 5.
- Established Opus 5 as the preferred Anthropic route: it beats Fable 5 on both score and cost at low, high, and extra high effort, and Opus 5 high reaches 66.7% at $3.91, matching Grok 4.5 high without the contamination caveat and beating GPT-5.6 Sol extra high by 2.2 points at the same cost.
- Kept Fable 5 as the `writer` primary because it leads the separate Artificial Analysis writing benchmark, which CursorBench does not measure.
- Noted that Claude Opus 4.8 and Sonnet 5 are fully superseded, and that neither Opus 5 nor Gemini 3.6 Flash has any Artificial Analysis coverage, so their entries are CursorBench-only evidence.
- Corrected stale routing documentation: `reviewer-claude` is `anthropic/claude-opus-5` with a Fable 5 fallback (the setup guide had these reversed), and `worker`'s last fallback is `anthropic/claude-opus-5` rather than Fable 5.

## Current setup documentation

- Refreshed the guides for Pi 0.82.0, the current optional review policy, project-trust behavior, active skill catalog, Macuse, Cursor SDK, Codex priority and compaction, and `pi-apply-edits` as the default file-mutation tool.
- Removed stale mandatory-review, child-trust, repository-visibility, package, and setup-version claims.

## Agent routing and specialist profiles

- Routed `scout`, `context-builder`, `fixer`, and `worker` through Pi's built-in `xai/grok-4.5` at high effort, with `cursor/grok-4.5` and GPT-5.6 Sol fallbacks, for much faster bounded delegation without giving up the parent's quality gate.
- Discounted Grok's exact CursorBench rank because of Cursor's disclosed contamination while retaining the independent Artificial Analysis speed/value evidence; Sol and Fable remain the final quality gates.
- Tuned effort by role: high for Grok-backed and routine specialist work, and xhigh for consequential research, both reviewer gates, and oracle decisions.
- Added read-only `debugger` and human-facing `writer` profiles.
- Reworked model-facing instructions to describe the job and evidence contract instead of narrating model configuration.
- Added the 18 July 2026 Artificial Analysis and CursorBench 3.2 model reference sheet in PDF and DOCX formats.

## Prompt renames — cutover to package-backed slash commands

This repo is the new source of truth for the renamed prompt set:

- `QA-QC.md` -> `manual-qa.md`
- `double-check.md` -> `fresh-review.md`
- `mini-gated-escalation.md` -> `triage-first.md`
- `remediate-findings.md` -> `resolve-findings.md`
- `task-execution.md` -> `run-to-completion.md`

The legacy prompt files were moved out of `~/.pi/agent/prompts/` and backed up under `~/.pi/agent/prompt-backups/` during cutover so only the new package-backed slash commands remain active.
