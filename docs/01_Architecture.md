# FSResibo Architecture

Version: 1.3

## Core Principle
The application is organized around user workflows rather than individual features.

## Workspace 1 – Receipt Encoding
- Create receipts
- Edit receipts
- OCR
- Store autocomplete

## Workspace 2 – Receipt Optimization
- Target amount
- Find Best Match
- Compact receipt cards
- Search, filters, and sorting
- Strategy options
- Export selected receipts and receipt lifecycle

## UI Direction
Only the receipt list scrolls.
Header, summary, and optimization controls remain visible.

Selected receipts should always be visually highlighted.

## Application Shell

- Supabase Auth supports login, confirmation redirects, password recovery, and normal session persistence.
- Theme preference is browser-local (System, Light, Dark); it is not persisted in Supabase.
- A single source-code application version is rendered before and after authentication for beta deployment verification.
- FS Automation blue/red are restrained shell accents. Encoding remains green and Optimization remains purple.
