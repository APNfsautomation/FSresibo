# FSResibo v3.6.0 Release Runbook

Status: prepared 2026-10-26 (Stage 4B, Issue #41). **Nothing in this runbook has been executed.** The Pages cutover has not occurred and `main` does not contain the stable `3.6.0` source. Only the Product Owner authorizes the merge to `main`, the Pages change and any database restoration.

How to read the evidence: **Verified** means it was checked against GitHub or the repository while preparing this document. **Reported** means the Product Owner or Technical Lead stated it; no artifact is stored in this repository. **Not recorded** means the repository holds no record and none is invented here. Backup evidence is kept outside this repository (section 2).

## 1. Current topology

| Component | State | Evidence |
|---|---|---|
| Source | Static site, no build step, no `package.json`. UAT branch `claude/ui-ux-refinement` carries `3.6.0` in `config/appMetadata.js`. `main` holds the earlier Milestone 3.6 source (`3.6.0-beta.1`) plus the CI workflow | Verified |
| Pages | Legacy branch-based publishing, source branch `claude/ui-ux-refinement`, path `/`, HTTPS enforced, URL https://apnfsautomation.github.io/FSresibo/ . The `github-pages` environment allows deployments from `main` and from the UAT branch | Verified (GitHub API, 2026-10-26) |
| Branch protection | Ruleset `25866288` on `main` and `25738688` on the UAT branch: pull request required, `node-tests` required from GitHub Actions (integration 15368), deletion and force pushes blocked, 0 required approvals, no bypass actors | Verified |
| Database | One hosted Supabase project, referenced by `config/supabase.js`. Source-controlled migrations `002`, `003` and `004` are identical on `main` and UAT, so this release needs **no schema change** (`001_create_receipts.sql` also exists in `supabase/migrations/`) | Verified for the repository; the applied-migration list on the hosted project is Not recorded here |
| Data after the 2026-10-26 cleanup | 20 receipts of accounts outside the approved cleanup scope (**preserve**), 8 authentication accounts (**preserve**), Monthly Filing and Shared Store Directory cleared | Reported |
| Sign-up | Disabled in Supabase by the Product Owner. Direct API refusal has not been independently tested (PARTIAL) | Reported |
| Auth flows | Email confirmation, password recovery and administrator invitation each passed Product Owner testing. The Supabase Site URL points to GitHub Pages; the Synology redirect is intentionally kept as an allowed alternative. These are Product Owner acceptances, not independent technical verification | Reported |

## 2. Existing backup evidence

Reported by the Product Owner and Technical Lead; the evidence exists **outside this repository**, in a separately maintained administrator backup inventory:

- A database backup was completed on 2026-10-26.
- An isolated restore rehearsal was completed successfully. The restore comparison reported **176 records with zero field differences**.
- The 20 remaining receipts belonging to accounts outside the approved cleanup scope must be preserved. **No additional database cleanup is authorized.**

This repository is public. It must not contain backup storage locations, internal server addresses, credentials, recovery secrets or backup contents, and none are recorded here. Refer to the administrator backup inventory instead. Automated backup encryption and archiving are **deferred**.

## 3. Fresh pre-release backup (required)

The 2026-10-26 backup does not cover changes made since it was taken, so a **fresh verified backup is required before the cutover**. Immediately before the cutover:

1. Take a new backup of the production project, using the same method that produced the 2026-10-26 backup. Record the method, the time and where it is stored in the administrator backup inventory, not in this repository. Treat it as containing personal and financial data: restricted access, not in GitHub, chat or screenshots.
2. Record the live counts at the moment of the backup: rows in `public.receipts`, `public.monthly_filing_receipts` and `public.shared_store_directory`, and the number of authentication accounts. Expected starting point from the report above: 20 receipts, 8 accounts; any difference must be explained before continuing.
3. Verify the backup. At minimum: the file or snapshot exists and is non-empty, its table list and row counts match step 2, and it contains the schema and RLS policies if the method includes them. A rehearsal restore into an **isolated** project is the strongest check and should be repeated if time allows; never restore into the production project to test.
4. The Product Owner records that the backup was verified. No cutover step starts before this.

## 4. Release and Pages cutover procedure (planned)

Each step needs the Product Owner's approval where stated. Do not start a step until the previous one is confirmed.

1. **Release pull request.** After the release-metadata pull request is merged into the UAT branch, take that merged head as the release candidate. Run a fresh trial merge of `origin/main` and the UAT head (for example `git merge-tree --write-tree origin/main origin/claude/ui-ux-refinement`) and run `node --test tests/*.test.mjs` on the result. At the time of the Stage 4A assessment the trial merge had no conflicts and 958 tests passed; **re-run it**, because the UAT branch can move.
2. Open a pull request from `claude/ui-ux-refinement` into `main` (merge commit, no squash). `node-tests` runs for it; `pr-readiness` does not (it targets the UAT branch only). The Product Owner approves one exact SHA.
3. **Backup** (section 3) is verified.
4. Merge the pull request through the ruleset. No bypass exists or is to be attempted. Auto-merge stays off.
5. **Pages cutover.** In the repository settings, Pages, change the source branch from `claude/ui-ux-refinement` to `main` (path `/`). The equivalent API call is `PUT /repos/APNfsautomation/FSresibo/pages` with `source.branch = main` and `source.path = /`; it has **not** been run. No workflow file and no code change are needed for the legacy branch build. Perform this step only after the merge in step 4, so `main` is never published before it contains the release.
6. **Validate the live commit.**
   - `gh api repos/APNfsautomation/FSresibo/pages` shows source branch `main` and status `built`.
   - `gh api repos/APNfsautomation/FSresibo/pages/builds/latest` shows the commit that was merged.
   - `gh api "repos/APNfsautomation/FSresibo/deployments?environment=github-pages&per_page=3"` shows a deployment for `main` at that commit.
   - The application shows `v3.6.0`, and a served file such as `config/appMetadata.js` matches the repository blob at that commit (a hard refresh avoids the browser cache). The application does not display a commit SHA (assumption: checked only from the documentation, not on the deployed build).
7. Run the production smoke checks in `08_Integration_UAT_Checklist.md` ("Production release smoke checks"). Record results as PASS, FAIL, PARTIAL, DEFERRED or NOT RUN.
8. **Preventing UAT from deploying to production.** Once the source is `main`, merges into the UAT branch no longer publish anything, so a UAT merge cannot change the live site. Production changes only when `main` changes, and `main` only changes through a protected pull request. The cost is that no hosted UAT exists; whether to create one is a separate Product Owner decision. Update `03_Development_Workflow.md` after the cutover.
9. Optionally tag the release commit after the smoke checks pass (the repository has no tags today). Tagging is a repository change and needs approval.

## 5. Rollback

Choose the least invasive option that fixes the problem. Rolling back code never changes database content.

### 5.1 Application rollback through a protected pull request (preferred)

1. Create a branch from `main`, revert the release merge commit (`git revert -m 1 <merge commit>`), and open a pull request into `main`.
2. `node-tests` must pass; the Product Owner approves; merge. Pages rebuilds from `main` and republishes the previous application.
3. Validate as in section 4 step 6 and re-run the relevant smoke checks.
4. The previous `main` head (`6e52dc97a5e7ba465f192eb00f45926f73de8b91`, the CI bootstrap) is the last state before this release. Reverting restores that source, which expects the same database: the release adds no migration, so no schema rollback is needed.

### 5.2 Emergency Pages rollback

- Switching the Pages source back to `claude/ui-ux-refinement` is immediate and needs no pull request, but it publishes the **UAT branch head**, not the previous production code. Once the release is merged the UAT branch contains the same `3.6.0` source, so this does not remove a defect that came with the release, and it publishes any later UAT merge. Use it only as a stopgap, with the Product Owner's approval, and to take the site down or to a known state, not to restore the older version.
- Disabling Pages (or making the repository's Pages unpublished) takes the site offline entirely. Use it only if serving the application is itself harmful, with the Product Owner's approval.
- Both are repository settings changes. They are not available to a normal pull request and are not covered by the ruleset.

### 5.3 Database restoration

**Never restore an older database backup over newer live production records without the Product Owner's explicit authorization.** Records created after the backup (receipts, Monthly Filing entries, directory profiles, accounts) would be lost and cannot be recovered from the older backup.

Explicit Product Owner approval, on the specific backup and the specific scope, is required before any of the following:

- restoring or overwriting any production table from a backup;
- restoring only selected rows or tables (state which, and what will be lost);
- any data change to repair damage, including deleting or editing receipts;
- any schema, RLS, grant, function or Auth configuration change, including the security-advisory fixes (no database change is authorized today).

Before asking, establish what is wrong, what the restore would overwrite, whether a targeted repair is enough, and restore into an **isolated** project first to compare. If the data is intact, do not restore.

## 6. Explicit constraints

- Do not schedule or perform another data cleanup.
- Do not delete the 20 remaining receipts or any of the 8 authentication accounts.
- Do not change the database as part of this release. The Supabase security advisories (mutable `search_path` on three functions, `rls_auto_enable()` executable by `anon` and `authenticated`, leaked-password protection disabled) remain under review and need their own authorization.
- Automated backup encryption and archiving remain deferred.
- Do not change rulesets, Pages or Supabase settings except as a numbered step above with the Product Owner's approval.

## 7. Open items before the cutover

- Fresh verified backup (section 3).
- Release pull request and exact-SHA approval (section 4).
- Product Owner decision on whether a hosted UAT is wanted after the cutover.
- Review of the Supabase security advisories.
