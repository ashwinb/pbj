# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Is

Daily Habit Hub – a mobile-friendly Vite + React app for tracking daily exercise habits among a group of friends. Users sign in with Google, check off daily "buckets" (exercises), and view progress via heatmaps and stats.

## Commands

```bash
# Development
npm run dev          # Vite frontend (port 5173)
vercel dev           # Run API routes locally (requires Vercel CLI)

# Testing
npm test             # Run Vitest unit tests
npm run test:e2e     # Run Playwright e2e tests

# Build & Lint
npm run build        # TypeScript check + Vite build
npm run lint         # ESLint
```

## Architecture

**Frontend** (`src/`): Single-page React app (TypeScript). Main component is `App.tsx` which handles all UI state, auth, and API calls. Uses `@react-oauth/google` for Google Sign-In.

**API** (`api/`): Vercel Serverless Functions (JavaScript). Each file exports a default handler.

- `api/_lib/` – Shared utilities:
  - `db.js` – Postgres schema init, seeding, and reset
  - `auth.js` – Session management with secure cookies (SHA-256 hashed tokens)
  - `http.js` – JSON request/response helpers
- `api/auth/` – Login, logout, and session check (`/me`)
- `api/buckets.js` – CRUD for exercise buckets
- `api/checkins.js` – Daily check-in entries (GET by month, POST to toggle)
- `api/admin/reset.js` – Admin-only data reset

**Database**: Vercel Postgres with four tables: `users`, `buckets`, `entries`, `sessions`. Schema auto-creates on first request via `ensureSchema()`.

## Environment Variables

```
VITE_GOOGLE_CLIENT_ID=...   # Frontend (Vite injects this)
GOOGLE_CLIENT_ID=...        # Serverless functions
POSTGRES_URL=...            # Vercel Postgres connection
```

## Key Patterns

- API routes call `requireUser(req, res)` to enforce auth; returns early with 401 if no valid session
- Frontend uses `credentials: 'include'` on all fetches to send session cookies
- Admin check is email-based (hardcoded in `api/_lib/auth.js`)
