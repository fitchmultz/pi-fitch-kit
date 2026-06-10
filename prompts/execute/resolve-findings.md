---
description: Resolve a set of findings end-to-end and merge them
argument-hint: "<findings>"
---

## Findings
```text
$@
```

If the findings block is empty or only whitespace, stop and ask for the findings. Do not invent them.

You are the coordinator agent for resolving a set of repo findings end-to-end. You have GitHub access. Do not stop until every finding is implemented, validated, and merged into main, unless you hit a hard blocker that cannot be resolved from within the repo or GitHub workflow.

Mission:
Resolve all findings with the smallest safe number of short-lived branches and PRs, minimal merge pain, and no direct pushes to main.

Operating rules:
- The unit of work is an independently mergeable batch, not an individual finding.
- First cluster the findings by file overlap, subsystem overlap, dependency order, and risk.
- Default to serial execution from the latest main branch.
- Only allow parallel PRs when the batches are clearly disjoint in files, behavior, and merge risk. Cap parallelism at 2.
- One coordinator lane owns merge order and re-plans after each merge.
- Use the repo’s existing local validation gates: tests, lint, typecheck, build, scripts, make targets, task runners, pre-commit hooks, or equivalent. Do not add or depend on hosted CI.
- Use reviewer agents on each batch diff or PR diff before merge.
- Launch reviewers and workers with `context: "fresh"` and explicit `reads:` / diff scope. Reserve `context: "fork"` for fix-after-review in the same active thread only.
- Merge only after relevant local validation passes and reviewer feedback is addressed or rejected with rationale.
- If a branch becomes stale or conflicts with main, update it from the latest main or recreate it from main and replay the minimal change set.
- Keep each PR single-purpose and easy to review.
- Do not pause for confirmation between batches. Continue until completion.

Process:
1. Build a dependency/conflict matrix for all findings.
2. Produce the minimal batch plan:
   - batch name
   - included findings
   - why they belong together
   - branch name
   - issue title
   - PR title
   - merge order
   - local validation to run
   - whether the batch can run in parallel with any other batch
3. Start Batch 1 immediately.
4. For each batch:
   a. Create or update the tracking issue/checklist item.
   b. Create a short-lived branch from the latest main.
   c. Implement the changes.
   d. Run the relevant local validation.
   e. Open or update a draft PR.
   f. Dispatch reviewer agents on the diff or PR and incorporate worthwhile feedback.
   g. Re-run validation.
   h. Mark the PR ready and merge it.
   i. Delete the branch if appropriate.
   j. Pull the latest main and verify the merged result.
   k. Reassess the remaining findings against the new main and adjust batching if needed.
5. Continue until no findings remain.

Completion criteria:
- Every input finding is either:
  - merged into main, or
  - explicitly closed as unnecessary/not applicable with a written rationale.
- No stale work branches or open draft PRs remain for these findings.
- main contains all accepted fixes.
- The relevant local validation passes on main.
- Provide a final summary mapping each original finding to the PR and merge commit that resolved it.

Output:
- First: dependency/conflict matrix and batch plan
- Then after each batch:
  - batch name
  - branch and PR
  - findings covered
  - files changed
  - local validation run and result
  - reviewer-agent feedback addressed
  - merge result
  - remaining findings
- Final:
  - all merged PRs
  - any rejected or deferred findings with reasons
  - final validation status on main
  - concise summary of repo state
