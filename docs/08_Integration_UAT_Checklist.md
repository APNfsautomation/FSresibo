# Product Owner Integration UAT Checklist (CP10-C3E-5)

Build: `FSResibo v3.6.0-beta.1` on the UAT deployment. Record the deployed commit below. This is a **focused sample of 14 end-to-end checks**, not a repeat of the 700+ automated tests or of earlier accepted UAT. Automated tests do not fill in any status here.

| Field | Value |
|---|---|
| UAT build commit (SHA) | |
| Browser and version (desktop) | |
| Phone or emulator (for check 13) | |
| Tester / date (Philippines time) | |
| Environment | UAT deployment (GitHub Pages, branch `claude/ui-ux-refinement`) |

**Status:** write `PASS`, `FAIL`, `PARTIAL`, `DEFERRED` or `NOT RUN` in each Status cell. `DEFERRED` and `NOT RUN` are not `PASS`.

## Ground rules

- Use **two test accounts**, called **A** and **B**, and **disposable data only**. Name every disposable receipt with a `UAT-` prefix (for example store `UAT-Alpha`).
- Do not clear, delete or export real long-term receipts or real Monthly Filing entries. Use **Clear Archived** only when every Archived entry is a `UAT-` entry.
- Do not enter real passwords anywhere in test notes. Do not use production accounts for the sign-up or recovery tests (those are in the CP10-C4 section, not this list).
- Results here come from the real Supabase-backed UAT site. The automated suite uses fakes, and its results are kept separately in `07_Regression_Coverage_Matrix.md`.

## Mandatory checks

| # | Check | Steps | Expected result | Status | Evidence / notes |
|---|---|---|---|---|---|
| 1 | Sign-in, reload, logout, re-login | Sign in as A. Open Quick Optimizer and enter a target and two amounts. Reload. Log out and sign in as A again. | After reload the Quick calculator is blank. After re-login you see A's receipts and a blank calculator. The version label reads `v3.6.0-beta.1`. | | |
| 2 | Account isolation | In A: select two receipts in Manual Selection, type an unsaved edit, add a Monthly Filing row, enter a Quick amount. Log out. Sign in as B. | B sees only B's data. None of A's selection, unsaved edit, Monthly rows or Quick amounts appear. Nothing is selected. | | |
| 3 | Encoding: edit one among many, save progress, reload | With at least 20 `UAT-` receipts, edit one. Press Save. | Only that receipt shows `Unsaved changes` before saving. The progress text reads out of **1**, then `Saved 1 receipt`. After a reload the change persists and no other receipt changed. | | |
| 4 | Encoding: no-op save and invalid amount | Press Save with no edits. Then type `2,00.00` in one amount and a valid edit in another, and press Save. | The first says there are no changes and writes nothing. The second saves **nothing**, names the bad receipt, focuses its amount and keeps both typed values. | | |
| 5 | Unsaved flags and Consumed read-only | Edit a receipt, then revert the edit. View Consumed receipts and try to type in one. | The flag appears and then clears when reverted. A Consumed receipt's fields cannot be edited. Mark Available makes it editable again. | | |
| 6 | Manual Selection: sort, filter and cap | With 100 or more `UAT-` Available receipts, filter, sort, then use Select Shown. If fewer than 100 exist, mark the cap part `PARTIAL` and say how many you used. | Select Shown adds only receipts in the visible order, up to 100 total. At 100 no more can be added, and a selected one can still be deselected. | | |
| 7 | Manual export: order and Consumed | Select 3 specific receipts, reorder them in the review dialog, confirm. Open the downloaded `.xlsx`. Restore the Consumed receipts afterwards. | The workbook lists exactly those 3 in the confirmed order, with Item No. 1-3 and the amounts. Only those 3 became Consumed. One download only. | | |
| 8 | Best Match: PHP 50 rule and strict mode | Use `UAT-` receipts that total exactly T plus 50.00, and another set that totals T plus 50.01. Run Closest Match and Do Not Exceed Target. Export one result. | T plus 50.00 is accepted. T plus 50.01 is not offered as a match. Do Not Exceed never offers a total above T. The export workbook and the Consumed change match the result. | | |
| 9 | Monthly Filing lifecycle | Add 3 `UAT-` Active receipts. Press Export & Archive, open the workbook, then open Archived. Return one to Active, correct it, export again. | The first export saves first, then archives exactly the Active ones, and the workbook matches. Return to Active makes it editable. The re-export contains only the corrected one, numbered from 1. | | |
| 10 | Monthly Filing cleanup | With `UAT-` Archived entries and one `UAT-` Active entry, use Clear Archived. Check Receipts. | Archived entries are removed, the Active entry and its draft remain, and **no long-term receipt changed**. | | |
| 11 | Shared directory | In Encoding save a new `UAT-` store with an address, accept the Company Directory prompt. Use the same store in Monthly Filing. Sign in as B and type the store name. | The store is offered in both workflows. A different, conflicting entry is not silently merged. B sees the directory entry but none of A's receipts. | | |
| 12 | Quick Optimizer | Enter 32 amounts, then try a 33rd. Enter decimals such as `0.10` and `0.20`. Calculate with each strategy. Open DevTools Network and calculate again. | The 33rd is refused with capacity feedback. Totals are exact to the centavo. Ranked options appear and selecting one highlights its rows. Navigation keeps the state. Refresh and logout clear it. The Network panel shows **no requests** caused by calculating. | | |
| 13 | Narrow phone layout | On a phone or a 375px-wide window: open the drawer, use Encoding, Optimization and Monthly Filing, scroll with the action bar visible, switch Light and Dark. | The drawer opens and closes. The sticky action bar stays reachable. **No horizontal scrolling**. Text is readable in both themes. | | |
| 14 | Desktop keyboard and dialogs | On desktop: Ctrl+Enter adds a receipt, Ctrl+S saves, open an export confirmation, press Tab repeatedly, press Escape. | Tab stays inside the dialog. Escape closes only the top dialog. Focus returns to the control that opened it. The saving progress is readable. | | |

## Deferred (not part of this phase's mandatory execution)

| Item | Status | Reason |
|---|---|---|
| **A7** Manual OCR dirty-indicator test (Issue #22): scan a receipt and confirm the unsaved flag and count update | **DEFERRED to Epic 4, OCR Improvements** | Approved by the Product Owner for one comprehensive OCR validation cycle. Automated coverage exists. Do not mark PASS. |
| 400 genuinely new receipts and bulk-save optimization | **DEFERRED to later** | Needs a new scope decision and approval. |

## Unresolved authentication items (CP10-C4, not passed)

These are recorded here so they are not forgotten. They need a separate live configuration and functional remediation. **No automated test resolves them.**

| # | Check | Status | Notes |
|---|---|---|---|
| C4-1 | A genuine email **confirmation link** opens the deployed app, not the obsolete Synology `192.168.0.94` address | NOT RUN | Previously observed to fail |
| C4-2 | A genuine **password-recovery link** shows the new-password form and completes a reset | NOT RUN | Previously observed to enter the app without a reset |
| C4-3 | **Public sign-up** is refused by the hosted project | NOT RUN | The app has no visible sign-up control; the server setting is unverified |
| C4-4 | Dependency pinning and integrity for CDN-loaded libraries | NOT RUN | See `07_Regression_Coverage_Matrix.md`, section 7 |

## Known defect (do not use these checks to certify)

Issue #27: a Monthly Filing save, export or load still running when one account signs out can change the next account's screen. It needs a slow or lost network answer, so it is not part of the checklist above. Triage is the Product Owner's decision.

## Result summary

| Mandatory checks | PASS | FAIL | PARTIAL | NOT RUN |
|---|---|---|---|---|
| 1-14 | | | | |

Acceptance of this regression and documentation checkpoint is separate from production release readiness. Open CP10-C4 items and Issue #27 may block promotion to `main` even if all fourteen checks pass.
