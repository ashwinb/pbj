import { sql } from './sql.js'

const DEFAULT_BUCKETS = [
  { name: '10 min calisthenics', sortOrder: 1 },
  { name: '25 min cardio', sortOrder: 2 },
  { name: 'Stretching / mobility', sortOrder: 3 },
]

export async function ensureSchema() {
  await sql`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      name TEXT,
      image TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
  `

  await sql`
    CREATE TABLE IF NOT EXISTS buckets (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      sort_order INTEGER DEFAULT 0,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
  `

  await sql`
    CREATE TABLE IF NOT EXISTS entries (
      id SERIAL PRIMARY KEY,
      user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
      bucket_id INTEGER REFERENCES buckets(id) ON DELETE CASCADE,
      date DATE NOT NULL,
      checked BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE (user_id, bucket_id, date)
    );
  `

  await sql`
    CREATE TABLE IF NOT EXISTS sessions (
      id SERIAL PRIMARY KEY,
      user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
      token_hash TEXT UNIQUE NOT NULL,
      expires_at TIMESTAMPTZ NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
  `

  await sql`
    CREATE TABLE IF NOT EXISTS user_notes (
      user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
      date DATE NOT NULL,
      notes TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW(),
      PRIMARY KEY (user_id, date)
    );
  `

  // Clean up duplicate buckets and add unique constraint
  await sql`
    DELETE FROM buckets
    WHERE id NOT IN (
      SELECT MIN(id) FROM buckets GROUP BY name
    );
  `

  await sql`
    CREATE UNIQUE INDEX IF NOT EXISTS buckets_name_unique ON buckets (name);
  `
}

export async function seedBuckets() {
  for (const bucket of DEFAULT_BUCKETS) {
    await sql`
      INSERT INTO buckets (name, sort_order)
      VALUES (${bucket.name}, ${bucket.sortOrder})
      ON CONFLICT (name) DO NOTHING;
    `
  }
}

export async function resetData() {
  await sql`DELETE FROM entries;`
  await sql`DELETE FROM buckets;`
  await seedBuckets()
}
