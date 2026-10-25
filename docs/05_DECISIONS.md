# Major Project Decisions

| Project | FSResibo |
|----------|----------|
| Document | Major Project Decisions |
| Version | 1.0 |
| Status | Living Document |
| Last Updated | 2026-09-13 |

---

# Purpose

This document records major product and architectural decisions made throughout the development of FSResibo.

It answers **why** decisions were made so future development remains consistent.

Only significant decisions should be recorded here.

---

# Decision 001

## FSResibo is a Productivity Tool

**Status**

Accepted

### Decision

FSResibo is positioned as a productivity tool for receipt management.

### Reason

The application's purpose is to reduce repetitive manual work rather than become an accounting or ERP system.

### Consequences

Future features should improve productivity rather than expand into unrelated business functions.

---

# Decision 002

## Analytics Are Out of Scope

**Status**

Accepted

### Decision

Analytics dashboards, spending reports, and business intelligence features are not part of the product roadmap.

### Reason

Beta discussions showed users primarily want a faster workflow for processing receipts, not analytical reporting.

### Consequences

Development effort will instead focus on:

- Better OCR
- Faster workflows
- Better exports
- Reduced manual work

---

# Decision 003

## Receipt Images Are Not Stored

**Status**

Accepted

### Decision

Receipt images will not be stored by default.

OCR uses images temporarily during processing.

Only structured receipt information is retained.

### Reason

This avoids:

- Large storage requirements
- Increased hosting costs
- Unnecessary database growth
- Additional privacy concerns

Receipt image storage may become an optional future feature.

---

# Decision 004

## Workflow Separation

**Status**

Accepted

### Decision

Receipt Encoding and Receipt Optimization are separate workspaces.

### Reason

Beta testing showed users naturally perform two distinct tasks:

1. Encode receipts.
2. Optimize receipts.

Separating these workflows reduces scrolling, clutter, and cognitive load.

### Consequences

Future UI improvements should respect this separation.

---

# Decision 005

## Development Workflow

**Status**

Accepted

### Decision

Every feature follows the same lifecycle.

Idea

↓

Documentation

↓

Codex Plan

↓

Approval

↓

Implementation

↓

Testing

↓

Commit

↓

Deployment

### Reason

Small iterative development reduces risk and keeps architecture consistent.

---

# Decision 006

## GitHub is the Source of Truth

**Status**

Accepted

### Decision

The GitHub repository is the project's permanent source of truth.

### Reason

Chat history may be lost or unavailable.

The repository preserves:

- Source code
- Documentation
- Commit history

AI assistants should review the repository before proposing changes.

---

# Decision 007

## AI Roles

**Status**

Accepted

### Decision

Responsibilities are divided between AI assistants.

ChatGPT

- Product planning
- Architecture
- Documentation
- Prompt engineering
- Code review

Codex

- Implementation
- Refactoring
- Repository modifications
- Testing support

### Reason

Separating planning from implementation leads to better decisions and more maintainable code.

---

# Future Decisions

Append new decisions below.

Do not edit historical decisions.

If a decision changes significantly, create a new decision that supersedes the previous one while preserving the project's history.

---

# Decision 008

## Deployment-Aware Authentication Redirects

**Status**

Accepted

### Decision

Signup confirmation and password recovery redirects are derived from the current application URL and must be allowed in Supabase URL Configuration.

### Reason

FSResibo is tested on Synology and deployed on GitHub Pages. A single stale Site URL must not force users back to an obsolete deployment.

### Consequences

Password recovery is a dedicated Set New Password experience, not normal application entry. Supabase Dashboard redirect URLs and email templates must remain aligned with supported deployments.

Recovery-intent callback URLs are recognized from their query or fragment before normal session bootstrap. An expired, invalid, or already-used recovery link therefore keeps the user in the recovery flow with a path to request a new email, even when another user session is present in the browser.

---

# Decision 009

## Functional Identity and Beta Verification

**Status**

Accepted

### Decision

FS Automation blue/red are restrained application-shell accents; Encoding stays green and Optimization stays purple. Theme preference is local to the browser, and a single manually maintained version identifier is visible before and after authentication.

### Reason

This supports company identity and reliable beta testing without weakening functional workspace cues or adding backend configuration.

The manually maintained beta identifier advances to `2.6.0-beta.3` for the final contained theme-surface and physical receipt-grouping test iteration.

---

# Decision 010

## In-App Confirmation for Core Receipt Actions

**Status**

Accepted

### Decision

Core receipt workflow confirmations use one accessible, in-app dialog. Browser-native confirmation and alert dialogs are not used for application workflow decisions or feedback.

### Reason

Browser anti-abuse controls can suppress repeated native dialogs, blocking normal receipt work without an application-visible recovery path.

### Consequences

Delete, discard, import, clear-form, and lifecycle restoration actions require an explicit in-app decision. Export retains its existing in-app confirmation and prevents duplicate processing. Informational results appear as inline live feedback. The manually maintained tester-facing version advances to `2.6.0-beta.4`.

---

# Decision 011

## Multi-Module Navigation Hierarchy

**Status**

Accepted

### Decision

Top-level workflows use application navigation: a desktop sidebar and accessible mobile drawer. Receipt Encoding and Receipt Optimization remain related subviews/tabs inside the Receipts module. Lightweight hash routing is preferred for static GitHub Pages and Synology deployments.

### Reason

FSResibo is growing beyond a two-workspace screen. Navigation should distinguish separate tools while preserving the close relationship between the two long-term receipt workflows.

### Consequences

The approved routes are `#receipts/encoding`, `#receipts/optimization`, `#monthly-filing`, and `#quick-optimizer`. Authentication callback fragments take precedence over application routing. This extends Decision 004 without changing its historical record.

---

# Decision 012

## Transaction-Domain Isolation

**Status**

Accepted

### Decision

Long-term receipts and Monthly Filing receipts use separate transaction tables, services, lifecycle states, queries, and explicit export sources. Only intentionally shared reference data may cross the boundary.

### Reason

Long-term Receipt Encoding/Optimization and Monthly Filing have different business purposes and clearing/lifecycle requirements. Mixing their transaction records could produce incorrect optimization, export, lifecycle, or deletion outcomes.

### Consequences

`public.receipts` remains the long-term domain. Planned `public.monthly_filing_receipts` is a separate user-scoped domain. Neither workflow may query, optimize, export, update, clear, or delete the other's records.

---

# Decision 013

## Shared Company Store Directory

**Status**

Accepted

### Decision

One company-wide canonical store reference source serves long-term Receipt Encoding and Monthly Filing. Receipt values remain transaction snapshots. Normal receipt edits never silently overwrite canonical store profiles; shared contribution is explicit and administrative correction/deactivation remains controlled.

### Reason

Users need cross-user reuse of Store Name, Address, TIN, and VAT Status without allowing ordinary transaction editing to corrupt canonical reference data.

### Consequences

Planned `public.shared_store_directory` is reference/master data, not a transaction table. New shared profiles normally require a store name plus an address or TIN. Exact duplicates reuse the existing profile; conflicting data does not replace it. Initial correction may occur through Supabase administration. Before deployment, account membership/signup behavior must be reviewed so unapproved accounts cannot gain company-wide directory access; this is a required security gate, not an implemented multi-company system.

---

# Decision 014

## Monthly Filing Ephemeral Lifecycle

**Status**

Accepted

### Decision

Monthly Filing uses Active and Archived states. Archived records may be Returned to Active for correction and re-export. After final approval, deliberate Clear Monthly Filing hard-deletes the current user's Monthly Filing transaction records. No retained monthly historical batches are required in Epic 3.

### Reason

Monthly filing is a repeatable current-cycle workflow. It needs a safe export state and a practical correction path when a submitted filing is rejected, without expanding FSResibo into historical reporting or batch management.

### Consequences

Successful Monthly Filing export archives exactly the records in the generated workbook. Return to Active supports edit/correct/re-export. Clear Monthly Filing removes only the current user's Active and Archived Monthly Filing rows; it does not affect long-term receipts or shared store records.

---

# Decision 015

## Stateless Quick Optimizer

**Status**

Accepted

### Decision

Quick Optimizer is a nonpersistent calculator using the existing optimization engine. It stores no receipts, store data, lifecycle state, or exports.

### Reason

Users sometimes need a fast amount-combination calculation without creating transaction records or entering receipt metadata.

### Consequences

Quick Optimizer uses temporary R1/R2/R3 amount rows, a target, and the existing three strategies. It does not use Supabase, receipt services, Monthly Filing services, Shared Store Directory, localStorage, or sessionStorage. Refreshing or leaving may discard its state.

---

# Decision 016

## Shared Expense Workbook Builder

**Status**

Accepted

### Decision

Long-term and Monthly Filing exports reuse one authoritative Expense Detailed Report workbook generator. Each workflow passes its own explicit transaction snapshot array. The exporter never queries a persistence service.

### Reason

The official A:O mapping and grouped Supplier Details header must remain consistent while transaction domains remain isolated.

### Consequences

Workbook generation remains reusable and pure. Long-term export receives only long-term receipt records; Monthly Filing export receives only Monthly Filing records. Monthly Filing archives records only after workbook generation succeeds.

---

# Decision 017

## Monthly Filing Cleanup Safety

**Status**

Accepted

### Decision

Active and Archived remain lifecycle statuses in the single `public.monthly_filing_receipts` table, but Monthly Filing presents them as separate UI views. Clear Archived is the ordinary cleanup action and preserves all Active records. Clear All Monthly Filing remains available as a deliberate full reset.

### Reason

An exported receipt can be returned to Active for correction. A routine cleanup action must not delete that correction work alongside unrelated Archived receipts.

### Consequences

Archived means exported and read-only until returned to Active; it does not mean accounting-approved, permanently retained, or backed up. No monthly batches, historical batch management, approval status, or new persistence infrastructure is added. This refines Decision 014 without altering its historical record.

---

# Decision 018

## Fixed PHP 50 Accounting Allowance

**Status**

Accepted accounting/design contract. The original note read "Milestone 3.6 implementation review and Product Owner browser acceptance pending."

Status update (2026-10-24, Issue #26): the implementation was merged to `main` by PR #15 on 2026-10-10 after technical-lead review, and the Product Owner reported browser tests passed. Mobile device validation was not performed and is not claimed; assistive-technology and mobile-performance checks are not recorded. The decision itself is unchanged.

### Decision

Receipt Optimization and Quick Optimizer share integer-centavo calculations with a fixed maximum excess of 5000 centavos. Closest Match and Fewest Receipts consider target-reaching totals in T…T+5000 first; T+5000 is valid and T+5001 is excluded. Closest ranks lowest excess then fewer receipts; Fewest ranks fewer receipts then lowest excess throughout that range.

Under-target Closest ranks highest positive total then fewer receipts. Fewest finds the global closest-under total M independently, then ranks only max(1,M−5000)…M by fewer receipts then highest total. Preferred combinations precede fallback combinations, including when alternatives fill the remaining positions. Do Not Exceed Target allows only positive totals at or below T. Equal totals/counts use lexicographically ascending original input-index vectors, so duplicate amounts keep distinct physical identities. Empty subsets never qualify.

### Reason

A fixed PHP 50 allowance matches the approved accounting workflow; a target-relative 2% tolerance does not. Meeting the target within the allowance must outrank a nearer under-target total.

### Consequences

`findBestMatches()` returns exact ordered top-three combinations through compact meet-in-the-middle subsets and bounded merges; `findBest()` remains its one-result compatibility wrapper. Receipt Optimization retains transaction/export behavior. Quick Optimizer is an isolated amount-only workspace with explicit calculation, stable temporary labels, atomic newline bulk append, and no persistence or export. Navigation preserves its one-instance state; refresh, logout/account changes, and Clear Calculator reset it. Exact display formatting retains centavos. This extends Decision 015 without rewriting it or Decisions 012, 014, 016, and 017. Milestone acceptance, merge, and rollout are separate gates.

---

# Decision 019

## Exact Large-Pool Receipt Optimization

**Status**

Accepted (Product Owner authorized implementation of Issue #29 on 2026-10-24). Implemented in the Issue #29 pull request; Product Owner retest of UAT check #8 after deployment is pending. Decision 018 and its accounting rules are unchanged.

### Decision

Receipts → Optimization calculates over **all Available receipts**, with no first-32 or filtered subset. Pools of up to 32 receipts continue to use the unchanged `findBest()` engine. Pools of more than 32 use a separate **exact, pseudo-polynomial solver** (`services/poolOptimizationService.js`) that returns the single result Decision 018's rules define:

- Dense dynamic programming over centavo sums: a bitset of reachable totals fixes the total; a minimum-count table with one decision bit per (receipt, sum) rebuilds the fewest-receipt set, and rebuilding from the first receipt upward reproduces the rule "of two sets with the same count, the one containing the smallest differing index wins". There is no 32-bit mask.
- Exactness-preserving reductions: receipts above the cap (target plus PHP 50, or the target for Do Not Exceed) cannot take part and are dropped after the whole pool is validated; zero-amount receipts never improve a ranking; every amount is divided by the gcd of the kept amounts; the table is never wider than the pool total.
- **Exact fast paths.** When the whole positive pool does not exceed the target, Closest and Do Not Exceed take every positive receipt, and so does Fewest when the pool equals the target. Fewest with the pool below the target is solved as an **omitted-receipt problem**: omit receipts totalling at most PHP 50 (and leaving at least PHP 0.01), maximizing the omitted count, then minimizing the omitted amount, then preferring not to omit the smaller index. Its table is at most 5,000 centavos wide.
- **Budgets, checked before any large allocation, by one verdict shared by every search path (the DP and the omitted-receipt table alike):** about 1.5e9 cells, 256 MiB of predicted memory, a sum range under 2^30 units, a finite cost estimate, and (for the DP) fewer than 32,767 kept receipts; a 45-second timeout inside the solver and a watchdog around it. The page thread solves directly only the engine, the nothing-qualifies and take-every-receipt answers and complement problems of at most 2,000,000 planned cells; anything larger goes to the Worker, and anything over budget is refused before a Worker exists. These are provisional ceilings, not a latency or support guarantee.
- **No eligible receipt:** when every positive receipt is above the cap, the answer is an exact "nothing qualifies" with a finite zero-cost plan, computed directly, never a Worker.
- **Over budget, cancelled, timed out or failed:** the app shows "Exact result cannot be computed safely with these values on this device; no recommendation was produced." (or the matching cancelled/timeout/error wording), keeps every receipt untouched, and never returns an approximation. It does not suggest exporting or consuming receipts to shrink the pool.
- The long-pool search runs in a **module Web Worker** with visible progress and a Cancel button. A finished run is applied only if it is still the current run for the same account and the identical pool signature (every receipt's id, status and amount), target and strategy; edits (every field, including typing in Store and a correction saved through the Edit dialog), status changes, target or strategy changes, a newer calculation, sign-out, an account switch, switching from Receipt Optimization to Encoding and leaving the Receipts module all stop it. The pool signature covers every workbook-relevant value of every receipt, raw amount text included, so a change that fires no event is still caught.

### Reason

Real saved pools exceed 32 receipts, and the 32-receipt limit comes from 32-bit identity masks and 2^(n/2) subset lists: deleting the guard silently corrupts results (a 33-receipt pool returned a total with no receipts) and needs gigabytes by the high 40s. Subset sums over integer centavos are pseudo-polynomial, so an exact answer is possible whenever the target range is bounded.

### Consequences

- Exact for every pool inside the budget, identical to the existing engine for up to 32 receipts, and refused rather than approximated outside it. Cost grows with receipts × target (in gcd units), not with the number of subsets: on the development machine (Node 24, Intel Core i7-14700HX) about 3 ns per cell, for example 400 typical receipts at a PHP 20,000 target in about 2.4 s and about 100 MiB, and whole-peso pools 100 times cheaper. Targets above the pool cost almost nothing. A target between half the pool and the pool is not specially accelerated.
- Quick Optimizer keeps its separately specified 32 entered amounts and top-three results; Manual Selection keeps its 100-selected cap; bulk saving of hundreds of new receipts remains deferred. No schema, RLS, Auth, version or `main` change.
- Mobile performance is not measured; WebAssembly acceleration and a user-chosen candidate scope are deferred and would each need a separate decision.

# Decision 020

## Session-Scoped Asynchronous Operations

**Status**

Accepted (Product Owner authorized implementation of Issue #27 on 2026-10-25). Implemented in the Issue #27 pull request; independent review and the Product Owner's two-account live-browser UAT are pending.

### Decision

Every asynchronous operation that can change what a signed-in user sees belongs to a session. A session is replaced by every sign-in (the same account signing in again included), sign-out, recovery event and missing session. An operation captures its session when it starts and treats its result, error and `finally` as inert once the session is no longer current: it renders nothing, says nothing, prompts nothing, sends nothing further, and releases only its own session's guards. Guards (busy flag, mutation guard, archive-uncertainty lifecycle) are part of the session, so a new session starts with free guards even if an earlier request never finishes. App-level activation uses an epoch checked after every await, and a confirmation prompt is dismissed when its account ends or changes.

### Reason

A previous account's Monthly Filing financial data could appear inside the next account's authenticated screen, and the next account's controls could stay disabled behind a request that never answered. Overlapping activation was confirmed by reproduction in Receipt Encoding's load and in `app.js`.

### Consequences

- The successful same-session flows (save, directory decision, workbook snapshot, archive, single mutation restriction, archive-uncertainty reconciliation, Active/Archived behavior) are unchanged. Same-account token refreshes are still de-duplicated by `app.js` and never start a new session.
- A request already sent to the database before the switch cannot be recalled: a workbook already generated, an archive or Company Directory contribution already requested keep their server-side effect, which stays owner-scoped by RLS. Only the on-screen effect is suppressed.
- No schema, RLS, Auth, dependency, feature or version change; automated tests use fake services and are not live hosted evidence.
- Round 1 review of PR #31 added: the latest authentication event wins (A, B, A and B, A, B), a late startup session answer is ignored once any later sign-in, sign-out or recovery event has happened, password recovery ends both controllers' sessions, and Receipt Encoding's dialogs and pending review, export and edit save belong to their session (the previous account's are closed or discarded before the next session's first await, and its export runner can no longer read, generate a workbook or consume). A review read, workbook, consume or correction already sent before the switch cannot be recalled.
- Round 2 review of PR #31 added: every remaining asynchronous Receipt Encoding continuation is session-scoped (Restore, Delete, permanent Consumed delete, Company Directory contribution and post-save prompts, OCR callback), and a stale Edit correction writes nothing to the shared Save correction button (a new session resets it; each session releases only its own). An earlier statement here that the unguarded Restore, Delete and OCR continuations "show no receipt data of the previous account" was wrong: a late Restore inserted the previous account's receipt (store, address, TIN) into the next account's receipt-history suggestions. It was reproduced by a failing test, fixed, and the remaining operations were audited (see `07_Regression_Coverage_Matrix.md`).
- Round 3 review of PR #31 added: the three remaining confirmation continuations (Clear manual selection, Clear form, Discard unfinished receipt) check their session after the answer instead of relying on `app.js` dismissing the shared prompt with `false` on an account change. Tests use a late `true` confirmation, which is the harder case, and assert nothing of the next account changes (receipts, unsaved edits, selections, feedback, focus). With this the guarantee is: **every** confirmation, request and callback of the Receipt Encoding and Monthly Filing controllers captures its session and writes nothing once it has ended.
- A request already sent before the switch (a status update, delete, contribution, correction, review read, workbook download, consume) cannot be recalled; its server-side effect stays owner-scoped by RLS and only its on-screen and cache effect is suppressed. Observed separately and not changed here: after a successful Edit correction the shared Save correction button is not re-enabled until the page is reloaded (this predates Issue #27).

## Runtime Dependency Pinning and Integrity

### Status

Accepted (Product Owner authorized Issue #32 on 2026-10-25). Implemented in the Issue #32 pull request; independent review and deployment acceptance are pending.

### Decision

- Every third-party runtime dependency has an exact version, and `vendor/dependency-manifest.json` is the single source of truth for versions, hashes, licenses and integrity class. `tests/dependencyIntegrity.test.mjs` fails on a floating version, an unreviewed external script or remote import, a changed vendored byte, a removed `integrity` or `crossorigin`, an unlisted vendored file or a manifest that disagrees with `index.html` or `services/ocrService.js`.
- **Supabase client:** the official npm UMD build 2.118.0 is vendored (`vendor/supabase/`, 218 KB, same pattern as SheetJS) and loaded by `index.html` as a same-origin classic script with a Subresource Integrity attribute. A dynamic `import()` from `esm.sh` cannot take an integrity attribute, and even an exact `esm.sh` URL serves esm.sh-built bytes rather than the npm artifact. `getSupabaseClient()` keeps its signature, cache and `createClient(url, anonKey)` call; it now also returns one shared client to concurrent callers instead of building two.
- **Tesseract.js:** pinned to 5.1.1 (the version `@5` resolved to) with Subresource Integrity on the entry script. The worker script, WASM core and English data are loaded by the library itself, so `services/ocrService.js` passes their exact locations (`OCR_ASSET_PATHS`), which are the library defaults for 5.1.1 except that the previously unversioned `@tesseract.js-data/eng` is now `1.0.0`.
- **SheetJS** is unchanged.

### What is and is not verified

- **Verified:** the Supabase bundle and the Tesseract.js entry script (the browser enforces Subresource Integrity; a wrong hash was observed to be blocked); the vendored files and SheetJS (hashes checked in CI).
- **Pinned but not verified by the browser (partial mitigation, residual risk):** the Tesseract worker script, the two WASM cores (SIMD and non-SIMD) and the English language data. Library code fetches them with `importScripts` and `fetch`, which accept no integrity attribute. Their versions are immutable on the npm registry and the audited sha256 and sha384 values are recorded in the manifest, but nothing compares them with what a browser downloads. A compromised CDN could still serve different bytes for those four files. The browser also caches the language data in IndexedDB under an unversioned key.
- URL version pins are not integrity: an exact-version URL does not prove the bytes.

### Not chosen here (needs a Product Owner / Technical Lead decision)

1. Vendor the whole Tesseract set (worker 124 KB, two cores of 3.9 MB, English data 2.95 MB, entry script 67 KB, about 11 MB in total) and test `.gz` and `.wasm.js` delivery on Synology. This would remove the residual risk.
2. Fetch the worker, core and language data on the main thread with `fetch(url, { integrity })` and hand Tesseract blob URLs or language objects. Runtime verification without vendoring, but it reworks the OCR loading path.
3. A bundler and lockfile (architecture change).
4. A Content-Security-Policy meta tag (GitHub Pages cannot send headers).

### Consequences

- No Supabase schema, RLS, Auth setting, credential, key, version or feature change. The OCR behavior, messages and models are unchanged. OCR UAT test A7 stays DEFERRED.
- The first sign-in page now depends on a same-origin file instead of a CDN; Tesseract still needs jsDelivr, as before.
- Updating or rolling back a dependency follows `03_Development_Workflow.md`, section "Updating a runtime dependency".