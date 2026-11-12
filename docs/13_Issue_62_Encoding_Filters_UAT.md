# FSResibo Issue #62 — Encoding Advanced Filters (first low-risk UAT increment)

Status: **implementation candidate**, separate PO signoff required for a later production release. This document does not authorize a production merge or Supabase change.

## Scope
- Add an Encoding-only search input and a **Show Filter Options / Hide Filter Options** native disclosure panel, collapsed by default.
- Filter by Store, Start/End receipt date, Minimum/Maximum amount, Expense Account, and Classification of Expense (all 41 approved options).
- Show **N of total receipts**, **N active filters**, an inline validation message for inconsistent date/amount bounds, and **Clear filters**.
- The existing **Amount compartment** remains available; Clear filters also sets that compartment to All amounts.
- The shared **Available / Consumed / All** selector remains independent: Clear filters must not change it.
- Changes to Encoding filters are display-only; receipt DOM order and numbering, saved/unsaved values, optimizer candidate pool, manual selection, export and Consumed lifecycle remain unchanged.
- Newly typed/edited rows pinned by existing Encoding behavior may temporarily stay visible outside applied filters, with a visible notice; save/collapse releases the pin as before.
- Search debounce and filter values are account-session-local and are cleared across account switches and logout; panel starts closed each session.
- Reuse the existing Optimization filtering and responsive CSS logic rather than introduce new dependencies.

## Explicit exclusions
- **No new Encoding sort behavior** in this first low-risk slice: moving live editor DOM elements can disrupt focus, persistent receipt number associations and existing tests. Optimization's existing sort remains untouched. Product Owner can separately prioritize a safe Encoding sort design.
- **No On Hold** or **Transferred** filter yet; those will follow their respective features.
- No monthly filing change, receipt export grouping, transfer/reversal, batch reports, database migration, RLS/Auth/settings change, dependency upgrade or public production deployment.
- Receipt Transfer planning remains **blocked** under Issue #61 until a specific Product Owner design discussion.

## Hosted UAT checklist (Product Owner; use the isolated test site and synthetic receipts)
1. Open **My Receipts → Encoding** on desktop and narrow/mobile width: search is visible, **Show Filter Options** is collapsed, actions remain accessible, no layout overflow.
2. Search by store, invoice number, TIN and receipt number, then clear search. Verify **Showing N of M receipts**, unchanged receipt numbers and no changes to actual data.
3. Expand filters; combine Store, date range, amount range, Expense Account and Classification. Test **Service Charge** and **Government Benefits**, as well as clear-all and zero-matches.
4. Collapse while a filter remains active: the list stays filtered and shows a **N active** indicator.
5. Use an invalid date or amount range: a warning appears; correct it. Clear filters resets search, advanced criteria and Amount compartment but preserves Available/Consumed/All.
6. Edit an Available receipt while filters are on, save, and reload: no typing/focus loss, no accidental deletion or hidden unsaved changes. Existing edit pin behavior should be understandable.
7. Visit **Optimization**: Best Match still evaluates the full Available pool regardless of Encoding search/filters. Manual Selection and export preflight behave as before.
8. Sign out then sign in as another account: no previous user's Encoding search/filter state carries over. UAT data remains separated.
9. Verify phone/touch keyboard and desktop keyboard: native disclosure opens by Enter/Space, buttons are reachable, no controls are obstructed.

### Evidence gates
The feature PR into the protected UAT source branch must pass `node-tests` on the exact head; Technical Lead independently reviews any failures; deployed UAT Pages must be confirmed to serve the exact approved source commit and isolated UAT Supabase project. **Only the Product Owner can report live functional UAT PASS.**
