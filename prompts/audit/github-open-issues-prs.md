---
description: List open issues and PRs in owned repos and a named user's contributions elsewhere
argument-hint: "[owner]"
---

GitHub username or owner: ${1:-authenticated GitHub CLI account}

Find every public GitHub repository owned by the target GitHub account, excluding forks, then check each repo for open issues and open pull requests.

If no username or owner is provided, infer it from the authenticated GitHub CLI account. If that is not possible, ask only for the username.

If the user explicitly names a GitHub user, also find all their open issues and PRs across repositories the authenticated account can access, including private repos, forks, and repos they own. Here, "their" means authored by that user, not assigned to them, reviewed by them, or mentioning them. Run this search even if the user owns no qualifying repos. Skip this additional search for an inferred account or an organization.

Success criteria:

- For the repository-wide scan, include all public non-fork repos owned by the account.
- For the named user's authored-item search, apply no visibility, fork, or repository-owner restriction. Include private repos and forks wherever the authenticated account has access.
- Paginate through all repos and all issue/PR results.
- Query issues and pull requests separately so PRs are not double-counted as issues.
- In the repository-wide scan, include open issues and PRs by any author. In the authored-item search, include only those authored by the explicitly named user.
- Use repository metadata to distinguish repositories covered by the original scan from additional repositories found through authorship.
- Include archived repos in both scopes, subject only to each scope's restrictions.
- Omit repos that have no open issues or open PRs.
- Deduplicate items by URL before counting. Count public non-fork owned repos scanned separately from additional repos with authored items. Merge overlapping results into one row per item.
- If no open issues or PRs exist in either applicable scope, say so clearly. Report failed or incomplete queries rather than treating them as empty results.

Preferred tools:

- Use `gh` CLI if available.
- Otherwise use the GitHub API.

For the additional search, query GitHub's issue search API separately with `is:open is:issue author:USERNAME` and `is:open is:pr author:USERNAME`. Paginate both queries without excluding results based on repository visibility, fork status, or owner. Owner or repository qualifiers may partition the search, but must not narrow the combined requested scope. Private results are limited to the authenticated account's access; state this boundary without claiming coverage of inaccessible repos. If using the REST issues endpoint for owned repos, exclude entries with `pull_request` from issue results and query the pulls endpoint separately.

Check search `total_count` and `incomplete_results` as well as pagination. GitHub search exposes at most 1,000 results per query. Split larger searches into smaller created-date ranges and deduplicate overlapping boundaries. Retry incomplete searches or report the remaining gap; pagination alone does not prove completeness. See [GitHub's search API limits](https://docs.github.com/en/rest/search/search#about-search).

GitHub also limits each REST search query to 4,000 matching repositories; `total_count` and `incomplete_results` do not establish coverage beyond that repository scope. Where needed, partition searches by `user:`, `org:`, or `repo:` and merge their results. Account organizations alone do not cover public repos elsewhere or all collaborator access. If repository coverage cannot be established, report this search-scope limit as an unresolved completeness gap, even when all returned pages were fetched. Do not claim all accessible authored items were found based only on an unscoped search.

Return the result grouped by repo, with repos from the repository-wide scan first and additional repos second. Summary issue and PR totals cover both scopes.

Output format:

## Summary

- Public non-fork repos scanned: N
- Additional repos with authored issues or PRs: N
- Repos with open issues or PRs: N
- Open issues: N
- Open PRs: N

## Results

### owner/repo-name

Repo: https://github.com/owner/repo-name

Scope: Public non-fork owned repo / Authored by @username in an additional repo

| Type  | Title       | Author  | Link                                     |
| ----- | ----------- | ------- | ---------------------------------------- |
| Issue | issue title | @author | https://github.com/owner/repo/issues/123 |
| PR    | PR title    | @author | https://github.com/owner/repo/pull/456   |

## Validation

Briefly state how you verified pagination, search completeness, fork exclusion for the repository-wide scan only, issue/PR separation, deduplication across scopes, and unrestricted authorship queries. Note the authenticated account's access boundary for private results. State whether the additional search ran or why it did not.
