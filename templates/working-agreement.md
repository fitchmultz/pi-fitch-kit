# Fitch Pi working-agreement template

Merge only the user-approved managed blocks into `~/.pi/agent/AGENTS.md`. Update an existing complete block in place. Never replace unrelated content. If markers are partial, duplicated, nested, or otherwise malformed, stop and ask the user how to proceed.

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

<!-- fitch-pi-kit:workos:start -->
## Optional WorkOS process

- Use Linear for task tracking. Create, update, and close issues as needed.
- For code changes in `workos/*`, prefer a dedicated git worktree and branch; preserve unrelated work in existing worktrees.
- Before commit, push, or merge, run a fresh `reviewer-gpt` with the `thermo-nuclear-code-quality-review` skill and repeat after every later code change until it requires no changes.
- Read and respond to every pull-request comment. Resolve a thread only after replying and only when resolved.
- Before merging, summarize changes, decisions, validation, and risks, then wait unless merge was explicitly authorized.
<!-- fitch-pi-kit:workos:end -->
