# Major Project Decisions

| Project | FSResibo |
|----------|----------|
| Document | Major Project Decisions |
| Version | 1.0 |
| Status | Living Document |
| Last Updated | 2026-08-05 |

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