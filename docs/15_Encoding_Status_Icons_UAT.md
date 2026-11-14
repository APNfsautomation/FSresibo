# v3.8.1 UAT — Compact Encoding status icons and tooltips

**Scope:** Presentation-only improvement to **My Receipts → Encoding** collapsed receipt summary rows. The previously accepted Optimization status-column layout, the workspace-wide unsaved count, receipt detail actions (including **Release Hold**), and Monthly Filing remain unchanged.

## Visual behavior
- Replace long summary badges with fixed 26px icon indicators in the existing status column: **✓ Consumed**, **⏸ On Hold**, **✎ Unsaved (new/edited)** and **! Outside range/filters**.
- Multiple indicators stay on one horizontal line without changing receipt-amount alignment or row height.
- Each icon carries a complete readable tooltip and a programmatically accessible label; receipt summary's own accessible name still announces all relevant states.
- On desktop, hovering reveals the tooltip; Tab + focus reveals it for keyboard users; on mobile, tap reveals/dismisses help.
- Interacting with the icon must **not** expand or collapse the receipt. Enter/Space activate help; Escape and blur dismiss it. The receipt's native summary remains keyboard-operable.
- No reliance on colour alone, no third-party icon font or new external dependency.

## Product Owner browser UAT (use only synthetic UAT receipts)
1. Verify normal, held, consumed, unsaved, and outside-range/filters states individually. Check that On Hold remains distinguishable from Unsaved.
2. Set a saved receipt On Hold, then edit it without saving so **On Hold + Unsaved** appear side by side. Both show their respective tooltip/label and the amount remains aligned with normal rows.
3. Check a new unsaved receipt shows the separate **New, unsaved** description.
4. Test several flags, long store names, various receipt amounts and desktop/tablet/phone widths; there should be no badge stacking or cut-off controls/tooltips.
5. Hover each visible icon on desktop; focus by keyboard and press Enter/Space/Escape; tap twice on phone and tap elsewhere. Icons must not open/close receipt details unexpectedly.
6. Expand/collapse a receipt using its native summary with click, Enter and Space; ensure receipt editing remains usable and its **Release Hold** / **Put On Hold** buttons retain their text.
7. Verify the workspace-wide **N unsaved receipts** count stays textual, that status filtering works as before, and that Optimization and Monthly Filing appearances are unchanged.
8. Confirm selection/export eligibility and saved receipt data are unchanged.

**Release gate:** Automated Node CI and independent source review before isolated UAT deployment. This checklist does not authorize production promotion or Supabase operations. Product Owner visual/browser acceptance is required after publication.
