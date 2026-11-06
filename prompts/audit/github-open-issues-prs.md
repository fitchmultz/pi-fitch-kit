---
description: List open issues and PRs in owned repos and a named user's contributions elsewhere
argument-hint: "[owner]"
---

GitHub username or owner: ${1:-authenticated GitHub CLI account}

Find every public GitHub repository owned by the target GitHub account, excluding forks, then check each repo for open issues and open pull requests.

If no username or owner is provided, infer it from the authenticated GitHub CLI account. If that is not possible, ask only for the username.

If the user explicitly names a GitHub user, also find their open issues and PRs in public non-fork repos owned by other accounts. Here, "their" means authored by that user, not assigned to them, reviewed by them, or mentioning them. Run this search even if the user owns no qualifying repos. Skip this additional search for an inferred account or an organization.

Success criteria:

- Include all public repos owned by the account.
- Exclude forks.
- Paginate through all repos and all issue/PR results.
- Query issues and pull requests separately so PRs are not double-counted as issues.
- In owned repos, include open issues and PRs by any author. In other repos, include only those authored by the explicitly named user.
- Verify each external repo's owner, public visibility, and fork status from repository metadata.
- Include archived repos unless they are forks.
- Omit repos that have no open issues or open PRs.
- Deduplicate items by URL before counting. Count owned repos scanned separately from external repos with matching items.
- If no open issues or PRs exist in either applicable scope, say so clearly. Report failed or incomplete queries rather than treating them as empty results.

Preferred tools:

- Use `gh` CLI if available.
- Otherwise use the GitHub API.

For the additional search, query GitHub's issue search API separately with `is:open is:issue is:public author:USERNAME -user:USERNAME` and `is:open is:pr is:public author:USERNAME -user:USERNAME`. Paginate both queries, then filter their repositories using the metadata checks above. If using the REST issues endpoint for owned repos, exclude entries with `pull_request` from issue results and query the pulls endpoint separately.

Check search `total_count` and `incomplete_results` as well as pagination. GitHub search exposes at most 1,000 results per query. Split larger searches into smaller created-date ranges and deduplicate overlapping boundaries. Retry incomplete searches or report the remaining gap; pagination alone does not prove completeness. See [GitHub's search API limits](https://docs.github.com/en/rest/search/search#about-search).

Return the result grouped by repo, with owned repos first and other repos second. Summary issue and PR totals cover both scopes.

Output format:

## Summary

- Public non-fork repos scanned: N
- Other public non-fork repos with authored issues or PRs: N
- Repos with open issues or PRs: N
- Open issues: N
- Open PRs: N

## Results

### owner/repo-name

Repo: https://github.com/owner/repo-name

Scope: Owned repo / Authored by @username in another repo

| Type  | Title       | Author  | Link                                     |
| ----- | ----------- | ------- | ---------------------------------------- |
| Issue | issue title | @author | https://github.com/owner/repo/issues/123 |
| PR    | PR title    | @author | https://github.com/owner/repo/pull/456   |

## Validation

Briefly state how you verified pagination, search completeness, fork exclusion, issue/PR separation, and authorship in other repos. State whether the additional search ran or why it did not.
