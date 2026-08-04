# Fitch Pi working-agreement template

Merge only the user-approved managed blocks into `<Pi agent dir>/AGENTS.md`, using the active directory resolved by `/fitch-setup`. Update an existing complete block in place. Never replace unrelated content. If markers are partial, duplicated, nested, or otherwise malformed, stop and ask the user how to proceed.

<!-- fitch-pi-kit:baseline:start -->
## Baseline safety and evidence

- Make requested local, reversible changes and run relevant non-destructive checks without repeated permission prompts.
- Ask before external writes, destructive or costly actions, production changes, account or credential changes, security or privacy changes, or material scope expansion.
- Inspect current repositories, documentation, logs, CI, and live state instead of guessing. Preserve unrelated work.
- Before reporting a blocker, check the available evidence and give the concrete recovery action.
- Refresh mutable external state immediately before consequential action or status reporting.
- Do not claim completion until every explicit requirement and the real end state have fresh evidence.
- Commit only when requested or agreed. Stop before push, merge, publish, deploy, or other external mutation unless the user explicitly authorized it.
<!-- fitch-pi-kit:baseline:end -->

<!-- fitch-pi-kit:process:start -->
## Optional process

- Use Linear for task tracking on real work. Keep status and the PR link current, and create follow-up issues for deferred findings instead of dropping them.
- For shared-repository code changes, use a dedicated git worktree and branch per task; preserve unrelated and in-progress work in existing worktrees.
- Before a PR is ready, launch a fresh `reviewer-gpt` subagent on the diff and repeat after fixes until it reports no blocking findings. Add `reviewer-claude` when the change warrants a second model family.
- Read and respond to every pull-request comment, including review bots. Resolve a thread only after the underlying issue is fixed or answered.
- Before merging, summarize changes, decisions, validation, and remaining risk, then wait unless merge was explicitly authorized.
<!-- fitch-pi-kit:process:end -->
