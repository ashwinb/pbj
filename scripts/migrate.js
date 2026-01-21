#!/usr/bin/env node
/**
 * Database migration script. Run once when deploying schema changes.
 * Usage: node scripts/migrate.js
 */

import { sql, createPool } from '../api/_lib/sql.js'

const DEFAULT_BUCKETS = [
  { name: '10 min calisthenics', sortOrder: 1 },
  { name: '25 min cardio', sortOrder: 2 },
  { name: 'Stretching / mobility', sortOrder: 3 },
]

async function migrate() {
  console.log('Starting migration...')

  // Create base tables if they don't exist
  await sql`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      name TEXT,
      image TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
  `
  console.log('✓ users table')

  await sql`
    CREATE TABLE IF NOT EXISTS sessions (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      token_hash TEXT UNIQUE NOT NULL,
      expires_at TIMESTAMPTZ NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
  `
  console.log('✓ sessions table')

  await sql`
    CREATE TABLE IF NOT EXISTS buckets (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      sort_order INTEGER DEFAULT 0,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
  `
  console.log('✓ buckets table')

  await sql`
    CREATE TABLE IF NOT EXISTS entries (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      bucket_id INTEGER NOT NULL REFERENCES buckets(id) ON DELETE CASCADE,
      date DATE NOT NULL,
      checked BOOLEAN DEFAULT TRUE,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(user_id, bucket_id, date)
    );
  `
  console.log('✓ entries table')

  await sql`
    CREATE TABLE IF NOT EXISTS user_notes (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      date DATE NOT NULL,
      notes TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(user_id, date)
    );
  `
  console.log('✓ user_notes table')

  // Migration: Add user_id column to buckets if not exists
  const { rows: colCheck } = await sql`
    SELECT column_name FROM information_schema.columns
    WHERE table_name = 'buckets' AND column_name = 'user_id';
  `

  if (colCheck.length === 0) {
    console.log('Migrating buckets to per-user...')

    // Add nullable user_id column
    await sql`ALTER TABLE buckets ADD COLUMN user_id INTEGER REFERENCES users(id) ON DELETE CASCADE;`
    console.log('  ✓ Added user_id column')

    // Get all existing global buckets and users
    const { rows: globalBuckets } = await sql`SELECT id, name, sort_order FROM buckets WHERE user_id IS NULL;`
    const { rows: allUsers } = await sql`SELECT id FROM users;`

    if (globalBuckets.length > 0 && allUsers.length > 0) {
      // For each user, create copies of global buckets
      for (const user of allUsers) {
        for (const bucket of globalBuckets) {
          await sql`
            INSERT INTO buckets (user_id, name, sort_order)
            VALUES (${user.id}, ${bucket.name}, ${bucket.sort_order})
            ON CONFLICT DO NOTHING;
          `
        }
        console.log(`  ✓ Created buckets for user ${user.id}`)
      }

      // Update entries to point to user's own bucket (match by name)
      for (const user of allUsers) {
        for (const globalBucket of globalBuckets) {
          const { rows: userBucket } = await sql`
            SELECT id FROM buckets WHERE user_id = ${user.id} AND name = ${globalBucket.name} LIMIT 1;
          `
          if (userBucket.length > 0) {
            await sql`
              UPDATE entries
              SET bucket_id = ${userBucket[0].id}
              WHERE user_id = ${user.id} AND bucket_id = ${globalBucket.id};
            `
          }
        }
      }
      console.log('  ✓ Updated entry references')

      // Delete global buckets
      await sql`DELETE FROM buckets WHERE user_id IS NULL;`
      console.log('  ✓ Removed global buckets')
    }

    // Make user_id NOT NULL
    await sql`ALTER TABLE buckets ALTER COLUMN user_id SET NOT NULL;`

    // Drop old unique index if exists, create new one
    await sql`DROP INDEX IF EXISTS buckets_name_unique;`
    await sql`CREATE UNIQUE INDEX IF NOT EXISTS buckets_user_name_unique ON buckets(user_id, name);`
    console.log('  ✓ Updated constraints')
  } else {
    console.log('✓ buckets already migrated to per-user')
  }

  console.log('Migration complete!')
}

async function seedDefaultBuckets() {
  // Seed buckets for any users who don't have any
  const { rows: usersWithoutBuckets } = await sql`
    SELECT u.id FROM users u
    LEFT JOIN buckets b ON b.user_id = u.id
    GROUP BY u.id
    HAVING COUNT(b.id) = 0;
  `

  for (const user of usersWithoutBuckets) {
    for (const bucket of DEFAULT_BUCKETS) {
      await sql`
        INSERT INTO buckets (user_id, name, sort_order)
        VALUES (${user.id}, ${bucket.name}, ${bucket.sortOrder})
        ON CONFLICT (user_id, name) DO NOTHING;
      `
    }
    console.log(`Seeded default buckets for user ${user.id}`)
  }
}

// Run migration
try {
  await createPool()
  await migrate()
  await seedDefaultBuckets()
  process.exit(0)
} catch (error) {
  console.error('Migration failed:', error)
  process.exit(1)
}
