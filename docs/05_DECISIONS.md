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
