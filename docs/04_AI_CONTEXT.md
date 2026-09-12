# AI Context

| Field | Value |
|-------|-------|
| Project | FSResibo |
| Document | AI Context |
| Version | 1.0 |
| Status | Living Document |
| Last Updated | 2026-09-13 |

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

- Synology Web Station

Production

- GitHub Pages

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

Epic 2 is complete through Milestone 2.6 and the beta.5 receipt-delete hotfix. The current visible application version is maintained in `config/appMetadata.js` and is `2.6.0-beta.5`.

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

# Approved Epic 3 Direction — Not Yet Implemented

## Multi-Module Navigation

Top-level modules will be Receipts, Monthly Filing, and Quick Optimizer. A future Store Directory screen may exist only when an authorized UI is deliberately implemented.

Desktop navigation will use a sidebar and mobile navigation an accessible drawer. Receipts retains Receipt Encoding and Receipt Optimization as related subviews/tabs. Lightweight hash routing is preferred for GitHub Pages, Synology static hosting, and vanilla JavaScript:

```text
#receipts/encoding
#receipts/optimization
#monthly-filing
#quick-optimizer
```

Authentication callback fragments take precedence over normal routing.

## Transaction Domains

The existing `public.receipts` table remains the long-term receipt domain with its Available/Consumed lifecycle. Monthly Filing will use a separate `public.monthly_filing_receipts` table, service, lifecycle, queries, exports, and clear/delete operations. The two domains must never mix transaction records.

Monthly Filing will use Active and Archived statuses. Archived records may be Returned to Active for correction and re-export before final approval. Deliberate Clear Monthly Filing will hard-delete only the current user's Monthly Filing records; it will not affect long-term receipts or shared stores. Monthly history/batches are out of scope.

## Shared Store Directory

Epic 3 will introduce one canonical company-wide Shared Store Directory for Receipt Encoding and Monthly Filing. Transaction records retain their own Store/Address/TIN/VAT snapshots. Selecting a profile fills receipt fields but does not allow silent canonical-profile updates.

Contribution is explicit. A new shared profile normally requires a store name plus an address or TIN. Exact duplicates reuse the existing profile; similar or conflicting data must not overwrite it. Initial correction/deactivation may occur through Supabase administration, not through an assumed immediate admin UI.

Before the directory is deployed, account membership/signup behavior must be reviewed so unapproved accounts cannot gain company-wide reference-data access. FSResibo is currently treated as a single-company deployment; multi-company architecture is not part of Epic 3.

## Quick Optimizer

Quick Optimizer is an in-memory R1/R2/R3 amount calculator. It reuses the existing optimization engine and all three strategies, but it does not use Supabase, receipt services, Monthly Filing services, store data, lifecycle state, exports, localStorage, or sessionStorage. Refreshing/leaving may discard its state. The current 32-input optimization maximum remains accepted for Epic 3.

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
- Shared Store Directory security/membership gate before deployment
- Monthly Filing lifecycle and export safety

Medium Priority

- Shared autocomplete adoption
- Stateless Quick Optimizer

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

Codex

Responsible for:

- Implementation
- Refactoring
- Bug fixes
- Repository modifications

Codex should review the repository before making changes.

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
- `config/appMetadata.js` is the single source of the manually maintained tester-facing version. The current merged version is `2.6.0-beta.5`; advance only for manually tested deployable iterations.
- Core receipt actions use the shared in-app confirmation dialog instead of browser-native prompts, which can be suppressed by browser anti-abuse controls. Informational workflow feedback remains inline and non-blocking.

## Database and Manual Supabase Principle

Prefer reproducible source-controlled migrations, code, API, or CLI operations over manual dashboard changes. Database migration and frontend deployment are separate: apply and verify additive schema/RLS changes before deploying dependent frontend code. Manual Supabase actions are reserved for account/auth project configuration, secrets, SMTP/provider credentials, privileged administration, or settings unsuitable for repository storage, and must be documented before deployment.

---
End of Document
