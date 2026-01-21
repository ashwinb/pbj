#!/usr/bin/env node
/**
 * Database migration script. Run once when deploying schema changes.
 * Usage: node scripts/migrate.js [--dry-run]
 */

import { sql, createPool } from '../api/_lib/sql.js'

const DRY_RUN = process.argv.includes('--dry-run')

const DEFAULT_BUCKETS = [
  { name: '10 min calisthenics', sortOrder: 1 },
  { name: '25 min cardio', sortOrder: 2 },
  { name: 'Stretching / mobility', sortOrder: 3 },
]

async function migrate() {
  if (DRY_RUN) {
    console.log('=== DRY RUN MODE - No changes will be made ===\n')
  }
  console.log('Starting migration...')

  // Create base tables if they don't exist
  if (!DRY_RUN) {
    await sql`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        email TEXT UNIQUE NOT NULL,
        name TEXT,
        image TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
    `
  }
  console.log('✓ users table')

  if (!DRY_RUN) {
    await sql`
      CREATE TABLE IF NOT EXISTS sessions (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        token_hash TEXT UNIQUE NOT NULL,
        expires_at TIMESTAMPTZ NOT NULL,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
    `
  }
  console.log('✓ sessions table')

  if (!DRY_RUN) {
    await sql`
      CREATE TABLE IF NOT EXISTS buckets (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL,
        sort_order INTEGER DEFAULT 0,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
    `
  }
  console.log('✓ buckets table')

  if (!DRY_RUN) {
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
  }
  console.log('✓ entries table')

  if (!DRY_RUN) {
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
  }
  console.log('✓ user_notes table')

  // Migration: Add user_id column to buckets if not exists
  const { rows: colCheck } = await sql`
    SELECT column_name FROM information_schema.columns
    WHERE table_name = 'buckets' AND column_name = 'user_id';
  `

  if (colCheck.length === 0) {
    console.log('\nMigrating buckets to per-user...')

    if (!DRY_RUN) {
      await sql`ALTER TABLE buckets ADD COLUMN user_id INTEGER REFERENCES users(id) ON DELETE CASCADE;`
      // Drop old unique constraint on name alone BEFORE inserting per-user buckets
      await sql`DROP INDEX IF EXISTS buckets_name_unique;`
    }
    console.log('  ✓ Added user_id column')
    console.log('  ✓ Dropped old name-only unique constraint')

    // Get all existing global buckets and users
    const { rows: globalBuckets } = await sql`SELECT id, name, sort_order FROM buckets WHERE user_id IS NULL;`
    const { rows: allUsers } = await sql`SELECT id, email FROM users;`

    console.log(`\n  Found ${globalBuckets.length} global bucket(s):`)
    for (const bucket of globalBuckets) {
      console.log(`    - id=${bucket.id}: "${bucket.name}"`)
    }

    console.log(`\n  Found ${allUsers.length} user(s):`)
    for (const user of allUsers) {
      console.log(`    - id=${user.id}: ${user.email}`)
    }

    if (globalBuckets.length > 0 && allUsers.length > 0) {
      // For each user, create copies of global buckets
      console.log('\n  Creating per-user buckets:')
      for (const user of allUsers) {
        for (const bucket of globalBuckets) {
          if (!DRY_RUN) {
            await sql`
              INSERT INTO buckets (user_id, name, sort_order)
              VALUES (${user.id}, ${bucket.name}, ${bucket.sort_order});
            `
          }
          console.log(`    - User ${user.id} gets bucket "${bucket.name}"`)
        }
      }

      // Show entries that will be re-linked
      console.log('\n  Entries to be re-linked:')
      for (const user of allUsers) {
        for (const globalBucket of globalBuckets) {
          const { rows: entries } = await sql`
            SELECT id, date FROM entries
            WHERE user_id = ${user.id} AND bucket_id = ${globalBucket.id}
            ORDER BY date;
          `
          if (entries.length > 0) {
            console.log(`    - User ${user.id}, bucket "${globalBucket.name}": ${entries.length} entries`)
            if (entries.length <= 5) {
              for (const e of entries) {
                console.log(`      • ${e.date}`)
              }
            } else {
              for (const e of entries.slice(0, 3)) {
                console.log(`      • ${e.date}`)
              }
              console.log(`      ... and ${entries.length - 3} more`)
            }
          }
        }
      }

      // Update entries to point to user's own bucket (match by name)
      if (!DRY_RUN) {
        for (const user of allUsers) {
          for (const globalBucket of globalBuckets) {
            const { rows: userBucket } = await sql`
              SELECT id FROM buckets WHERE user_id = ${user.id} AND name = ${globalBucket.name} LIMIT 1;
            `
            if (userBucket.length > 0) {
              const result = await sql`
                UPDATE entries
                SET bucket_id = ${userBucket[0].id}
                WHERE user_id = ${user.id} AND bucket_id = ${globalBucket.id};
              `
              if (result.rowCount > 0) {
                console.log(`  ✓ Re-linked ${result.rowCount} entries for user ${user.id}, bucket "${globalBucket.name}"`)
              }
            }
          }
        }
      }

      // SAFETY CHECK: Verify no entries still reference global buckets
      if (!DRY_RUN) {
        const { rows: orphanedEntries } = await sql`
          SELECT e.id, e.user_id, e.bucket_id, b.name as bucket_name
          FROM entries e
          JOIN buckets b ON b.id = e.bucket_id
          WHERE b.user_id IS NULL;
        `

        if (orphanedEntries.length > 0) {
          console.error('  ✗ ABORTING: Found entries still referencing global buckets:')
          for (const entry of orphanedEntries) {
            console.error(`    - Entry ${entry.id}: user ${entry.user_id}, bucket "${entry.bucket_name}" (id ${entry.bucket_id})`)
          }
          throw new Error('Cannot delete global buckets - entries would be lost. Fix manually.')
        }

        console.log('  ✓ Verified all entries re-linked')

        // Safe to delete global buckets now
        await sql`DELETE FROM buckets WHERE user_id IS NULL;`
        console.log('  ✓ Removed global buckets')
      } else {
        console.log('\n  [DRY RUN] Would delete global buckets after re-linking entries')
      }
    } else if (globalBuckets.length > 0) {
      // No users exist, just delete the global buckets
      if (!DRY_RUN) {
        await sql`DELETE FROM buckets WHERE user_id IS NULL;`
      }
      console.log('  ✓ Removed global buckets (no users existed)')
    }

    // Make user_id NOT NULL and add new constraint
    if (!DRY_RUN) {
      await sql`ALTER TABLE buckets ALTER COLUMN user_id SET NOT NULL;`
      await sql`CREATE UNIQUE INDEX IF NOT EXISTS buckets_user_name_unique ON buckets(user_id, name);`
    }
    console.log('  ✓ Updated constraints')
  } else {
    console.log('✓ buckets already migrated to per-user')
  }

  // Ensure unique index exists (might be missing from partial migration)
  if (!DRY_RUN) {
    await sql`CREATE UNIQUE INDEX IF NOT EXISTS buckets_user_name_unique ON buckets(user_id, name);`
  }

  if (DRY_RUN) {
    console.log('\n=== DRY RUN COMPLETE - No changes were made ===')
  } else {
    console.log('\nMigration complete!')
  }
}

async function seedDefaultBuckets() {
  // Seed buckets for any users who don't have any
  const { rows: usersWithoutBuckets } = await sql`
    SELECT u.id FROM users u
    LEFT JOIN buckets b ON b.user_id = u.id
    GROUP BY u.id
    HAVING COUNT(b.id) = 0;
  `

  if (usersWithoutBuckets.length > 0) {
    console.log('\nSeeding default buckets for users without any:')
  }

  for (const user of usersWithoutBuckets) {
    if (!DRY_RUN) {
      for (const bucket of DEFAULT_BUCKETS) {
        await sql`
          INSERT INTO buckets (user_id, name, sort_order)
          VALUES (${user.id}, ${bucket.name}, ${bucket.sortOrder})
          ON CONFLICT (user_id, name) DO NOTHING;
        `
      }
    }
    console.log(`  ✓ Seeded default buckets for user ${user.id}`)
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
