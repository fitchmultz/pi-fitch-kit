# Changelog

## 0.1.0 - Unreleased

- Targeted and validated Pi 0.80.10 with Node 24 or newer.
- Aligned `oracle`, `reviewer-claude`, and `reviewer-gpt` with the active WorkOS `high` effort defaults.
- Reframed the package around one accountable main Pi session with fresh specialist agents for bounded scouting, research, implementation, and review.
- Added a version-pinned setup manifest and the preview-first `/fitch-setup` prompt.
- Added the bounded deterministic calculator and nested project instructions guarded by Pi's real project-trust boundary.
- Kept all eleven agent profiles while removing the older workflow prompt collection from default package loading.
- Moved profile linking out of session startup into one add-only setup script that is safe under concurrent runs, never replaces or deletes existing targets, and distinguishes created, unchanged, and skipped paths.
- Added a selectable working-agreement template, public Git metadata, MIT licensing, type checking, package validation, and dry-run packaging.

## Historical prompt-package phase

Before the public-core redesign, this repository loaded a larger set of package-backed workflow prompts. Those files remain in the Git history and source tree for reference, but only `/fitch-setup` is now a package resource. The older workflow prompts are not loaded by default.
