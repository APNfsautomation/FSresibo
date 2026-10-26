# FS Receipt Management Tool (FSResibo) v3.6.0 Release Notes

Status: **release candidate**, prepared 2026-10-26. Version `3.6.0` is set in `config/appMetadata.js` on the UAT branch. It is **not deployed**: `main` does not contain it and GitHub Pages still serves the UAT branch. The procedure is in `09_Release_Runbook.md`. Every item below is described from the repository (documents and automated tests); where acceptance came from the Product Owner, it is noted, and automated tests are never a substitute for live acceptance (`07_Regression_Coverage_Matrix.md`).

This release adds no database migration. Migrations `002` to `004` are unchanged since the earlier release.

## What is in this release

### Receipt Encoding
- Per-receipt "New, unsaved" and "Unsaved changes" indicators that agree with the export preflight, and an Expand/Collapse that stays reachable (Issue #22).
- Dirty-only saves: only changed receipts are written, with real progress, all-or-none amount validation and explicit reconciliation of a create whose answer was lost (Issue #24).
- The Edit dialog's Save correction button is released after a successful correction in the same session (Issue #33).
- Consumed receipts are read-only, and Add Receipt is hidden in the Consumed view.
- Keyboard shortcuts: Ctrl+Enter adds a receipt, Ctrl+S saves.

### Receipt Optimization
- Exact Best Match over pools of more than 32 Available receipts, run in a Web Worker with visible progress, a Cancel button and computation budgets. Over budget, it returns no recommendation rather than an approximation (Issue #29, Decision 019).
- Manual Selection as a second export mode beside Best Match, each with its own selection and arrangement; Select Shown fills only the remaining capacity up to 100.
- Quick Optimizer: a separate workspace with in-memory R1/R2/R3 inputs, a 32-input limit and exact centavo display. It stores nothing and resets on refresh, sign-out and account change.
- Fixed accounting rules: a PHP 50 maximum excess, target-reaching priority and strict Do Not Exceed.

### Excel export
- One authoritative Expense Detailed Report workbook generator, used by both long-term export and Monthly Filing export, with official-style headers.
- A reviewable, reorderable export confirmation with a second snapshot check: a receipt changed, deleted or Consumed in the meantime blocks the export.
- Amount cells are numeric with a `#,##0.00` format; export filenames use the Philippine calendar date.

### Receipt lifecycle
- Receipts move between Available and Consumed; exporting marks the exported receipts Consumed. Restore (Mark Available) and delete are available, with in-app confirmation dialogs in place of browser prompts.

### Monthly Filing
- A separate Monthly Filing workspace with its own table and per-user row-level security.
- Active and Archived views of one table; Export & Archive archives exactly the records in the generated workbook; Return to Active supports correcting and re-exporting; Clear Archived keeps Active receipts; a deliberate Clear All lives under More Actions.
- Numbered cards that match the workbook Item No. and an exact Active Total.

### Shared Store Directory
- A company-wide store directory (`public.shared_store_directory`, with row-level security) that offers store autocomplete in both transaction workflows.
- Explicit contribution of new profiles, branch-aware matching and duplicate/conflict handling. A signed-in account also gets suggestions from its own receipt history.

### Authentication and session safety
- Deployment-aware confirmation and recovery redirects, and a dedicated Set New Password experience. Email confirmation, password recovery and administrator invitation each passed Product Owner live testing (reported; Product Owner acceptance, not independent technical verification).
- Public sign-up was disabled in Supabase by the Product Owner (reported). The application has no visible sign-up control.
- Session isolation (Issue #27): every asynchronous operation belongs to the session that started it, so one account's late results never appear for the next account. Closed with Product Owner acceptance.

### UI/UX and platform
- Top-level application shell with a desktop sidebar and a mobile drawer, hash routing that is compatible with static hosting and authentication callbacks, and a System/Light/Dark theme.
- Dialogs trap and restore focus; only the receipt list scrolls on the Encoding screen.
- The application version is shown before and after sign-in.
- Dependency integrity (Issue #32): the Supabase client and SheetJS are vendored and listed in `vendor/dependency-manifest.json`; the Supabase bundle loads with a Subresource Integrity hash and Tesseract.js is pinned with Subresource Integrity.
- Continuous integration: the `node-tests` check is required by rulesets on both the UAT branch and `main`.

## Accepted limitations and deferred functionality

- **OCR:** the dirty-indicator manual test A7 is deferred to Epic 4 and is not passed. The Tesseract worker, core and English language data are pinned to exact versions, but the browser does not verify their bytes.
- **Bulk performance:** saving 400 genuinely new receipts is not optimized; creates stay sequential. Deferred.
- **In-flight requests:** a request already sent for one account when the user switches accounts cannot be recalled and may still complete on the server for that account (a downloaded workbook stays downloaded).
- **Mobile and accessibility:** Milestone 3.6's mobile-device validation, assistive-technology checks and mobile performance were never recorded.
- **Shared Store Directory:** entries have no user delete or deactivate, and an administrator maintenance runbook for them is not yet written. The live new-contribution and cross-account visibility check (11b) remains deferred.
- **Backups:** automated backup encryption and archiving are deferred.
- **Hosted UAT:** once Pages serves `main`, the UAT branch is no longer published.
- **Security advisories:** the Supabase advisories (mutable `search_path` on three functions, `rls_auto_enable()` executable by `anon` and `authenticated`, leaked-password protection disabled) are under review. No database change is part of this release.
- **Not in this release:** OCR improvements (Epic 4), ERP integration and any new features.
