# Regression Coverage Matrix and Evidence Map

Checkpoint: CP10-C3E-5 (Issue #26). Build under review: `FSResibo v3.6.0-beta.1` on `claude/ui-ux-refinement` at `2b1268c` plus this checkpoint's tests and documentation.

This document records what is **automated**, what is **live-tested by the Product Owner**, what is **deferred**, what is **unverified**, and what is **not released**. It is a test and documentation checkpoint: no application code was changed. Its executable test IDs are checked by `tests/crossModuleRegression.test.mjs` (DOC-1), so a renamed or deleted test cannot silently leave a stale claim here.

## 1. Evidence key and status words

| Evidence | Meaning |
|---|---|
| **A** | Automated Node test against real UI/service code with in-memory test doubles. Run in CI (`node-tests`). Proves logic, **not** a hosted Supabase, real browser, device or screen reader. |
| **S** | Static assertion over source text, SQL or CSS. Proves the text says what is expected; it does not render anything or touch a database. |
| **L** | Live Product Owner UAT on the deployed UAT build, reported in a GitHub issue. |
| **H** | Hosted GitHub evidence (a PR, an Actions run, a ruleset). |

Live status words: **PASS**, **FAIL**, **PARTIAL**, **DEFERRED**, **NOT RUN**. `DEFERRED` is never `PASS`, and `NOT RUN` is never `PASS`. An automated pass never changes a live status.

## 2. Test baseline

| Point | Command | Result |
|---|---|---|
| Baseline, UAT `2b1268c` (this checkpoint, local, Node v24.19.0) | `node --test tests/*.test.mjs` | 731 tests, 731 pass, 0 fail |
| Same head, hosted | `node-tests` on PR #25 head `2e7b070`, run `40074662952` | 731 pass, 0 fail |
| Final, this PR (local, Node v24.19.0) | `node --test tests/*.test.mjs` | 747 tests: 744 pass, 0 ordinary fail, 3 todo. **The 3 todo tests (AUTH-7, AUTH-8, AUTH-9) actually fail** and are marked todo only so CI stays green while Issue #27 is triaged. This is not 747 passing tests and not complete session-isolation coverage. |
| Final, this PR, hosted | `node-tests` on the exact PR head | the SHA and run id are recorded in the PR description |
| Issue #29 baseline, UAT `68eaac9` | `node --test tests/*.test.mjs` | 747 tests: 744 pass, 0 ordinary fail, 3 todo |
| Issue #29 final (local, Node v24.19.0) | `node --test tests/*.test.mjs` | **805 tests: 802 pass, 0 ordinary fail, 3 todo** (the same 3 known-defect todo tests for Issue #27, which still fail by design; 794 before the Round 1 review fixes). Issue #29 adds 58 tests in `poolOptimization.test.mjs`, `poolOptimizationUi.test.mjs` and `poolOptimizerClient.test.mjs`. |
| Issue #29 final, hosted | `node-tests` on the exact PR head | the SHA and run id are recorded in the PR description |

`tests/crossModuleRegression.test.mjs` adds 16 tests: 13 are ordinary tests, and 3 (AUTH-7, AUTH-8, AUTH-9) are `todo` tests for a known defect (section 6). Those three **assert the intended behavior and currently fail**; Node reports a failing `todo` test but does not fail the run. Never report them as passing.

## 3. Coverage matrix

Each citation names a test file in backticks, then › and the start of a test title in quotes. DOC-1 verifies that every one exists.

### 3.1 Authentication and session isolation

| ID | Expected result | Automated evidence | Gap / disposition | Live PO UAT |
|---|---|---|---|---|
| AUTH-01 | Redirect URLs keep the GitHub Pages sub-path; recovery intent is recognized from query or fragment before any session. (A, S) | `authService.test.mjs` › "runtime auth redirect preserves the GitHub Pages repository subpath"; `authService.test.mjs` › "recovery-intent callbacks are recognized from query or fragment" | Logic only. Real emails and real redirects are not exercised. | NOT RUN (see CP10-C4) |
| AUTH-02 | An email confirmation link lands on the deployed app, and a recovery link opens the new-password form. | none | **Unverified.** The Product Owner earlier observed confirmation links reaching an obsolete Synology address and recovery links entering the app without a reset. Needs live Supabase URL/redirect configuration and a functional retest. Assigned to **CP10-C4**. Unit tests must not be read as resolving it. | NOT RUN |
| AUTH-03 | All password fields are emptied on sign-out, on the recovery screen and when the panel closes; a failed login keeps typing. (A) | `c3Polish.test.mjs` › "AUTH-03: all five password fields are emptied" | None | NOT RUN |
| AUTH-04 | A user change or logout clears the receipt manual selection, both arrangements and known-missing ids. (A) | `arrangementIsolation.test.mjs` › "R01: logout and a user change clear both arrangements"; `asyncExportIsolation.test.mjs` › "R03: logout and a user change reset the manual selection" | None | NOT RUN |
| AUTH-05 | Quick Optimizer keeps its state for the same account and clears it on an account switch, logout and null session. (A) | `quickOptimizer.integration.test.mjs` › "same account retains calculator; account switch, logout and repeated null cleanup clear it" | None | NOT RUN |
| AUTH-06 | A receipt save pending when a user signs out never affects the next account, and does not block its Save. (A) | `savePerformance.test.mjs` › "R2: sign out during a save, sign in as someone else"; `savePerformance.test.mjs` › "R2: an account that never finishes its save does not stop the next account from saving" | Covers Receipt Encoding only. | NOT RUN |
| AUTH-07 | The real `app.js` activates receipts then Monthly Filing for the signed-in account; a token refresh reloads nothing; a **sequential** switch without a sign-out event reloads both; duplicate sign-in events for the **same** account load once. (A) | `crossModuleRegression.test.mjs` › "AUTH-1: the first session activates receipts"; `crossModuleRegression.test.mjs` › "AUTH-2: a different account signing in"; `crossModuleRegression.test.mjs` › "AUTH-3: a second sign-in event" | New in this checkpoint. These tests complete one activation before the next begins. They do **not** cover overlapping activations (see AUTH-10). | NOT RUN |
| AUTH-08 | Sign-out, a missing session and a signed-out start each clear receipts, Monthly Filing and Quick; recovery ignores sign-in events until sign-out. (A) | `crossModuleRegression.test.mjs` › "AUTH-4: sign-out, a missing session"; `crossModuleRegression.test.mjs` › "AUTH-5: after a recovery event" | New in this checkpoint. | NOT RUN |
| AUTH-09 | A Monthly Filing save, export or load belonging to a signed-out account never changes or blocks the next account's screen. | `crossModuleRegression.test.mjs` › "AUTH-7 (known defect)" (todo); `crossModuleRegression.test.mjs` › "AUTH-8 (known defect)" (todo); `crossModuleRegression.test.mjs` › "AUTH-9 (known defect)" (todo) | **Known defect, Issue #27**, awaiting Product Owner triage. Not fixed in this checkpoint. The failing tests show a previous account's Monthly Filing financial data appearing on the next account's signed-in screen, so a **HIGH severity, fix-before-`main`-promotion** classification is recommended (section 6). | NOT RUN |
| AUTH-10 | Overlapping account activation is safe: account A's load still running when B signs in never shows A's data to B, for both Monthly Filing and Receipt Encoding. | none | **Unverified.** No test holds A's load open and switches to B before it completes. `app.js` and `receiptUi.loadForUser` have awaited load boundaries; Monthly Filing's was reproduced (AUTH-9), Receipt Encoding's was not probed. Potential Issue #27 follow-up; not a confirmed additional bug. | NOT RUN |

### 3.2 Receipt Encoding

| ID | Expected result | Automated evidence | Gap / disposition | Live PO UAT |
|---|---|---|---|---|
| ENC-01 | Save with nothing edited makes no write and says so. (A) | `savePerformance.test.mjs` › "B02: 400 clean saved receipts with nothing edited" | None | Issue #24 UAT: PASS (milestone level) |
| ENC-02 | 400 stored receipts with only #399 edited make exactly one update, with progress out of 1. (A) | `savePerformance.test.mjs` › "B01: 400 clean saved receipts, only #399 edited" | None | Issue #24 UAT: PASS (milestone level) |
| ENC-03 | 75 and 100 stored receipts with one edit each make one update. (A) | `savePerformance.test.mjs` › "B03: 75 saved with 1 edit, and 100 saved with 1 edit" | None | as above |
| ENC-04 | Progress is real, and a second click, repeated Ctrl+S or a re-entrant save never duplicates a write. (A) | `savePerformance.test.mjs` › "B09: a second click, repeated Ctrl+S"; `keyboardEncoding.test.mjs` › "Ctrl+S is exactly the Save changes button" | None | as above |
| ENC-05 | A late invalid amount blocks every write (all-or-none preflight) and focuses that receipt. (A) | `savePerformance.test.mjs` › "B07: a late invalid amount blocks every write"; `moneyAmount.test.mjs` › "a malformed amount on one receipt blocks the whole batch" | None | as above |
| ENC-06 | Per-receipt unsaved indicators agree with the count and with the export preflight. (A) | `encodingSelectionUx.test.mjs` › "A1: a saved receipt shows no flag"; `encodingSelectionUx.test.mjs` › "A3: the global unsaved count always equals the number of flagged receipts" | None | Issue #22 UAT: A1-A6 PASS |
| ENC-07 | Exact centavo, blank, zero and whitespace semantics are identical in dirty detection, save and export. (A) | `savePerformance.test.mjs` › "B06: the same dirty rules as the unsaved flags"; `moneyAmount.test.mjs` › "blank amounts are blank, not invalid and not zero"; `encodingRefinements.test.mjs` › "pending-change detection compares exact centavos" | None | NOT RUN individually |
| ENC-08 | Consumed receipts are read-only, are never written, and become editable only after Mark Available. (A) | `crossModuleRegression.test.mjs` › "ENC-1: every field of a Consumed receipt is read-only"; `savePerformance.test.mjs` › "B11/B12: Consumed receipts and blank placeholders are never written" | The disabled fields were not asserted before this checkpoint. | NOT RUN |
| ENC-09 | A failure after K of N writes shows K of N, keeps only confirmed rows clean, and a retry does not duplicate. (A) | `savePerformance.test.mjs` › "B08: a failure after K of N writes" | None | not individually observed |
| ENC-10 | A value typed during a save is never marked saved; sign-out and row removal during a save are safe. (A) | `savePerformance.test.mjs` › "B10: a value typed into a receipt while it is being saved"; `savePerformance.test.mjs` › "R3: a receipt removed while its own write is in flight" | None | not individually observed |
| ENC-11 | A create whose answer is lost is reconciled explicitly and never inserted twice or linked to a Consumed receipt. (A) | `savePerformance.test.mjs` › "R1: a create whose answer is lost after the insert committed"; `savePerformance.test.mjs` › "R1 follow-up (b): a committed create that another session has since marked Consumed" | Fault injection is automated only; the Product Owner did not manually reproduce uncertain-create network failures. | NOT RUN |
| ENC-12 | An OCR scan that fills a receipt updates its unsaved flag and count. (A) | `encodingSelectionUx.test.mjs` › "R1b: an OCR scan that fills a clean saved receipt flags it" | Automated only. **Manual A7 is DEFERRED to Epic 4 and is not PASS.** | DEFERRED (Epic 4) |
| ENC-13 | 400 genuinely new receipts are each created once, with progress out of 400. (A) | `savePerformance.test.mjs` › "B05: 400 new valid receipts are all created once each" | Correctness only. New-receipt writes remain sequential; batching and concurrency are **deferred to later**, outside this checkpoint, and not automatically PASS. | DEFERRED (later) |
| ENC-14 | A Consumed receipt is deleted only after a destructive confirmation and a confirmed database result. (A) | `consumedDeletion.test.mjs` › "a confirmed Consumed deletion warns it is permanent" | None | NOT RUN |

### 3.3 Receipt Optimization and Manual Selection

| ID | Expected result | Automated evidence | Gap / disposition | Live PO UAT |
|---|---|---|---|---|
| OPT-01 | Only saved Available receipts are eligible; Consumed, unsaved and unknown-status receipts never are. (A) | `receiptLifecycle.test.mjs` › "optimizer eligibility remains Available-only even when Consumed or All is viewed"; `receiptStatusBoundary.test.mjs` › "R04-B: consumed, pending, archived, empty, null and undefined database statuses can never enter Manual Selection" | None | NOT RUN |
| OPT-02 | Search, store, date and sort changes never change the manual selection or its export order. (A) | `manualExport.test.mjs` › "C: the selection survives search, store, date and sort changes"; `manualExport.test.mjs` › "C: changing the sort never changes the manual export order" | None | Issue #22 UAT: B1-B7 PASS |
| OPT-03 | The selection cap is 100 and Select Shown fills only the remaining capacity in visible order. (A) | `manualSelection.test.mjs` › "the 100-receipt limit"; `encodingSelectionUx.test.mjs` › "B2: Select Shown follows the current visible sort order"; `encodingSelectionUx.test.mjs` › "B1: nothing exceeds 100 unique saved Available ids" | None | Issue #22 UAT: B1-B7 PASS |
| OPT-04 | Best Match and Manual Selection keep independent selections and arrangements. (A) | `arrangementIsolation.test.mjs` › "R01: the manual arrangement survives switching to Best Match"; `arrangementIsolation.test.mjs` › "R01: each mode exports its own confirmed order" | None | NOT RUN |
| OPT-05 | Review is snapshot-checked: a changed, deleted or Consumed receipt blocks the export and nothing is generated or consumed. (A) | `receiptExport.test.mjs` › "a change between Snapshot A and Snapshot B blocks the export"; `manualExport.test.mjs` › "F: a receipt Consumed in another session blocks the export"; `manualExport.test.mjs` › "F: a receipt deleted in another session blocks the export" | None | NOT RUN |
| OPT-06 | A double click exports once and downloads once. (A) | `manualExport.test.mjs` › "F: a double click on confirm exports once"; `receiptExportIntegrity.test.mjs` › "P: a double click on Export Selected and on the confirmation starts one review and one export" | None | NOT RUN |
| OPT-07 | The workbook keeps the official A:O mapping and the exact confirmed order. (A) | `exportService.test.mjs` › "Expense Detailed Report staging rows preserve the exact A:O mapping"; `manualExport.test.mjs` › "E: the confirmed order is the workbook order"; `reviewArrange.test.mjs` › "M, O, P: the confirmed order decides the workbook order" | The workbook is built in memory by the vendored SheetJS; opening it in Excel is a live check. | NOT RUN |
| OPT-08 | Only exported receipts become Consumed, and they leave the Best Match pool. (A) | `manualExport.test.mjs` › "F: a successful manual export consumes exactly the confirmed receipts"; `crossModuleRegression.test.mjs` › "OPT-2: after a Best Match export" | The Best Match pool follow-up was not asserted before this checkpoint. | NOT RUN |
| OPT-09 | Through the receipt UI, PHP 50.00 of excess is accepted, PHP 50.01 is not, Do Not Exceed is strict, and calculating writes nothing. (A) | `crossModuleRegression.test.mjs` › "OPT-1: through Receipt Optimization"; `optimizationService.test.mjs` › "exact target, one-cent excess and inclusive PHP 50 maximum are eligible" | The UI-level boundary was not asserted before this checkpoint. | NOT RUN |
| OPT-10 | A status update that fails after the workbook is reported as uncertain, and a retry is verified first. (A) | `receiptExportIntegrity.test.mjs` › "N: a failed status update after the workbook explains the uncertainty"; `manualExport.test.mjs` › "F: generation failure consumes nothing" | None | NOT RUN |
| OPT-11 | More than 32 Available receipts calculate for all three strategies; a result that needs receipt #33 is found, reviewed, exported and Consumed exactly. (A) | `poolOptimizationUi.test.mjs` › "33 Available receipts calculate for every strategy"; `poolOptimization.test.mjs` › "receipt #33 (index 32) is chosen when it is the only correct answer, for every strategy" | Fake-backend only. | Issue #29: PO retest of check #8 pending |
| OPT-12 | Pools of up to 32 receipts return exactly what the unchanged engine returns, and the engine still refuses 33. (A) | `poolOptimization.test.mjs` › "pools of up to 32 receipts are delegated to the existing engine"; `poolOptimization.test.mjs` › "the engine itself is untouched: it still refuses 33 receipts"; `poolOptimizationUi.test.mjs` › "pools of up to 32 receipts still calculate immediately" | None | NOT RUN |
| OPT-13 | 33-70 receipts equal an independent oracle for every strategy, with targets below, at and above the pool, PHP 50.00 / 50.01 boundaries, duplicates, zeros and gcd scaling; padded pools equal the engine. (A) | `poolOptimization.test.mjs` › "33 to 70 receipts agree with the independent oracle for all three strategies"; `poolOptimization.test.mjs` › "a pool of up to 32 receipts padded with unusable receipts"; `poolOptimization.test.mjs` › "PHP 50.00 of excess is accepted and PHP 50.01 is excluded in a pool of 40 receipts"; `poolOptimization.test.mjs` › "the gcd scaling never moves a centavo boundary"; `poolOptimization.test.mjs` › "duplicate amounts keep distinct identities and the lowest indexes win ties" | The oracle only reaches pools whose totals are small; larger pools are checked for internal consistency (sum, order, range), not against an oracle. | NOT RUN |
| OPT-14 | High-target fast paths are exact: a pool at or below the target takes every positive receipt, and Fewest below the pool total is the omitted-receipt problem (at most PHP 50 omitted). (A) | `poolOptimization.test.mjs` › "target above the pool: Closest and Do Not Exceed take every positive receipt immediately"; `poolOptimization.test.mjs` › "Fewest below the pool total keeps all but at most PHP 50 of receipts" | A target between half the pool and the pool total is not specially accelerated (a possible later optimization). | NOT RUN |
| OPT-15 | Budgets are enforced for **every** search path (the DP and the Fewest complement table) before any large allocation, with small injected budgets proving it, input is validated like the engine, an allocation failure is a status, and cancel/timeout stop the work with no recommendation. (A) | `poolOptimization.test.mjs` › "budget preflight refuses oversized pools before allocating anything large"; `poolOptimization.test.mjs` › "R1: the Fewest complement path honours every budget"; `poolOptimizerClient.test.mjs` › "R1: a complement-path pool over a (small, injected) budget is refused"; `poolOptimizerClient.test.mjs` › "R1: a complement problem above the cheap ceiling runs in the Worker"; `poolOptimizationUi.test.mjs` › "R1: through the page, a complement-path pool over a small budget"; `poolOptimization.test.mjs` › "invalid input is rejected like the engine does"; `poolOptimization.test.mjs` › "an allocation failure becomes an over-budget status instead of a crash"; `poolOptimization.test.mjs` › "cancellation and timeout stop the calculation without a recommendation" | Budgets are provisional ceilings, not a latency guarantee. | NOT RUN |
| OPT-16 | Over budget shows the exact no-recommendation wording, changes nothing and never suggests exporting to shrink the pool. (A) | `poolOptimizationUi.test.mjs` › "an over-budget pool says no recommendation can be computed safely" | None | NOT RUN |
| OPT-17 | The page shows busy state, progress and Cancel; Cancel, edits, target/strategy changes, a newer calculation, sign-out, an account switch and leaving the module stop a run, and no late answer is applied or announced. (A) | `poolOptimizationUi.test.mjs` › "while a long pool calculates the page shows busy state"; `poolOptimizationUi.test.mjs` › "Cancel stops the calculation, says so"; `poolOptimizationUi.test.mjs` › "editing a receipt amount during the calculation stops it"; `poolOptimizationUi.test.mjs` › "signing out stops the calculation and a late answer never appears"; `poolOptimizationUi.test.mjs` › "switching straight to another account stops the calculation silently"; `poolOptimizationUi.test.mjs` › "leaving Receipt Optimization for another module stops the calculation"; `poolOptimizationUi.test.mjs` › "a pool change that bypasses the input events"; `poolOptimizationUi.test.mjs` › "R2: typing in the Store field"; `poolOptimizationUi.test.mjs` › "R2: a metadata-only correction saved through the Edit dialog"; `poolOptimizationUi.test.mjs` › "R2: every workbook field, and the raw amount text"; `poolOptimizationUi.test.mjs` › "R4: switching from Receipt Optimization to Encoding stops the calculation" | Uses an injected runner and a stand-in Worker. | NOT RUN |
| OPT-18 | The Worker runs from a sub-path, the start message carries only amounts, errors and a silent Worker end safely, and the progress markup is accessible. (A, S) | `poolOptimizerClient.test.mjs` › "the Worker URL is resolved next to the page module"; `poolOptimizerClient.test.mjs` › "a long pool runs in a Worker: the start message carries only amounts"; `poolOptimizerClient.test.mjs` › "the watchdog stops a Worker that never answers"; `poolOptimizerClient.test.mjs` › "the progress block is accessible markup" | The real Worker was verified once in a Chromium harness served under a /FSresibo/ path (see section 10), not in the full app on GitHub Pages. | NOT RUN |
| OPT-19 | The long-pool result uses the unchanged review, snapshot and Consumed rules, and unsaved edited amounts never export. (A) | `poolOptimizationUi.test.mjs` › "a long-pool result goes through the same review, snapshot checks"; `poolOptimizationUi.test.mjs` › "unsaved edited amounts may take part in a long-pool calculation" | None | NOT RUN |
| OPT-20 | Mobile-browser performance and memory of the long-pool search. | none | **NOT RUN.** No physical device was available. Desktop figures are in section 10 and must not be read as mobile evidence. | NOT RUN |
| OPT-21 | A pool in which no positive receipt can take part is an exact finite "nothing qualifies" for every strategy: no NaN plan, no Worker, no recommendation, receipts untouched. (A) | `poolOptimization.test.mjs` › "R3: when no positive receipt can take part the plan is an exact finite"; `poolOptimizerClient.test.mjs` › "R3: a pool with no eligible receipt is answered directly"; `poolOptimizationUi.test.mjs` › "R3: more than 32 receipts of which none can take part" | None | NOT RUN |

### 3.4 Monthly Filing

| ID | Expected result | Automated evidence | Gap / disposition | Live PO UAT |
|---|---|---|---|---|
| MON-01 | Active and Archived are separate views of one table, with accurate counts. (A) | `monthlyFilingUi.test.mjs` › "Active and Archived views partition one Monthly Filing record set" | None | Milestone 3.5: documented as passed |
| MON-02 | Export saves first, builds the workbook from the exact saved snapshot, then archives exactly those ids. (A) | `monthlyFilingWorkspace.test.mjs` › "Export saves first, then generates the workbook from the exact saved snapshot" | None | as above |
| MON-03 | The workbook reflects stored (normalized) amounts, with the Item No. matching the on-screen number. (A) | `monthlyFilingWorkspace.test.mjs` › "the Monthly workbook is built from the saved (normalized) records"; `monthlyFilingWorkspace.test.mjs` › "C2-01/D-09: displayed numbers equal the workbook Item No." | None | as above |
| MON-04 | Return to Active, correction and re-export work, and numbering restarts correctly. (A) | `monthlyFilingWorkspace.test.mjs` › "Return to Active asks first, switches tabs"; `monthlyFilingWorkspace.test.mjs` › "C2-01: Save keeps the order and numbers; multiple export cycles restart at 1" | None | as above |
| MON-05 | Clear Archived preserves Active receipts and drafts; Clear All is a deliberate full reset. (A) | `monthlyFilingUi.test.mjs` › "clear Archived local-state transition preserves Active drafts"; `monthlyFilingWorkspace.test.mjs` › "Clear Archived and Clear All keep their destructive confirmations" | None | as above |
| MON-06 | Drafts survive switching between Active and Archived. (A) | `monthlyFilingUi.test.mjs` › "draft values retained in the Active local record survive a tab view change" | None | as above |
| MON-07 | Monthly Filing never reads or writes the long-term receipt domain. (S) | `monthlyFilingService.test.mjs` › "Monthly Filing service stays isolated from long-term receipts" | Source-text isolation, not a hosted check. | as above |
| MON-08 | Workbook failure archives nothing; archive failure is explicit and blocks a second export. (A) | `monthlyFilingWorkspace.test.mjs` › "Export stops when Save fails, when the workbook fails" | None | as above |
| MON-09 | The archive function is exact-set, authenticated and security-invoker. (S) | `monthlyFilingArchiveMigration.test.mjs` › "Monthly Filing archive RPC is exact-set, authenticated, and security-invoker" | Hosted RPC validation is recorded in the Milestone 3.5 notes, not re-run. | as above |

### 3.5 Quick Optimizer

| ID | Expected result | Automated evidence | Gap / disposition | Live PO UAT |
|---|---|---|---|---|
| QUICK-01 | An independent in-memory calculator with a 32-entry cap; entry 33 adds nothing. (A) | `optimizerWorkspace.test.mjs` › "the 33rd amount is rejected atomically"; `quickOptimizerUi.test.mjs` › "all 32 entered rows calculate with distinct identities" | None | PO reported browser tests passed 2026-10-10 (PR #15); mobile not performed |
| QUICK-02 | Up to three ranked results in the engine's exact order. (A) | `quickOptimizerUi.test.mjs` › "UI preserves exact engine order for every strategy"; `optimizationService.test.mjs` › "seeded randomized inputs match independent oracle" | None | as above |
| QUICK-03 | PHP 50.00 of excess is included and PHP 50.01 is excluded. (A) | `optimizationService.test.mjs` › "exact target, one-cent excess and inclusive PHP 50 maximum are eligible"; `quickOptimizerUi.test.mjs` › "UI preserves exact engine order for every strategy" | None | as above |
| QUICK-04 | Fewest Receipts uses the closest-under window, and Do Not Exceed is strict. (A) | `optimizationService.test.mjs` › "Fewest derives its fallback window from global closest-under M"; `optimizationService.test.mjs` › "Do Not Exceed remains strict and returns highest non-zero totals" | None | as above |
| QUICK-05 | Centavo precision is exact through the safe-integer boundary. (A) | `quickOptimizerUi.test.mjs` › "result total, difference, individual amount and breakdown preserve large centavo precision" | None | as above |
| QUICK-06 | State survives navigation and resets on refresh, logout and an account change. (A) | `quickOptimizer.integration.test.mjs` › "hash history and receipt tabs restore visibility without replacing temporary state"; `quickOptimizer.integration.test.mjs` › "actual app bootstrap uses one calculator and clears it on auth events and logout" | None | as above |
| QUICK-07 | It makes no transaction write, storage entry, export or directory call. (A) | `quickOptimizerUi.test.mjs` › "calculator operates when browser storage and network access would throw"; `crossModuleRegression.test.mjs` › "AUTH-6: Quick Optimizer use triggers no" | The no-network claim in a real browser is a live check (Network panel). | as above |

### 3.6 Shared Company Store Directory

| ID | Expected result | Automated evidence | Gap / disposition | Live PO UAT |
|---|---|---|---|---|
| DIR-01 | Matching normalizes case and spacing, and branches with a different address or TIN stay distinct. (A) | `storeAutocomplete.test.mjs` › "separate address or TIN branches remain distinct suggestions"; `sharedStoreAdoption.test.mjs` › "TIN matching is digits-only while addresses remain conservative" | None | Milestone 3.3: documented as passed |
| DIR-02 | Contribution is explicit, and conflicting or ambiguous entries never overwrite canonical data. (A) | `sharedStorePostSave.test.mjs` › "ambiguous Company profiles do not prompt or insert"; `sharedStoreService.test.mjs` › "shared-store contribution inserts without overwriting and exposes duplicate conflicts" | None | as above |
| DIR-03 | An interrupted save keeps the prompt fingerprint and loses no directory decision. (A) | `sharedStorePostSave.test.mjs` › "an aborted batch preserves the prior prompt fingerprint" | None | as above |
| DIR-04 | Transactions keep their own store snapshot; selecting a profile never rewrites canonical data. (A) | `monthlyFilingUi.test.mjs` › "Company profile selection copies a transaction snapshot and retains sharedStoreId"; `sharedStoreAdoption.test.mjs` › "shared selection copies an exact snapshot and clears stale blank fields" | None | as above |
| DIR-05 | Another account sees contributed stores; receipt data stays user-specific. (S) | `sharedStoreMigration.test.mjs` › "shared-store migration enables restrictive RLS and grants only active reads plus owned active contributions"; `sharedStoreService.test.mjs` › "shared-store service remains isolated from receipt persistence" | Cross-user visibility is server behavior. **No two-account hosted run was made for this checkpoint.** | NOT RUN |
| DIR-06 | Live new-contribution and cross-account directory visibility. | none | **DEFERRED / NOT RUN on the shared company project.** `public.shared_store_directory` is a company-wide canonical table and the app offers no user delete or deactivate (`sharedStoreService.js` exports list and contribute only). A test contribution would be a durable dummy profile visible to colleagues, and deleting a test receipt does not remove it. Run only on an isolated throwaway Supabase staging project, or with an administrator-approved disposable profile and cleanup procedure. On the shared project the PO checklist tests existing permitted profiles and that declining contribution adds nothing to the shared directory (a new store still appears as the same account's personal receipt-history suggestion; that is expected, covered by `sharedStoreAdoption.test.mjs` › "shared profiles precede history fallbacks and equivalent history is removed", and is not evidence of a directory entry). | DEFERRED unless a safe setup exists |

### 3.7 UI, accessibility and operation

| ID | Expected result | Automated evidence | Gap / disposition | Live PO UAT |
|---|---|---|---|---|
| UI-01 | Dialogs trap and restore focus; Escape closes only the top dialog. (A) | `modalFocus.test.mjs` › "Tab and Shift+Tab wrap inside the open dialog and never leave it"; `stackedDialogEscape.test.mjs` › "Escape on a confirmation above Edit Receipt closes only the confirmation" | None | NOT RUN |
| UI-02 | Light, dark and system themes meet contrast rules and persist locally. (S, A) | `accessibilityStyles.test.mjs` › "filled controls meet AA text contrast in both themes"; `themeAndIdentity.test.mjs` › "System theme follows OS changes and explicit preference persists locally" | Computed from tokens, not measured on a rendered page. | NOT RUN |
| UI-03 | The action bar is sticky on tall windows and static on short ones; phones get a sticky bar. (S) | `encodingRefinements.test.mjs` › "the one action bar is sticky-top on tall desktop and tablet windows"; `monthlyFilingWorkspace.test.mjs` › "the phone action bar is the same element, sticky only on phones" | Stylesheet assertions only. | NOT RUN |
| UI-04 | Status and unsaved changes are announced politely, and save progress is visible. (S, A) | `encodingRefinements.test.mjs` › "the unsaved indicator is announced through a polite status region"; `savePerformance.test.mjs` › "B01: 400 clean saved receipts, only #399 edited" | Real screen-reader behavior is untested. | Progress indicator praised in Issue #24 UAT |
| UI-05 | Keyboard shortcuts and tab keyboard behavior work and never intercept Tab. (A) | `keyboardEncoding.test.mjs` › "07, 08: Ctrl+S runs the existing Save changes workflow"; `tablistKeyboard.test.mjs` › "arrow keys wrap, Home and End jump, other keys are ignored" | None | NOT RUN |
| UI-06 | The phone drawer contains focus and releases the page. (A) | `applicationShell.test.mjs` › "Tab and Shift+Tab stay inside the open phone drawer" | None | NOT RUN |
| UI-07 | Review reordering works by keyboard, pointer and touch long-press. (A) | `reviewArrange.test.mjs` › "D, E: ArrowUp and ArrowDown move one place"; `pointerReorder.test.mjs` › "J: touch needs a deliberate long press" | None | NOT RUN |
| UI-08 | No horizontal overflow on narrow screens, large zoom or large labels. | none | **Gap:** layout cannot be measured without a real browser. Covered by the Product Owner checklist only. | NOT RUN |

### 3.8 Security and persistence

| ID | Expected result | Automated evidence | Gap / disposition | Live PO UAT |
|---|---|---|---|---|
| SEC-01 | Every table enables row level security, nothing is granted to anon, and every policy is owner-scoped or an active shared-profile read. (S) | `crossModuleRegression.test.mjs` › "SEC-1: every table created by the migrations enables row level security" | Migration 001 (receipts) had no static test before this checkpoint. | NOT RUN |
| SEC-02 | No migration defines a privileged (security definer) function. (S) | `crossModuleRegression.test.mjs` › "SEC-2: no migration defines a privileged" | None | NOT RUN |
| SEC-03 | Monthly Filing and shared-store migrations keep owner or active-read access. (S) | `monthlyFilingMigration.test.mjs` › "Monthly Filing migration provides authenticated ownership CRUD and no broad anon grant"; `sharedStoreMigration.test.mjs` › "shared-store migration creates a normalized company reference table with quality and duplicate protections" | None | NOT RUN |
| SEC-04 | A malformed non-blank amount can never become NULL or zero in either service. (A) | `moneyAmount.test.mjs` › "no malformed non-blank amount can silently become NULL or zero in either service" | None | NOT RUN |
| SEC-05 | Cross-user transaction separation holds on the hosted database. | none for this build | **Unverified for this build.** `01_Architecture.md` records live two-user RLS validation at Milestones 3.4 and 3.5; no artifact is stored in the repository and it was not re-run on the current UAT build. | NOT RUN |
| SEC-06 | No unintended public sign-up. | none | The sign-up form is hidden markup and no control opens it (static observation). Whether Supabase refuses a direct sign-up call is a server setting that cannot be verified from the repository. **Unverified; CP10-C4.** | NOT RUN |

### 3.9 Deployment and release discipline

| ID | Expected result | Evidence | Gap / disposition |
|---|---|---|---|
| REL-01 | `node --test tests/*.test.mjs` passes, and `node-tests` is green on the exact PR head. (H) | Baseline above; final run recorded in the PR | The PR records the SHA and run id. |
| REL-02 | The UAT branch is protected: pull request required, `node-tests` required, no force push or deletion, no bypass actor. (H) | Ruleset `25738688`, read back and exercised in Issue #20 (scratch PR #21 blocked, then cleared) | Direct pushes and force pushes were not attempted; the ruleset read-back is the evidence. Zero approvals are required, so human review is process, not enforced by GitHub. |
| REL-03 | The UAT build deployed to GitHub Pages. (H) | "pages build and deployment" run `40074968959`, success, head `2b1268c` | None |
| REL-04 | The version stays `3.6.0-beta.1`. (A) | `applicationShell.test.mjs` › "the official display name comes from the one metadata value and the version is unchanged" | No version bump in this checkpoint. |
| REL-05 | UAT compared with `main`, nothing merged. (H) | `main` is at `cfd8dff` (PR #15 merge); UAT is 45 commits ahead and 0 behind | `main` is untouched. No production release is authorized. |

## 4. Approved deferments

| Item | Deferred to | Status |
|---|---|---|
| Manual OCR dirty-indicator test **A7** (Issue #22) | Epic 4, OCR Improvements | **DEFERRED, not PASS.** Automated coverage exists (ENC-12). |
| 400 genuinely new receipts / bulk-save optimization | Later, with new approval | **DEFERRED, not PASS.** Sequential creates are unchanged (ENC-13). |

## 5. Accepted work, missing manual evidence, and release readiness

These are three different things and must not be merged into one claim.

| Work | Accepted for development/UAT | Missing manual evidence | Production release |
|---|---|---|---|
| Milestone 3.6 Quick Optimizer and PHP 50 rules | Source merged to `main` by PR #15 (2026-10-10). Product Owner reported browser tests passed the same day. | Mobile device validation was **not performed**; assistive-technology and mobile performance checks are not recorded; the tested browser/device and deployment were not recorded. | Not authorized. |
| U01-A, Issue #22 (PR #23) | Accepted by the Product Owner: 18 PASS, 0 FAIL, 1 DEFERRED (A7). | A7 (OCR). | Not authorized. |
| U01-B, Issue #24 (PR #25) | Product Owner reported UAT **PASS** and praised the save-progress indicator. This is milestone-level acceptance, not item-by-item certification. | Uncertain-create fault injection, 400-new-receipt behavior and other edge cases were not individually observed. | Not authorized. |
| This checkpoint, Issue #26 | Merged (PR #28). Product Owner reported 13 of 14 mandatory checks PASS; **check #8 FAIL** (more than 32 receipts). | Check #8 retest after Issue #29 is deployed; 11b and OCR A7 stay deferred. | Not authorized. |
| Large-pool Receipt Optimization, Issue #29 | In review. Not accepted. | Product Owner retest of check #8; real mobile-device performance (**NOT RUN**). | Not authorized. |

Open authentication items (AUTH-02, SEC-06) and the Monthly Filing session defect (Issue #27) may block promotion to `main` even if this checkpoint is accepted. Issue #27 is recommended as a **production-release blocker** (section 6).

## 6. Defects found by this checkpoint

| Issue | Summary | Status |
|---|---|---|
| [#27](https://github.com/APNfsautomation/FSresibo/issues/27) | Monthly Filing save, export and load are not session-scoped. A signed-out account's late answer can replace the next account's receipts on screen, so **a previous user's Monthly Filing financial data appears inside the next user's authenticated screen**, and it keeps that account's Save disabled. Receipt Encoding saves do not have this problem (Issue #24). Database writes stay user-scoped by RLS, so this is a confidentiality and integrity problem of the screen, not cross-account database writes. | **Recommended severity: HIGH. Must be fixed before any `main` promotion or broad shared-browser rollout**, subject to Product Owner triage. Not fixed here. Reproduced by the three failing `todo` tests AUTH-7, AUTH-8 and AUTH-9. Rare timing does not make the exposure trivial. |

**Safety workaround until fixed:** Until it is fixed, do not switch accounts while a Monthly Filing save, export or load is still running, and reload the page before trusting a view after an account switch.

Observations, not defects claimed:

- On a `PASSWORD_RECOVERY` event `app.js` clears only the workspace composition (Quick Optimizer); receipt and Monthly Filing state is cleared on the following sign-out. The application view is hidden meanwhile and sign-in events are ignored (AUTH-5), so nothing is shown. Recorded for CP10-C4 review of the recovery flow.
- **Overlapping activation is unverified (AUTH-10).** Whether Receipt Encoding's `loadForUser`, or the `app.js` activation as a whole, shows account A's data to account B when A's load is still running at the switch has not been tested: the receipt fixture has no load gate and no test holds A's load open. Treat it as a potential follow-up to Issue #27, not as assured safe and not as a confirmed bug.

## 7. CP10-C4 queue (unresolved, not resolved by this checkpoint)

1. **Confirmation link redirect.** Confirmation emails reached an obsolete Synology `192.168.0.94` address. Requires Supabase Auth URL configuration and a live functional retest (AUTH-02).
2. **Password-reset flow.** Recovery links entered the app without showing a reset form. Requires a live functional retest (AUTH-02). Unit tests cover only link recognition and the expired/invalid state.
3. **Public sign-up.** Confirm hosted sign-up is disabled for direct API calls (SEC-06).
4. **Dependency pinning and security.** Runtime dependencies are loaded from CDNs at floating versions with no integrity attribute: the Supabase client from `esm.sh/@supabase/supabase-js@2` (`config/supabase.js`) and Tesseract.js from `cdn.jsdelivr.net/npm/tesseract.js@5` (`index.html`). SheetJS is vendored at a pinned version. Pinning and subresource integrity need a scoped decision.
5. **Monthly Filing session isolation** (Issue #27), recommended HIGH and a release blocker, together with a probe of overlapping activation for Receipt Encoding (AUTH-10).
6. **Pre-production data reset and maintenance runbook** (already a release gate in `01_Architecture.md`).

## 8. Reconciliation of historical issues

Status by evidence only. Nothing is closed by this checkpoint; closing is a separate administrative step.

| Issue | Evidence | Observed state |
|---|---|---|
| #16 AI integration test | Read-only receipt comment posted | Purpose met; open |
| #17 AI workflow protocol | Protocol assessment posted; the workflow has since been exercised by #18, #20, #22, #24 and #26 | Pilot effectively complete; open |
| #18 CI pilot | PR #19 merged; `node-tests` ran on every later PR | Complete; open |
| #20 UAT branch protection | Ruleset `25738688` active; enforcement exercised with scratch PR #21 (closed, unmerged) | Complete; open |

## 9. Source and evidence map

| Claim | Source |
|---|---|
| Milestone 3.6 source is on `main` | PR #15, merged 2026-10-10, `main` at `cfd8dff`; PR text records the Product Owner's browser-test report and that mobile was not performed |
| Epic 2 and Epic 3 Milestones 3.1-3.5 merged | PRs #1-#14, all merged to `main` (#7 is the receipt-delete hotfix, #8 the Epic 3 documentation alignment); migrations 003 and 004 and their live validation are recorded in `01_Architecture.md` |
| UAT branch workflow, CI and ruleset | Issues #17, #18, #20; PRs #19, #21; ruleset `25738688` |
| U01-A accepted, A7 deferred | Issue #22 comments of 2026-10-24; PR #23, merge `3b6ad03` |
| U01-B accepted at milestone level | Issue #24 comments of 2026-10-24; PR #25, merge `2b1268c`; hosted tests run `40074662952` (731 pass); Pages run `40074968959` |
| UAT is 45 commits ahead of `main` | `git rev-list --count origin/main..origin/claude/ui-ux-refinement` at `2b1268c` |
| GitHub Pages serves the UAT branch | Issue #17 comment; Pages run `40074968959` on `claude/ui-ux-refinement` |
| Which Pages URL is "production" | Not recorded in the repository. Product Owner to confirm before any `main` release. |

## 10. Large-pool Receipt Optimization: measured evidence (Issue #29)

Reproduce with `node --expose-gc tests/benchmarks/poolOptimization.benchmark.mjs [--full]`. **Machine:** Intel Core i7-14700HX (28 logical CPUs), 32 GB, Windows 11, Node v24.19.0 (V8). One run per cell; "buffers" is the peak of `process.memoryUsage().arrayBuffers` during the run (typed arrays dominate) and "predicted" is the preflight estimate that the budget uses. Targets are in PHP; every row is a genuine search (a target above half the pool is not benchmarked here, and above the pool is a fast path). All three strategies are within a few percent of each other; the figures below are Closest.

| Pool (typical: PHP 50-3,000, arbitrary centavos) | Target | Time | Predicted | Measured buffers |
|---|---|---|---|---|
| 33 receipts | 5,000 | 40 ms | 11 MiB | 3 MiB |
| 64 receipts | 20,000 | 414 ms | 29 MiB | 16 MiB |
| 100 receipts | 20,000 | 679 ms | 39 MiB | 22 MiB |
| 200 receipts | 20,000 | 1.27 s | 65 MiB | 40 MiB |
| 400 receipts | 5,000 | 523 ms | 36 MiB | 1 MiB |
| 400 receipts | 20,000 | 2.43 s | 118 MiB | 100 MiB |

- **Other distributions at 400 receipts / PHP 20,000:** duplicate-heavy 2.5 s, large receipts (PHP 500-20,000) 1.5 s, whole-peso amounts **20 ms** (the gcd shrinks the table 100 times). Process peak resident set over the whole default run was 153 MiB.
- **High targets:** a target above the pool takes no search (about 0 ms, Closest and Do Not Exceed take every positive receipt; Fewest uses the PHP 50 omitted-receipt table). 400 large receipts with a target of half the pool were refused by the preflight in under a millisecond with no allocation.
- **Cost model:** about 3 ns per cell, cells = kept receipts × sum range in gcd units, with memory about cells / 8 bytes. The slowest default-grid row was 2.5 s; the budget ceilings (1.5e9 cells, 256 MiB) correspond to roughly 5 s on this machine, which is not a latency promise on any other device. The `--full` grid adds PHP 100,000 targets (about 9-12 s and about 0.5 GB at 400 receipts, which the budget refuses).
- **Real browser, not the full app:** the real client, module Worker and solver were loaded from a local server under a `/FSresibo/` path in Chromium 152 (Claude desktop app, same machine). The 33-receipt case found receipt #33 in 22 ms; 400 receipts / PHP 20,000 took 2.9 s with 667 animation frames rendered (one 69 ms gap while the Worker module loaded) and about 28 progress messages; cancel returned after 300 ms; a 400 ms timeout safeguard fired at 412 ms; an over-budget pool was refused immediately. This is a scratch-harness measurement: it is not the signed-in app, not GitHub Pages, and not a mobile device.
- **Not measured:** mobile browsers, other desktop browsers, repeated-run variance, the full app's Supabase-backed flow. Mobile performance is **NOT RUN**; no phone-speed multiple is assumed.
