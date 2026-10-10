# FSResibo Project Charter

Version: 1.4

## Purpose
FSResibo is a productivity tool for receipt management that helps users capture, organize, optimize, and export receipt data while reducing repetitive manual work.

## Product Philosophy
FSResibo is intentionally a focused productivity tool—not an ERP, accounting package, or business intelligence platform.

Every feature should answer:
> Does this reduce manual work?

## Current Implemented Workflow
1. Encode physical receipts.
2. Optimize receipts against a target amount.
3. Review selected receipts.
4. Export selected receipts.
5. Automatically mark exported receipts as Consumed.

## Approved Product Direction

Epic 3 extends FSResibo into a focused multi-module productivity application. Milestones 3.1–3.5 are merged and complete. Milestone 3.6 implementation is complete; technical review and Product Owner browser acceptance are pending.

- **Receipts** keeps the existing long-term receipt pool and contains Receipt Encoding and Receipt Optimization.
- **Monthly Filing** manages a separate monthly receipt pool through encode, review, export, archive, correction, and deliberate clearing.
- **Quick Optimizer** is an authenticated, in-memory calculator for up to 32 temporary amounts, with exact top-three recommendations and no transaction persistence or export.

The Shared Store Directory is one company-wide reference source for Receipt Encoding and Monthly Filing. Transaction records retain their own store-detail snapshots.

Receipt Optimization and Quick Optimizer share accounting rules: target-reaching combinations may exceed the target by at most PHP 50; qualifying combinations precede under-target fallbacks. Fewest Receipts uses a fixed PHP 50 allowance/window, and Do Not Exceed Target never permits an excess.

## Roadmap Direction

- Epic 3: Additional Receipt Workflows & Shared Store Data
- Epic 4: OCR Improvements
- Better export and workflow assistance where they reduce manual work
- Optional integrations only when they remain consistent with the focused-product philosophy

Analytics and dashboards are intentionally out of scope.

-
