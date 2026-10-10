# FSResibo Roadmap

## Epic 1 ✅
Foundation & Cloud Infrastructure

## Epic 2 ✅
Workflow Optimization

### Milestone 2.1 ✅
- Separate Encoding and Optimization workspaces
- Floating Add Receipt button
- Compact receipt cards
- Highlight selected receipts
- Scrollable receipt list
- Better button placement

### Milestone 2.2 ✅
- Search
- Filters
- Sticky toolbar

### Milestone 2.3 ✅
- Optimization Strategy Options

### Milestone 2.4 ✅
- Store autocomplete

### Milestone 2.5 ✅
- Export selected receipts
- Auto-mark Consumed

### Milestone 2.6 ✅
- Beta hardening: authentication recovery, deployment-aware redirects, semantic theme surfaces, restrained company accents, visible build version, shared physical amount compartments, Available Total, official-style staging workbook headers, and in-app workflow confirmations

### Beta.5 Hotfix ✅
- Fixed persisted receipt deletion after asynchronous in-app confirmation

## Epic 3 — Additional Receipt Workflows & Shared Store Data

### Milestone 3.1 ✅ — Navigation Foundation
- Top-level application shell/navigation
- Desktop sidebar and accessible mobile drawer
- Hash routing compatible with static hosting and authentication callbacks
- Receipts as a top-level module with Encoding and Optimization retained as sub-tabs

### Milestone 3.2 ✅ — Shared Store Directory Foundation
- `public.shared_store_directory` migration, normalization, constraints, indexes, RLS, and grants
- Active-profile loading/search through a shared service
- Company membership/security gate resolved before deployment

Hosted Supabase now has the reviewed directory migration and validated RLS; public signup is company-controlled. Milestone 3.3 performs the Receipt Encoding adoption.

### Milestone 3.3 ✅ — Shared Store Directory Adoption
- Reusable autocomplete logic
- Receipt Encoding integration and cross-user discovery
- Explicit profile contribution, branch-aware matching, and duplicate/conflict handling
- Temporary receipt-history fallback and controlled historical-backfill approach if needed

### Milestone 3.4 ✅ — Monthly Filing Foundation
- Separate Monthly Filing transaction table, lifecycle status, service, UI, and user RLS
- Create/edit/delete/review and Shared Store Directory autocomplete
- Transaction-domain isolation tests

Migration 003 is deployed to hosted Supabase. Live two-user RLS validation, browser acceptance, and mobile smoke testing passed. PR #13 is merged.

### Milestone 3.5 ✅ — Monthly Filing Lifecycle & Export
- Active and Archived workspace views of one transaction table
- Automatic save-before-export, authoritative Expense Detailed Report workbook, and exact-set archive RPC
- Return to Active for rejected/corrected filings, then re-edit/re-export
- Explicit Company Directory contribution, draft preservation, mutation coordination, and cross-session cleanup reconciliation
- Clear Archived preserving Active receipts, plus a deliberate Clear All Monthly Filing reset under More Actions
- Long-term Receipt transaction isolation

Migration 004 is deployed. Hosted RPC/security/two-user/concurrency validation passed. Original lifecycle, Company Directory, final Active/Archived cleanup, and mobile browser acceptance passed. PR #14 is merged; Milestone 3.5 is complete.

### Milestone 3.6 — Quick Optimizer & Accounting Tolerance Revision
- Authenticated top-level workspace, desktop sidebar/mobile drawer, and hash routing
- In-memory R1/R2/R3 defaults, stable monotonic labels, strict amounts, atomic newline bulk append, and 32-input limit
- Shared exact top-three engine; alternative selection, highlights, explicit calculation, and stale-result invalidation
- Fixed PHP 50 maximum excess, target-reaching priority, fixed Fewest Receipts window, and strict Do Not Exceed
- Existing Receipt Optimization keeps one result and its transaction/export boundaries
- Exact centavo display, workspace state retention, and refresh/logout/account-change resets
- No persistence, store data, lifecycle, export, or migration

Implementation complete; technical review and Product Owner browser acceptance pending. Version: `FSResibo v3.6.0-beta.1`. Milestone 3.6 is not yet accepted or merged; production rollout is not complete. See `06_M3.6_Browser_Acceptance.md` for the release acceptance checklist.

## Future
- Epic 4 — OCR Improvements
- Further workflow assistance and optional integrations only when they remain consistent with the product charter
