import { sql } from './sql.js'

const DEFAULT_BUCKETS = [
  { name: '10 min calisthenics', sortOrder: 1 },
  { name: '25 min cardio', sortOrder: 2 },
  { name: 'Stretching / mobility', sortOrder: 3 },
]

const MAX_BUCKETS_PER_USER = 5

let schemaVerified = false

/**
 * Verify schema exists. Does NOT run migrations - use scripts/migrate.js for that.
 * This is a lightweight check that runs once per cold start.
 */
export async function ensureSchema() {
  if (schemaVerified) return

  // Quick check that required tables exist
  const { rows } = await sql`
    SELECT table_name FROM information_schema.tables
    WHERE table_schema = 'public'
    AND table_name IN ('users', 'buckets', 'entries', 'sessions', 'user_notes');
  `

  if (rows.length < 5) {
    throw new Error('Database schema not initialized. Run: node scripts/migrate.js')
  }

  schemaVerified = true
}

// Seed default buckets for a specific user (called on user creation)
export async function seedBucketsForUser(userId) {
  const { rows: existingBuckets } = await sql`
    SELECT id FROM buckets WHERE user_id = ${userId} LIMIT 1;
  `

  // Only seed if user has no buckets
  if (existingBuckets.length > 0) return

  for (const bucket of DEFAULT_BUCKETS) {
    await sql`
      INSERT INTO buckets (user_id, name, sort_order)
      VALUES (${userId}, ${bucket.name}, ${bucket.sortOrder})
      ON CONFLICT (user_id, name) DO NOTHING;
    `
  }
}

export async function resetData() {
  await sql`DELETE FROM entries;`
  await sql`DELETE FROM buckets;`
  // After reset, each user needs buckets re-seeded
  const { rows: allUsers } = await sql`SELECT id FROM users;`
  for (const user of allUsers) {
    await seedBucketsForUser(user.id)
  }
}

export { DEFAULT_BUCKETS, MAX_BUCKETS_PER_USER }
