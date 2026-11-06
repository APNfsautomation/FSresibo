# FSResibo v3.7.1 — Production Release Candidate

Status: **Prepared for Product Owner release review on 2026-11-06. NOT merged to `main`, NOT deployed to production.**

This document accompanies the release PR. It supersedes the *historical* v3.6.0 topology and procedure assumptions in `docs/09_Release_Runbook.md` **for this release**. Reconfirm current GitHub Pages settings before any production operation; do not assume old topology descriptions are current.

## 1. Exact source and acceptance evidence

- Baseline production source (`main` at PR preparation): `c6fbd1867e8c2b708301bf01b8cdb4acb4aa3ca7` (v3.7.0).
- UAT source containing both accepted changes: `b50fdafafae94d4f72544be35235463a4b285d50` (`claude/ui-ux-refinement`).
- Reviewed Issue #56: PR #57, original implementation `4a02650`, docs follow-up `8aed5d9`, merged into UAT as `506fdf3`.
- Reviewed Issue #58: PR #59, original implementation `601b04e`, review follow-up `146ccd954bebfd1a0d2b292d6bd63c14b5f82e80`, merged into UAT as `b50fdaf`.
- Standalone UAT deployment: `APNfsautomation/FSresibo-UAT`, deployment commit `980469b72697006018670f0845d6a91f42f02e23`, pinned UAT source `b50fdaf`, shown version `3.7.0-uat+b50fdaf`.
- Product Owner **reported PASS** for both Issue #56 and Issue #58 UAT checklists. These are PO-reported live acceptance results, not independently reproduced by this document.
- Last independently checked feature-head GitHub Actions (`146ccd9`): **1,071 Node tests passed, 0 failed**. A fresh PR-to-`main` CI run must pass on the new release candidate.

## 2. User-visible changes

### Receipt Optimization (Issue #56)
- Missing Expense Account and Classification of Expense values can be completed for the exact chosen Best Match or Manual Selection receipts inside the existing Review & Arrange dialog.
- Shows readiness; preserves chosen receipt order and optimizer result for classification-only changes.
- `Save Details & Export` saves **only modified expense columns** through guarded updates, verifies the saved snapshot, produces the XLSX, then marks exported receipts **Consumed**.
- On error, conflict, cancellation or incomplete fields, the app does not export or consume. Any already-persisted partial updates are reported honestly.

### Monthly Filing (Issue #58)
- After the existing Export Active confirmation, the existing pre-review save of Active receipts remains in place.
- Review & Arrange opens despite missing expense fields, including when there is **one** Active receipt; the user can complete both expense fields inside this existing dialog.
- Readiness, receipt order, keyboard/touch/drag controls, targeted updates, read-back verification, and `Save Details & Export` are supported.
- Cancel discards *unsaved changes made inside the review*; receipt changes saved before opening review remain saved.
- The existing **Active → Archived** workflow and archive RPC remain intact. No workbook or archive operation is allowed for incomplete/failed expense updates.

### Shared classification list
- Adds exactly `Service Charge` and `Government Benefits` to `Classification of Expense`.
- Classification choices increase from 39 to **41** in Encoding, Monthly Filing and export review. Existing labels, including `Accomodation`, are preserved.
- Expense Account choices remain `Day to day` and `Project Expense`.

## 3. Compatibility and scope
- Application: static HTML/CSS/JavaScript, vendored browser dependencies, unchanged official Expense Detailed Report mapping.
- Compared with production `main`, the UAT code introduces **no migration, SQL, Auth, RLS, dependency, GitHub workflow, or production-config change**. Migration `005_add_expense_fields.sql` is already part of production v3.7.0.
- Targeted changes use existing `updated_at` and status columns with existing user-scoped RLS. No schema operation is included.
- Compared with the accepted UAT source, the **only runtime change** is the visible version bump `3.7.0 → 3.7.1`. Other release-only changes are these notes, historical evidence-document updates, and corresponding stable-version test expectations.
- The Supabase production project and browser-safe client configuration must remain byte-identical to the production baseline for this release.

## 4. Required production release gates (NOT automatically satisfied)

1. **Review PR and exact commit.** Confirm release PR targets protected `main`, source is the approved UAT commit plus metadata/docs, and no unauthorized files are introduced. Do not merge without separate exact-head Product Owner approval.
2. **Fresh CI.** Require `node-tests` to pass on the PR targeting `main`. CI passing is not a release approval.
3. **Production backup.** Before any production merge/deployment, obtain and verify a *fresh* production backup and data inventory in the restricted administrator system (never this public repo). No new backup is claimed in this document.
4. **Deployment source check.** Verify GitHub Pages currently publishes the intended production `main` and confirm there is no implicit deploy of the feature or release branch. Historical v3.6.0 Pages cutover instructions are not evidence of present settings.
5. **Auth/RLS gate.** Verify current production configuration, including the admin sign-up policy, without altering it. Do not perform a live sign-up or other write probe without explicit authorization; document any risk acceptance if a gate is deferred.
6. **Owner release approval.** Merge with the repository's required checks and review process, only after fresh backup and approval. Do not change Pages settings, rulesets, or Supabase without distinct authorization.
7. **Post-deployment verification.** Confirm the live app reports `3.7.1`, loads sign-in/navigation, and uses the production Supabase project; confirm a GitHub Pages deployment for the exact merged commit. Perform explicitly authorized, targeted smoke tests for both export flows and Excel mapping.
8. **Data safety.** Do not clean, delete, or modify existing users' receipts; use isolated or explicitly approved labelled test records for any production write test. A code rollback does *not* undo database writes.

## 5. Residual risks and rollback

- `updated_at` concurrency guards and read-back verification prevent many stale writes. The interval between final read and consumption/archive is **not** one atomic database transaction. Concurrent actions in that interval remain a known race; archive and receipt status operations retain their existing safeguards.
- Expense-only updates are issued per receipt, not a batch transaction. A mid-batch failure can leave already-saved classifications persisted; the interface reports this.
- If smoke checks fail, stop further rollout and propose a **reviewed revert PR** against protected `main` for the exact release merge. Do not overwrite users' newer data with an old database backup. Changing Pages source or restoring the database needs its own explicit PO authorization.
- Any new migration, Auth, RLS, sign-up setting, dependency or release-workflow change is **out of scope** and requires a separate approved change.

## 6. Production deployment status

**PENDING** — This document records preparation of a pull request only. The production merge, backup verification, Pages publication, and production smoke checks have **not** been performed or claimed here.
