# Engineering records

Records for the engineering standard adopted in `docs/engineering-standard.md` (Strict Oxlint and Oxfmt Engineering Standard, v5.1.2). The standard's Appendix B defines the required record shapes.

## Adoption record

- **Repository:** `fitchmultz/pi-fitch-kit`; adopted standard version **v5.1.2**. Adopted copy digest (sha256, after oxfmt): `414820464b9eadfb645ea51dbd1ef3eac9c52958b986f19f44feaf79d2fae333`.
- **Runtimes and package manager:** Node `>=24.15.0` (npm `12.2.0`).
- **Installed tool versions:** oxlint `1.90.0`, oxfmt `0.75.0`, oxlint-tsgolint `7.0.2005`, typescript `7.0.2`.
- **Config paths:** `.oxlintrc.json` (Appendix A baseline plus role-mapped profile overrides), `.oxfmtrc.json` (section 7.1 settings preserving the established tab convention for TypeScript; JSON keeps 2-space output so npm-managed files stay stable).
- **Acceptance paths:** `npm run check` (`scripts/run-gates.mjs`: typecheck, format, tests — aggregated so one failure cannot hide the rest), `npm run smoke` for package loading; hosted CI runs `npm run check:compat` through the fleet `pi-compatibility` workflow. `npm run lint` runs the full baseline lint.
- **Compiler projects and source profiles:** single `tsconfig.json` project. Production profile: `extensions/*.ts`, `scripts/validate.mjs`. Test profile: the regression/smoke/boundary scripts under `scripts/`. No handwritten declarations exist in this repository, so `skipLibCheck: true` retains no unchecked handwritten declaration (section 4.2 allows an application to retain `skipLibCheck` when no handwritten declarations require a focused check).
- **Formatter and generator ownership:** oxfmt owns all supported maintained files (`.ts`, `.mjs`, `.md`, `.json`, `.yaml`) except `package-lock.json`, whose formatting owner is npm. No maintained generator output exists in this repository.
- **Migration status:** **in progress, phased per section 9.2.** Toolchain, formatter ownership, and the aggregating acceptance runner are enforced now. Remaining work: extend compiler coverage and strict options to the scripts, repair source to satisfy the full type-aware lint baseline, record the required quality exceptions, then wire repo-wide lint enforcement into `npm run check` and remove this note.
- **Integrated verification:** to be recorded at completion (base/head revision, commands, exit statuses, scopes).

## Quality-exception record

None recorded yet. Exceptions are added here with stable `QX-*` identifiers using the Appendix B template as the migration lands them; each entry must carry its own evidence, comparison, verification, and retained-protection statement.
