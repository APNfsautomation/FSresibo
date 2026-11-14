# Issue #64 — Receipt On Hold: UAT acceptance and rollout controls

**Status:** feature candidate. Application and SQL changes require independent CI review.
**Production stays v3.7.1; no production database changes are authorized.**
**Transfer remains blocked pending product-owner planning (Issue #61).**

## Approved function
- A saved Available receipt can be placed **On Hold** while awaiting approval, then **released** once approved.
- Held receipts still appear as Available and remain viewable/editable. Available count and total include them. They have a warning-style **On Hold** badge in Encoding and Optimization.
- Hold excludes that receipt from **Best Match**, **Manual Selection / Select Shown**, **review**, **export** and future Transfer. This is not just hiding the receipt with a filter.
- Users must save any local unsaved edits before toggling Hold. Hold is a distinct persisted boolean, not a new lifecycle enum value.
- Encoding's collapsible filter panel adds **Approval status → All / On Hold / Not On Hold**. Filters remain display-only and do not limit the optimizer.
- No bulk Hold, approval workflow, notifications, transfer, batch grouping, or changes to Monthly Filing in this milestone.

## Database and security gate — UAT ONLY
1. Confirm the destination is the isolated **FSResibo UAT** Supabase project `wnudewolpouussjtblis`, **never** production `ilinpznoawvsplkhjaqr`.
2. Obtain specific Product Owner approval to execute `supabase/migrations/006_add_receipt_on_hold.sql` against **UAT only**. Apply it **before** deploying the new UAT browser code. Do not mistake committing the SQL file for applying the migration.
3. Verify `is_on_hold` exists, is NOT NULL with default false, and existing rows have false; verify the CHECK, trigger, and `consume_receipts_available_unheld(uuid[])` INVOKER RPC have expected grants.
4. Perform an isolated two-account test: user A can toggle own receipt; cannot toggle B's receipt; no unauthorized SELECT or ownership change. Test direct malicious REST update trying to consume an On-Hold receipt, including attempting `is_on_hold=false,status=consumed` simultaneously; database must refuse without mutation.
5. Verify exact-set RPC all-or-none with one held receipt and one ordinary receipt; validate concurrent Hold vs consumption and reset/restore behavior; keep UAT synthetic records isolated.
6. No schema release to production until separate backup, reviewed exact SQL, incident/rollback analysis, UAT PASS and explicit PO release authorization.

## Application UAT
- New saved Available receipt is initially **not held**; old records remain unchanged.
- On Hold button works for a saved receipt, with badge and feedback; a draft has no actionable Hold button.
- Existing unsaved typed fields are not lost by Hold; Save first, then toggle.
- On-Hold receipt remains in Available totals, Encoding and Optimization browsers, but is never in Best Match results and has a disabled Manual Selection checkbox.
- Select Shown skips held receipts, and holding a manually selected receipt removes it from the selection (visible explanation).
- Previously calculated Best Match result is invalidated after a Hold change.
- Filter by On Hold/Not On Hold; clear filters; verify existing Encoding filters from Issue #62 are unchanged.
- With another session applying Hold during export review, the next snapshot blocks before the workbook.
- With concurrent Hold after workbook creation but before consumption, the database refuses the batch with **no partial Consumed rows**, and the app informs the user that the workbook may exist.
- Release Hold restores eligibility without changing receipt details.
- Check desktop, mobile/keyboard, screen-reader accessible badge/label, account switching, 41 classifications, both old and new receipts.
- Monthly Filing export/archive behavior is unchanged.

## Existing risk
Current workflow creates the workbook before consuming receipts. This feature's atomic RPC prevents *partial consumption*, but a failed consumption can still leave an already downloaded workbook. The app must warn and require a new status check; a true atomic workbook-download + database transaction is not possible from a browser alone.

**No browser UAT is considered passed until the Product Owner reports results.**
