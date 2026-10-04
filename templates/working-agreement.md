# Fitch Pi working-agreement template

Merge only the user-approved managed blocks into `<Pi agent dir>/AGENTS.md`, using the active directory resolved by `/fitch-setup`. Update an existing complete block in place. Never replace unrelated content. If markers are partial, duplicated, nested, or otherwise malformed, stop and ask the user how to proceed.

<!-- fitch-pi-kit:baseline:start -->
## Baseline safety and evidence

- Complete requested implementation and delivery under current or standing authority, including supporting setup, useful maintained dependencies, and relevant verification. Make ordinary reversible choices without preference interviews. Review, research, and planning requests remain read-only unless changes are also requested.
- Discover facts and reuse settled decisions before asking. Ask only for information or access the user must supply, an unresolved choice that materially changes the outcome, or an unrequested action with concrete risk of irreversible loss, private-data disclosure, or substantial new cost. Preserve enforced security and account boundaries.
- Inspect current repositories, documentation, logs, CI, and live state instead of guessing. Preserve unrelated work.
- Before reporting a blocker, check the available evidence and give the concrete recovery action.
- Refresh mutable external state immediately before consequential action or status reporting.
- Do not claim completion until every explicit requirement and the real end state have fresh evidence.
- Use an isolated worktree and task branch, then ship through the repository's PR workflow when current or standing policy authorizes delivery. Resolve failed checks and actionable review findings, merge once required gates pass, refresh the primary checkout and required local installation, then check for uncommitted and untracked work and remove only this task's clean, completed worktrees and obsolete branches; preserve unsaved or unrelated work. Honor explicit holds; a review request or this template alone grants no external-write authority. Do not ask again for actions already covered.
<!-- fitch-pi-kit:baseline:end -->

<!-- fitch-pi-kit:process:start -->
## Optional process

- Use Linear where the team or task uses it. Keep status and the PR link current, and record legitimate deferred findings in the project's tracker; personal repositories do not acquire a Linear requirement from this template.
- For shared-repository code changes, use a dedicated git worktree and branch per task; preserve unrelated and in-progress work in existing worktrees.
- For shared-team changes using this process block, complete a fresh `reviewer-gpt` review before the PR is ready. Refresh affected analysis after substantive fixes and resolve actionable findings with fixes or evidence-backed rebuttals; preserve required human reviews and repository protections. Add `reviewer-claude` when the change warrants a second model family.
- Read and respond to every pull-request comment, including review bots. Resolve a thread only after the underlying issue is fixed or answered.
- Before merging, record changes, decisions, validation, and remaining risk. Merge after required checks and reviews pass when current or standing authority covers it; wait only for an explicit hold or genuinely missing authority.
<!-- fitch-pi-kit:process:end -->
