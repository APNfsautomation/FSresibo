# FSResibo Architecture

Version: 1.4

## Core Principle

The application is organized around user workflows rather than individual features. Transaction data is isolated by workflow domain; intentionally shared reference data is explicit.

## Current Implemented Receipts Module

The current application implements one long-term receipt domain in `public.receipts`. Its user-scoped Available/Consumed lifecycle, exports, optimization behavior, and beta.5 deletion fix remain unchanged unless a later approved milestone explicitly changes them.

### Receipt Encoding
- Create receipts
- Edit receipts
- OCR
- Store autocomplete
- Display-only amount-compartment filter and complete Available Total workflow metric

### Receipt Optimization
- Target amount
- Find Best Match
- Compact receipt cards
- Search, filters, and sorting
- Strategy options
- Export selected receipts and receipt lifecycle
- XLSX staging export preserves the official Expense Detailed Report A:O mapping, including a grouped Supplier Details / Name / Address header
- Selected optimizer recommendations are grouped by the same display-only physical amount compartments used in Encoding; this never alters optimizer or export order.

## Approved Epic 3 Architecture — Not Yet Implemented

### Application Modules

Top-level application navigation will represent workflows:

```text
WORKFLOWS
  Receipts
  Monthly Filing
  Quick Optimizer
```

Receipts will retain Encoding and Optimization as related subviews/tabs because they use the same long-term receipt pool. A Store Directory screen is a possible future authorized admin/reference screen; it is not an approved immediate UI screen.

Desktop navigation will use a left-side panel. Mobile navigation will use an accessible drawer. Lightweight hash routes are preferred for GitHub Pages, Synology static hosting, and vanilla JavaScript:

```text
#receipts/encoding
#receipts/optimization
#monthly-filing
#quick-optimizer
```

Authentication callback fragments take precedence over normal application routing.

### Transaction-Domain Isolation

Long-term receipts and Monthly Filing receipts are separate transaction domains:

```text
public.receipts != public.monthly_filing_receipts
```

They must not query, optimize, export, update lifecycle state, or clear/delete each other's records. Monthly Filing will have its own user-scoped table, service, UI controller, and Active/Archived lifecycle. It may return archived records to Active for correction and re-export before final approval.

### Shared Store Reference Data

`public.shared_store_directory` is a source-controlled repository foundation for one canonical company-wide reference source for Receipt Encoding and Monthly Filing. It is reference/master data, not transaction data. Both transaction domains retain Store/Address/TIN/VAT snapshots, so later canonical corrections never rewrite historical receipt values. The migration is not yet applied to hosted Supabase and no Receipt Encoding UI consumes it until Milestone 3.3.

Receipt Encoding now loads active company profiles ahead of the current user's receipt-history fallback. Normal receipt edits never silently update canonical store profiles. New shared-profile contribution is explicit, requires a store name plus an address or TIN, and does not overwrite conflicting existing profiles. Initial administrative correction may occur through Supabase administration until an authorized in-app screen is deliberately implemented.

Before directory deployment, account membership/signup behavior must be reviewed so unapproved accounts cannot receive company-wide directory access. The current public signup flow must be replaced with company-controlled invitations or administrative account creation before hosted deployment. FSResibo remains a single-company deployment; multi-company architecture is out of scope.

### Stateless Quick Optimizer

Quick Optimizer will use the existing optimization engine and its three strategies with temporary R1/R2/R3 amount rows. It will not use Supabase, receipt services, store data, lifecycle state, exports, localStorage, or sessionStorage. The existing 32-input optimization limit remains accepted for Epic 3.

### Planned Module Boundaries

Epic 3 should keep `app.js` as application composition/bootstrap rather than a growing visibility controller. Likely future boundaries include navigation, reusable store-autocomplete logic, Monthly Filing UI/service, and Quick Optimizer UI. Exact filenames remain implementation decisions; persistence domains and source collections must remain explicit.

### Export Boundary

One reusable Expense Detailed Report workbook builder will preserve the official A:O mapping and grouped Supplier Details header. Each workflow passes its own explicit transaction snapshot array. The exporter never queries Supabase.

## Current UI Direction
Only the receipt list scrolls.
Header, summary, and optimization controls remain visible.

Selected receipts should always be visually highlighted.

## Current Application Shell

- Supabase Auth supports login, confirmation redirects, password recovery, and normal session persistence. Recovery-intent links without a valid recovery session stay in a recovery-specific expired/invalid state instead of opening a normal session.
- Theme preference is browser-local (System, Light, Dark); it is not persisted in Supabase.
- A single source-code application version is rendered before and after authentication for beta deployment verification.
- FS Automation blue/red are restrained shell accents. Encoding remains green and Optimization remains purple.
- The application shell provides a desktop Receipts sidebar and an accessible mobile drawer. `#receipts/encoding` and `#receipts/optimization` are the active hash routes; Supabase callback fragments retain precedence and are never normalized as application routes.

## Database and Deployment Principle

Supabase migrations and static frontend deployments are separate operations. For a database-backed milestone: apply and verify the additive source-controlled migration, test RLS/security, deploy the dependent frontend, then perform deployment acceptance testing. New frontend code must not be deployed ahead of required tables or policies.
