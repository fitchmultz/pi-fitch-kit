---
description: List open issues and PRs across public non-fork GitHub repos
argument-hint: "[owner]"
---

GitHub username or owner: ${1:-authenticated GitHub CLI account}

Find every public GitHub repository owned by the target GitHub account, excluding forks, then check each repo for open issues and open pull requests.

If no username or owner is provided, infer it from the authenticated GitHub CLI account. If that is not possible, ask only for the username.

Success criteria:
- Include all public repos owned by the account.
- Exclude forks.
- Paginate through all repos and all issue/PR results.
- Query issues and pull requests separately so PRs are not double-counted as issues.
- Include archived repos unless they are forks.
- Omit repos that have no open issues or open PRs.
- If no open issues or PRs exist anywhere, say so clearly.

Preferred tools:
- Use `gh` CLI if available.
- Otherwise use the GitHub API.

Return the result grouped by repo.

Output format:

## Summary
- Public non-fork repos scanned: N
- Repos with open issues or PRs: N
- Open issues: N
- Open PRs: N

## Results

### owner/repo-name
Repo: https://github.com/owner/repo-name

| Type | Title | Author | Link |
|---|---|---|---|
| Issue | issue title | @author | https://github.com/owner/repo/issues/123 |
| PR | PR title | @author | https://github.com/owner/repo/pull/456 |

## Validation
Briefly state how you verified pagination, fork exclusion, and issue/PR separation.
