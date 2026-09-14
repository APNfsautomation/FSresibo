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

### Milestone 3.4 — Monthly Filing Foundation
- Separate Monthly Filing transaction table, lifecycle status, service, UI, and user RLS
- Create/edit/delete/review and Shared Store Directory autocomplete
- Transaction-domain isolation tests

### Milestone 3.5 — Monthly Filing Lifecycle & Export
- Active to Archived export lifecycle
- Return to Active for rejected/corrected filings, then re-edit/re-export
- Official workbook reuse, export-before-archive sequencing, archive-failure handling, and Clear Monthly Filing

### Milestone 3.6 — Quick Optimizer
- Stateless R1/R2/R3 temporary amount workflow
- Existing Closest Match, Fewest Receipts, and Do Not Exceed Target strategies
- No persistence, store data, lifecycle, or export

## Future
- Epic 4 — OCR Improvements
- Further workflow assistance and optional integrations only when they remain consistent with the product charter
