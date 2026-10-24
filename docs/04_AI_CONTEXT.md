# AI Context

| Field | Value |
|-------|-------|
| Project | FSResibo |
| Document | AI Context |
| Version | 1.0 |
| Status | Living Document |
| Last Updated | 2026-10-10 |

---

# Purpose

This document is intended for AI assistants (ChatGPT, Codex, and future coding assistants).

Its purpose is to onboard an AI into the FSResibo project before planning or implementing new features.

Every new AI session should review this document together with the other documents under `/docs`.

This document is considered the primary context source for AI-assisted development.

---

# Project Summary

FSResibo is a cloud-based productivity tool for receipt management.

Its purpose is to help users:

- Capture receipt information
- Organize receipts
- Optimize receipt combinations
- Export receipt data

The application is intentionally focused on improving user productivity while reducing repetitive manual work.

---

# Product Philosophy

FSResibo is NOT designed to become:

- ERP
- Accounting software
- Business Intelligence platform
- Spending analytics dashboard

Instead, every feature should answer one question:

> Does this reduce manual work?

If not, reconsider the feature.

---

# Primary Workflow

The intended workflow is:

Physical Receipts

↓

Receipt Encoding

↓

Receipt Storage

↓

Receipt Optimization

↓

Receipt Review

↓

Export

↓

Mark Consumed

Future automation should support this workflow rather than replace it.

---

# Current Technology Stack

Frontend

- HTML5
- CSS3
- JavaScript (ES Modules)

Backend

- Supabase

Authentication

- Supabase Authentication

Database

- PostgreSQL

Development

- Synology Web Station (earlier development hosting)

UAT and deployment

- GitHub Pages serves the protected UAT branch `claude/ui-ux-refinement`. Which Pages site is "production" is not recorded in the repository; the Product Owner confirms this before any `main` release.

Version Control

- Git
- GitHub

---

# Current Architecture

The application currently uses:

- Modular JavaScript
- Service Layer
- Supabase Backend
- Authentication
- Row Level Security
- Cloud Persistence

Optimization logic is separated from persistence.

Authentication is separated from business logic.

---

# Current Epic

Epic 3 — Additional Receipt Workflows & Shared Store Data

Epic 2 is complete through Milestone 2.6 and the beta.5 receipt-delete hotfix. Epic 3 Milestones 3.1–3.5 are merged and complete, including PR #14. Migration 004 is deployed and Monthly Filing lifecycle/export acceptance passed. The live Shared Store Directory serves both transaction workflows; company-controlled signup is in effect. Milestone 3.6 was merged to `main` by PR #15 (2026-10-10); the Product Owner reported browser tests passed, but mobile device validation was not performed and milestone-wide manual acceptance is not claimed. UI/UX refinement (CP10) continues on the protected UAT branch `claude/ui-ux-refinement`, which is ahead of `main`; U01-A (Issue #22) and U01-B (Issue #24) were accepted for development/UAT. The development version in `config/appMetadata.js` is `3.6.0-beta.1`; this is not a production rollout claim. `07_Regression_Coverage_Matrix.md` separates automated evidence, live Product Owner results, deferred items, unverified items and release status; read it before claiming anything is accepted.

---

# Current Implemented Receipts Module

## Receipt Encoding

Receipt Encoding

Purpose:

Fast data entry.

Features:

- Create receipt
- Edit receipt
- OCR
- Store autocomplete
- Display-only amount-compartment filter and complete Available Total workflow metric
- Selected optimizer recommendations grouped by the same physical amount compartments without changing optimization or export behavior
- Delete receipt

Design goal:

Maximum encoding speed.

---

## Receipt Optimization

Receipt Optimization

Purpose:

Find the best receipt combination.

Features:

- Target amount
- Find Best Match
- Compact receipt cards
- Search, filters, and sorting
- Strategy selection
- Export selected receipts, then mark them Consumed

Design goal:

Maximum visibility.

---

# Implemented Epic 3 Direction

## Multi-Module Navigation

Top-level modules are Receipts, Monthly Filing, and Quick Optimizer. Store Directory remains a reserved, unavailable route.

Desktop navigation uses a sidebar and mobile navigation an accessible drawer. Receipts retains Receipt Encoding and Receipt Optimization as related subviews/tabs. Lightweight hash routing supports GitHub Pages, Synology static hosting, and vanilla JavaScript:

```text
#receipts/encoding
#receipts/optimization
#monthly-filing
#quick-optimizer
```

Authentication callback fragments take precedence over normal routing.

## Transaction Domains

The existing `public.receipts` table remains the long-term receipt domain with its Available/Consumed lifecycle. Monthly Filing uses a separate `public.monthly_filing_receipts` table, service, lifecycle, queries, exports, and clear/delete operations. The two domains must never mix transaction records.

Monthly Filing uses Active and Archived status views. Active records can be saved and exported; Archived records are read-only until returned to Active for correction and re-export. Export automatically saves nonblank Active changes, processes explicit directory decisions, generates the shared workbook, then archives the exact snapshot. Clear Archived preserves Active receipts; Clear All Monthly Filing is a deliberate secondary reset. Mutations are serialized, and reconciliation preserves local Active edits only when the matching record remains Active on the server. Neither cleanup operation affects long-term receipts or shared stores. Monthly history/batches are out of scope.

## Shared Store Directory

Epic 3 provides one canonical company-wide Shared Store Directory for Receipt Encoding and Monthly Filing. Transaction records retain their own Store/Address/TIN/VAT snapshots. Selecting a profile fills receipt fields but does not allow silent canonical-profile updates.

Contribution is explicit. A new shared profile normally requires a store name plus an address or TIN. Exact duplicates reuse the existing profile; similar or conflicting data must not overwrite it. Initial correction/deactivation may occur through Supabase administration, not through an assumed immediate admin UI.

The directory is deployed and hosted RLS validation passed. Public self-registration is disabled; accounts are provisioned administratively. FSResibo remains a single-company deployment; multi-company architecture is out of scope.

## Quick Optimizer

Quick Optimizer is a separate authenticated in-memory amount workspace with blank R1/R2/R3 defaults and a 32-input maximum. Labels are stable and monotonic; bulk paste fills blanks then appends atomically. `quickOptimizerUi.js` uses the shared pure `findBestMatches(..., 3)` API; Receipt Optimization retains `findBest()` and one result. Temporary amounts never enter transaction pools, Available Total, or exports. Navigation preserves one calculator instance. Refresh resets it; logout, recovery/unauthenticated cleanup, and account changes explicitly clear it. No Supabase, receipt/Monthly Filing service, Company Directory, local/session storage, lifecycle, or export dependency is permitted.

Decision 018 (accepted; implementation merged by PR #15) adds the fixed 5000-centavo allowance. Closest and Fewest prioritize T…T+5000 before under-target candidates. Closest ranks excess then count; Fewest ranks count then excess. Fewest fallback uses closest-under M and the independent max(1,M−5000)…M window, even when filling alternatives. Do Not Exceed is strict. Equal totals/counts use lexicographic original input identities; duplicates remain distinct. Exact money formatting preserves integer centavos through the safe-integer boundary. Mobile device, assistive-technology and mobile-performance checks were not recorded; use `06_M3.6_Browser_Acceptance.md`.

## Epic 3 Milestones

1. Navigation Foundation
2. Shared Store Directory Foundation
3. Shared Store Directory Adoption
4. Monthly Filing Foundation
5. Monthly Filing Lifecycle & Export
6. Quick Optimizer

Epic 4 is OCR Improvements.

---

# Current Priorities

Highest Priority

- Safe Epic 3 navigation and transaction-domain isolation
- Unresolved CP10-C4 items: email confirmation redirect, password-recovery flow, hosted sign-up setting, CDN dependency pinning, and the Monthly Filing session-isolation defect (Issue #27)
- Product Owner integration UAT (`08_Integration_UAT_Checklist.md`) after the CP10-C3E-5 pull request is reviewed and merged
- Preserve accepted Monthly Filing lifecycle/export and shared-directory behavior

Medium Priority

- Shared autocomplete adoption
- Mobile and assistive-technology validation of Quick Optimizer

Future Priority

- Epic 4 OCR improvements
- Workflow assistance

---

# Deferred Features

These are intentionally postponed.

- Receipt image storage
- Analytics
- Dashboards
- Spending reports
- Full automation
- ERP functionality

Do not propose these unless specifically requested.

---

# UX Principles

The application should prioritize:

- Fewer clicks
- Less scrolling
- Less typing
- Faster encoding
- Faster optimization
- Simpler navigation

A simpler workflow is preferred over additional features.

---

# Beta Testing Feedback

Important observations from users:

- Add Receipt should remain accessible while scrolling.
- Selected receipts should be clearly highlighted.
- Store information should be reusable.
- Save and Clear buttons should be separated.
- Receipt list should be independently scrollable.
- Export should automatically mark receipts as Consumed.

These observations should guide future UI improvements.

---

# Coding Philosophy

Prefer:

- Small incremental changes
- Modular code
- Clear naming
- Existing architecture

Avoid:

- Large rewrites
- Unnecessary dependencies
- Architecture changes without discussion

---

# AI Responsibilities

ChatGPT

Responsible for:

- Architecture
- Planning
- Documentation
- Design review
- Prompt engineering
- Product direction

Codex (historical: Epics 2 and 3 implementation)

Claude Code (current implementation assistant)

Responsible for:

- Implementation on dedicated feature branches, never directly on the UAT branch or `main`
- Automated tests, documentation and pull requests
- Stopping after each pull request for independent review

The assistant should review the repository and every authorization comment before making changes. The Product Owner alone approves merges to `main` and production releases; see `03_Development_Workflow.md`.

---

# Standard AI Workflow

Every new implementation should follow:

1. Review repository.
2. Review `/docs`.
3. Summarize understanding.
4. Present implementation plan.
5. Wait for approval.
6. Implement.
7. Summarize modified files.
8. Stop for review.

---

# Source of Truth

When information conflicts:

1. Repository
2. Documentation
3. Approved roadmap
4. AI Context
5. Conversation

Never assume conversation history is available.

---

# Notes for Future AI Sessions

This project has evolved through multiple design discussions.

The repository should be treated as the project's permanent memory.

This document exists so future AI sessions can immediately understand the project without relying on previous conversations.

Always preserve the project's philosophy:

> Help users capture, organize, optimize, and export receipt information with the least amount of manual work while keeping users in control.

## Beta Application Identity

- Theme preference is browser-local: System, Light, or Dark.
- Corporate blue/red are shell accents; Encoding remains green and Optimization remains purple.
- `config/appMetadata.js` is the single source of the tester-facing version. Milestone 3.5 shipped as `3.5.0-beta.1`; Milestone 3.6 and the current UAT branch are `3.6.0-beta.1`. The version is not bumped by testing or documentation work.
- Core receipt actions use the shared in-app confirmation dialog instead of browser-native prompts, which can be suppressed by browser anti-abuse controls. Informational workflow feedback remains inline and non-blocking.

## Database and Manual Supabase Principle

Prefer reproducible source-controlled migrations, code, API, or CLI operations over manual dashboard changes. Database migration and frontend deployment are separate: apply and verify additive schema/RLS changes before deploying dependent frontend code. Manual Supabase actions are reserved for account/auth project configuration, secrets, SMTP/provider credentials, privileged administration, or settings unsuitable for repository storage, and must be documented before deployment.

---
End of Document
