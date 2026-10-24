# Product Owner Integration UAT Checklist (CP10-C3E-5)

Build: `FSResibo v3.6.0-beta.1` on the UAT deployment. Record the deployed commit below. This is a **focused sample of 15 end-to-end checks (plus the optional 8b and the deferred 11b)**, not a repeat of the 700+ automated tests or of earlier accepted UAT. Automated tests do not fill in any status here.

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
- **The Shared Company Store Directory is not disposable data.** It is a company-wide master table with no user delete or deactivate, and deleting a `UAT-` receipt does **not** delete its directory entry. On the existing shared company project **never create a new directory profile** as part of this checklist. Decline every Company Directory contribution prompt unless you are on an isolated throwaway staging project or an administrator has approved a disposable profile and its cleanup.
- **Two kinds of store suggestion exist; do not confuse them.** A *shared Company Directory* entry is the company-wide master record. A *personal receipt-history* suggestion is built from the signed-in account's own saved receipts, so a store you saved on a receipt is legitimately suggested to **that account** again, even after a reload and even after you declined the directory prompt. A history suggestion is **not** evidence that a directory entry was created, and its absence for another account is not evidence that nothing was contributed.
- **Account switching:** until Issue #27 is accepted in the two-account check below, do not switch accounts while a save, export or load is still running, and reload the page before trusting what a switched-to account shows.
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
| 8 | Best Match: PHP 50 rule and strict mode, with more than 32 Available receipts (retest after Issue #29) | Keep **more than 32** Available receipts in the account (this check failed before because of the 32-receipt limit), including `UAT-` receipts that total exactly T plus 50.00 and another set that totals T plus 50.01. Run Closest Match, Fewest Receipts and Do Not Exceed Target. Export one result. | Find best match works with more than 32 receipts and never shows "Please calculate up to 32 receipts". T plus 50.00 is accepted. T plus 50.01 is not offered as a match. Do Not Exceed never offers a total above T. The export workbook and the Consumed change match the result. | | |
| 8b | Large pool: progress, Cancel and the over-budget message | With 33 or more `UAT-` Available receipts, press Find best match, and press Cancel calculation on a pool large enough to show the progress bar. If you have a pool and target large enough to exceed the safe limit (for example 400 receipts of PHP 5,000 and more with a target of PHP 1,000,000), try it. | Calculation works with more than 32 receipts and never shows "Please calculate up to 32 receipts". Progress and Cancel are visible; Cancel says so and produces no recommendation. Over the limit: "Exact result cannot be computed safely with these values on this device; no recommendation was produced." and no receipt changed. | | Optional for the retest; record which pool size you used and the browser or phone. Mobile performance has not been measured. |
| 9 | Monthly Filing lifecycle | Add 3 `UAT-` Active receipts. Press Export & Archive, open the workbook, then open Archived. Return one to Active, correct it, export again. | The first export saves first, then archives exactly the Active ones, and the workbook matches. Return to Active makes it editable. The re-export contains only the corrected one, numbered from 1. | | |
| 10 | Monthly Filing cleanup | With `UAT-` Archived entries and one `UAT-` Active entry, use Clear Archived. Check Receipts. | Archived entries are removed, the Active entry and its draft remain, and **no long-term receipt changed**. | | |
| 11 | Shared directory (safe path) | **Shared company project:** type the name of a store that **already exists** in the directory, in Encoding and then in Monthly Filing, and pick the suggestion. Then enter a **new** `UAT-` store name with an address, save, and when the Company Directory prompt appears **decline it**. | The existing store is suggested in both workflows and fills the fields without changing the directory. After declining, the saved receipt keeps its own store text. **Account A may still see the new `UAT-` store as a personal receipt-history suggestion after a reload; that is correct.** What must not happen is a new shared directory entry: sign in as **B**, who has no receipt with that store name and no earlier history match, type the `UAT-` name, and confirm it is **not** offered to B. Do not use a store name B already has in history or that already exists in the directory (a same-name existing profile proves nothing about a new contribution). | | |
| 11b | Shared directory (new contribution and cross-account visibility) | **Only on an isolated throwaway Supabase staging project, or with an administrator-approved disposable profile and cleanup procedure:** accept the contribution for a new `UAT-` store, then sign in as B and type the name. | B, who has no receipt or history with that store name, is offered the store from the shared directory (not from B's own history) and sees none of A's receipts. A conflicting entry is not silently merged. | **DEFERRED / NOT RUN** unless a safe setup exists | Not run on the shared company project: it would create a durable dummy profile visible to colleagues. |
| 12 | Quick Optimizer | Enter 32 amounts, then try a 33rd. Enter decimals such as `0.10` and `0.20`. Calculate with each strategy. Open DevTools Network and calculate again. | The 33rd is refused with capacity feedback. Totals are exact to the centavo. Ranked options appear and selecting one highlights its rows. Navigation keeps the state. Refresh and logout clear it. The Network panel shows **no requests** caused by calculating. | | |
| 13 | Narrow phone layout | On a phone or a 375px-wide window: open the drawer, use Encoding, Optimization and Monthly Filing, scroll with the action bar visible, switch Light and Dark. | The drawer opens and closes. The sticky action bar stays reachable. **No horizontal scrolling**. Text is readable in both themes. | | |
| 14 | Desktop keyboard and dialogs | On desktop: Ctrl+Enter adds a receipt, Ctrl+S saves, open an export confirmation, press Tab repeatedly, press Escape. | Tab stays inside the dialog. Escape closes only the top dialog. Focus returns to the control that opened it. The saving progress is readable. | | |
| 15 | Two-account switching (Issue #27 retest) | Use two disposable accounts A and B, each with a few `UAT-` Monthly Filing receipts. As A: start **Export & Archive** and, before it finishes (use a throttled network in DevTools, or press Save with several new receipts), sign out and sign in as B. Repeat once with a long **Save**, and once leaving a Company Directory or delete confirmation open when you sign out. Then sign in as A again, and once sign out of A, sign in as B and sign back in as A within a few seconds. Also open Review & Arrange in the Optimization tab as A and sign out before confirming. | B never sees any of A's receipts, totals, messages or prompts; B's Save, Export, Add and Clear buttons work at once; B's own save and export complete normally; A's Review & Arrange dialog is closed (nothing of A is visible or exportable); the last account you signed in as is the one shown; a prompt that was open when you signed out is closed. A's own data is still correct when A signs in again, and no extra download or archive happens for B. A request A had already started before signing out may still complete on the server for A (a workbook already downloaded stays downloaded). | | Disposable accounts only. Note the network throttling used. |

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

Issue #27 (Monthly Filing session isolation, HIGH, production-release blocker) is **fixed in its pull request and automated-tested, but not accepted**: it stays open until the fix is reviewed, merged, deployed and the Product Owner accepts check 15 below. The earlier workaround stays in force until then. Whether Receipt Encoding shows an account's data to the next account during an overlapping activation (AUTH-10) was confirmed by reproduction and fixed in the same pull request; it has no separate live check beyond check 15. The fix cannot recall a request already sent to the database (a workbook already generated, an archive or contribution already requested): its server-side effect stays owner-scoped by RLS.

Whether Receipt Encoding shows an account's data to the next account when a load is still running at the switch (overlapping activation) is **unverified** and is not covered by the automated tests (matrix AUTH-10).

## Result summary

| Mandatory checks | PASS | FAIL | PARTIAL | NOT RUN |
|---|---|---|---|---|
| 1-15 | | | | |

Acceptance of this regression and documentation checkpoint is separate from production release readiness. Open CP10-C4 items may block promotion to `main` even if all fifteen checks pass, and Issue #27 (HIGH, release-blocking) stays open until check 15 passes on the deployed build. Check 8b is optional and check 11b is deferred; neither is counted among the 15. Check 8 was the retest of the check that failed on the 32-receipt limit (accepted); check 15 is the Issue #27 retest.
