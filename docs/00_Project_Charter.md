# FSResibo Project Charter

Version: 1.3

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

Epic 3 will extend FSResibo into a focused multi-module productivity application. These workflows are approved architecture, not yet implemented features.

- **Receipts** keeps the existing long-term receipt pool and contains Receipt Encoding and Receipt Optimization.
- **Monthly Filing** will manage a separate monthly receipt pool through encode, review, export, archive, correction, and deliberate clearing.
- **Quick Optimizer** will be a stateless calculator for temporary amounts only.

The Shared Store Directory will be one company-wide reference source for Receipt Encoding and Monthly Filing. Transaction records retain their own store-detail snapshots.

## Roadmap Direction

- Epic 3: Additional Receipt Workflows & Shared Store Data
- Epic 4: OCR Improvements
- Better export and workflow assistance where they reduce manual work
- Optional integrations only when they remain consistent with the focused-product philosophy

Analytics and dashboards are intentionally out of scope.

-
