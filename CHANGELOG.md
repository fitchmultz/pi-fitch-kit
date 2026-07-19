# Changelog

## Agent routing and specialist profiles

- Routed `scout`, `context-builder`, and `fixer` through `cursor/grok-4.5` at high effort, with explicit GPT-5.6 Sol fallback, for faster and cheaper bounded delegation.
- Discounted Grok's exact CursorBench rank because of Cursor's disclosed contamination while retaining the independent Artificial Analysis speed/value evidence; Sol and Fable remain the final quality gates.
- Tuned effort by role: high for Grok-backed and routine implementation work, and xhigh for consequential research, final review gates, and oracle decisions.
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
