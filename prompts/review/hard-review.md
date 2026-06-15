---
description: Run a strict no-caveats subagent review gate with temp artifacts
argument-hint: "[scope]"
---

Scope: ${ARGUMENTS:-current uncommitted diff or most recent task-relevant changes}

Run a hard review gate. Quality bar: no known caveats, no shortcuts, no fragile paths, no hidden tech debt, and no false sign-off. Do not weaken this into a quick or material-only review.

Process:
1. Inspect the repo state and identify the exact review scope.
2. Create a unique temp artifact directory with `mktemp -d "/tmp/pi-hard-review.XXXXXXXXXX"`.
3. Use `subagent({ action: "list" })` if the available agents are not already known in this session.
4. Launch one or more fresh-context `reviewer` subagents with:
   - no edits
   - strict “everything is perfect” acceptance bar
   - permission to run focused read-only inspection commands, tests, typechecks, linters, or builds when needed
   - `output` set to a distinct file inside the temp artifact directory
   - `outputMode: "file-only"`
   - enough `timeoutMs` for a real review
5. For high-risk code quality, lifecycle, auth, permissions, data-loss, release, or large-refactor changes, add an independent strict reviewer such as `thermo-nuclear-code-quality-review` when available, also writing to the temp artifact directory.
6. Read the review artifact files yourself. If any blocker is valid, fix it or hand it to `fixer`, then run a targeted re-review with a new temp artifact path.
7. Do not claim green unless the reviewed scope, required validation, and reviewer evidence are enough for the strict bar. If coverage is incomplete, say exactly what evidence is missing.

Required subagent task wording:
- Include the repo path and branch when relevant.
- Include exact files, diff scope, plan paths, or product requirements to verify.
- Say: “Do not edit files.”
- Say: “If you could not inspect enough to enforce the strict acceptance bar, do not sign off; name the missing evidence.”
- Say: “If there are no findings, say exactly: `No findings. Everything I checked is acceptable.`”

Artifact rules:
- Do not write review artifacts into the project tree.
- Do not reuse output filenames across parallel subagents.
- Prefer temp/session artifact paths over repo-relative paths.
- Keep the artifact directory path in the final answer so the review can be re-read.

Final response:
- Verdict: pass/fail/incomplete.
- Review artifact paths.
- Validation commands you or reviewers ran and status.
- Fixes applied after review, if any.
- Remaining missing evidence or risks; say none only when true.
