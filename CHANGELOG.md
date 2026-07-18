# Changelog

## Agent routing and specialist profiles

- Tuned effort by role: medium for bounded remediation, high for routine implementation, and xhigh for consequential research, final review gates, and oracle decisions.
- Added read-only `debugger` and human-facing `writer` profiles.
- Reworked model-facing instructions to describe the job and evidence contract instead of narrating model configuration.
- Added the 18 July 2026 Artificial Analysis model reference sheet in PDF and DOCX formats.

## Prompt renames — cutover to package-backed slash commands

This repo is the new source of truth for the renamed prompt set:

- `QA-QC.md` -> `manual-qa.md`
- `double-check.md` -> `fresh-review.md`
- `mini-gated-escalation.md` -> `triage-first.md`
- `remediate-findings.md` -> `resolve-findings.md`
- `task-execution.md` -> `run-to-completion.md`

The legacy prompt files were moved out of `~/.pi/agent/prompts/` and backed up under `~/.pi/agent/prompt-backups/` during cutover so only the new package-backed slash commands remain active.
