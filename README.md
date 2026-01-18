# Daily Habit Hub

A mobile-friendly Vite + React app for four friends to track daily exercise buckets, adjust the regimen, and review progress together.

## Features
- Google sign-in with secure server-side session cookies.
- Shared bucket list (add, rename, delete) that updates all history.
- Daily check-ins with one-tap completion.
- Monthly heatmaps, per-bucket totals, and weekly snapshots for everyone.
- Admin-only reset (configured for `ashwinb@gmail.com`).

## Tech Stack
- Vite + React (TypeScript)
- Vercel Serverless Functions
- Vercel Postgres

## Environment Variables
Create a `.env.local` with:

```
# Frontend (Vite)
VITE_GOOGLE_CLIENT_ID=your-google-oauth-client-id

# Serverless functions
GOOGLE_CLIENT_ID=your-google-oauth-client-id
POSTGRES_URL=your-vercel-postgres-url
```

## Development

1. Install dependencies:
   ```bash
   npm install
   ```

2. Run Vite (frontend):
   ```bash
   npm run dev
   ```

3. For API routes, use `vercel dev` in another terminal to run the serverless functions locally:
   ```bash
   vercel dev
   ```

The frontend assumes the API is available at `/api/*` and will forward cookies automatically.

## Deployment

Deploy to Vercel. Ensure the environment variables above are set in the Vercel project settings. The app automatically creates the required Postgres tables on first run and seeds the default buckets.
