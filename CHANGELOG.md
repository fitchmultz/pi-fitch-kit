# Changelog

## 0.1.0 - Unreleased

- Targeted and validated Pi 0.80.10 with Node 24 or newer.
- Routed `scout`, `context-builder`, and `fixer` through optional `cursor/grok-4.5` at high effort with explicit GPT-5.6 Sol fallback; consequential research, review gates, and oracle decisions remain xhigh.
- Discounted Grok's exact CursorBench rank because of Cursor's disclosed contamination while retaining the independent Artificial Analysis speed/value evidence; Sol and Fable remain the final quality gates.
- Added read-only `debugger` and human-facing `writer` profiles.
- Reworked model-facing agent bodies around role instructions and evidence contracts instead of model and launch configuration.
- Reframed the package around one accountable main Pi session with fresh specialist agents for bounded scouting, research, implementation, and review.
- Added a version-pinned setup manifest and the preview-first `/fitch-setup` prompt, including an explicit optional-model contract for Grok through `pi-cursor-sdk`.
- Added the Artificial Analysis and CursorBench 3.2 model reference sheet in PDF and DOCX formats.
- Added the bounded deterministic calculator and nested project instructions guarded by Pi's real project-trust boundary.
- Kept all thirteen agent profiles as leaves while removing the older workflow prompt collection from default package loading.
- Moved profile linking out of session startup into one add-only setup script that is safe under concurrent runs, never replaces or deletes existing targets, and distinguishes created, unchanged, and skipped paths.
- Added a selectable working-agreement template, public Git metadata, MIT licensing, type checking, package validation, and dry-run packaging.

## Historical prompt-package phase

Before the public-core redesign, this repository loaded a larger set of package-backed workflow prompts. Those files remain in the Git history and source tree for reference, but only `/fitch-setup` is now a package resource. The older workflow prompts are not loaded by default.
