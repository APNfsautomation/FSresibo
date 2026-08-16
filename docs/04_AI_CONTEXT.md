# AI Context

| Field | Value |
|-------|-------|
| Project | FSResibo |
| Document | AI Context |
| Version | 1.0 |
| Status | Living Document |
| Last Updated | 2026-08-05 |

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

Epic 2

Workflow Optimization

Current milestone:

Epic 2 Milestone 2.6 — Beta Hardening.

---

# Planned Workspaces

## Workspace 1

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

## Workspace 2

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

# Current Priorities

Highest Priority

- Beta hardening
- Authentication reliability
- Deployment verification

Medium Priority

- Search
- Filters
- Store autocomplete

Future Priority

- OCR improvements
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
- `config/appMetadata.js` is the single source of the manually maintained tester-facing version. Use beta increments such as `2.6.0-beta.2` and `2.6.0-beta.3` for deployable test iterations.

---
End of Document
