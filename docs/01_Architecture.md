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

They must not query, optimize, export, update lifecycle state, or clear/delete each other's records. Monthly Filing has its own user-scoped table, service, UI controller, and Active/Archived lifecycle. Milestone 3.5 will add deliberate archive/return-to-active workflow behavior.

Milestone 3.4 provides the Monthly Filing foundation through `public.monthly_filing_receipts`, `monthlyFilingService.js`, and a dedicated `#monthly-filing` workspace. Migration 003 is deployed to hosted Supabase; live schema/RLS validation, including two-user ownership isolation, browser acceptance, and mobile smoke testing passed. PR #13 is merged. Monthly Filing transaction snapshots retain Store/Address/TIN/VAT values; selecting a Shared Store Directory profile records its current snapshot and optional `shared_store_id`, while later canonical corrections never rewrite the transaction snapshot.

Milestone 3.5 implements the lifecycle/export workflow. Active and Archived are separate Monthly Filing views of the same transaction table: Active records are editable and exportable, while Archived records are read-only until returned to Active for correction. Export automatically saves current nonblank Active changes, resolves any explicit Company Directory decision, then builds an Expense Detailed Report from one explicit persisted Active snapshot and atomically archives exactly that snapshot through `archive_monthly_filing_receipts`. Completely blank local placeholders are neither persisted nor exported. Workbook-generation failure archives nothing; archive failure after workbook generation is a warning requiring refresh before retry. Clear Archived is the ordinary cleanup action and preserves Active records; the secondary Clear All Monthly Filing action remains a deliberate full reset. Archived is an export lifecycle state, not accounting approval or permanent storage. Migration 004 is deployed, and hosted RPC, security, and concurrency validation plus browser lifecycle acceptance passed; the Monthly Filing Company Directory contribution and cleanup UX remain under focused acceptance before merge.

### Shared Store Reference Data

`public.shared_store_directory` is the live canonical company-wide reference source for Receipt Encoding and Monthly Filing. It is reference/master data, not transaction data. Both transaction domains retain Store/Address/TIN/VAT snapshots, so later canonical corrections never rewrite historical receipt values.

Receipt Encoding and Monthly Filing load active company profiles for autocomplete. After a successful new or materially changed transaction save, either workflow may offer an explicit post-save consent prompt to add an eligible unmatched store; declining retains the independent transaction snapshot without creating canonical data. Exact or uniquely compatible profiles may be associated with a transaction without overwriting its Store/Address/TIN/VAT snapshot or the canonical profile. Normal transaction edits never silently update canonical store profiles. New shared-profile contribution requires a store name plus an address or TIN and does not overwrite conflicting existing profiles. Initial administrative correction may occur through Supabase administration until an authorized in-app screen is deliberately implemented.

Company-wide directory access is restricted to company-controlled accounts. Public self-registration is disabled; new users are provisioned administratively. FSResibo remains a single-company deployment, and multi-company architecture is out of scope.

### Stateless Quick Optimizer

Quick Optimizer will use the existing optimization engine and its three strategies with temporary R1/R2/R3 amount rows. It will not use Supabase, receipt services, store data, lifecycle state, exports, localStorage, or sessionStorage. The existing 32-input optimization limit remains accepted for Epic 3.

### Planned Module Boundaries

Epic 3 should keep `app.js` as application composition/bootstrap rather than a growing visibility controller. Likely future boundaries include navigation, reusable store-autocomplete logic, Monthly Filing UI/service, and Quick Optimizer UI. Exact filenames remain implementation decisions; persistence domains and source collections must remain explicit.

### Export Boundary

One reusable Expense Detailed Report workbook builder will preserve the official A:O mapping and grouped Supplier Details header. Each workflow passes its own explicit transaction snapshot array. The exporter never queries Supabase.

## Current UI Direction
Only the receipt list scrolls.
Header, summary, and optimization controls remain visible.

When the Encoding status view is Consumed, Add Receipt is hidden so read-only receipt review cannot start a new receipt.

Selected receipts should always be visually highlighted.

## Current Application Shell

- Supabase Auth supports login, confirmation redirects, password recovery, and normal session persistence. Recovery-intent links without a valid recovery session stay in a recovery-specific expired/invalid state instead of opening a normal session.
- Theme preference is browser-local (System, Light, Dark); it is not persisted in Supabase.
- A single source-code application version is rendered before and after authentication for beta deployment verification.
- FS Automation blue/red are restrained shell accents. Encoding remains green and Optimization remains purple.
- The application shell provides a desktop Receipts sidebar and an accessible mobile drawer. `#receipts/encoding` and `#receipts/optimization` are the active hash routes; Supabase callback fragments retain precedence and are never normalized as application routes.

## Database and Deployment Principle

Supabase migrations and static frontend deployments are separate operations. For a database-backed milestone: apply and verify the additive source-controlled migration, test RLS/security, deploy the dependent frontend, then perform deployment acceptance testing. New frontend code must not be deployed ahead of required tables or policies.

### Pre-production release gate

Before colleague rollout, remove development/test data from `public.receipts`, `public.monthly_filing_receipts`, and `public.shared_store_directory` while preserving schema, migrations, RLS, and authentication users unless separately approved. Prepare an administrator maintenance runbook for Company Directory entries, long-term receipt history, and Monthly Filing entries. This is a release gate only; no reset is implemented here.
