import pg from 'pg'

const TEST_USERS = [
  { email: 'alice@test.local', name: 'Alice Johnson', image: 'https://i.pravatar.cc/150?u=alice' },
  { email: 'bob@test.local', name: 'Bob Smith', image: 'https://i.pravatar.cc/150?u=bob' },
  { email: 'carol@test.local', name: 'Carol Davis', image: 'https://i.pravatar.cc/150?u=carol' },
  { email: 'dan@test.local', name: 'Dan Wilson', image: 'https://i.pravatar.cc/150?u=dan' },
]

const TEST_BUCKETS = [
  { name: '10 min calisthenics', sortOrder: 1 },
  { name: '25 min cardio', sortOrder: 2 },
  { name: 'Stretching / mobility', sortOrder: 3 },
  { name: 'Meditation', sortOrder: 4 },
]

async function seed() {
  const connectionString = process.env.POSTGRES_URL || 'postgres://pbj:pbj@localhost:5432/pbj'
  const client = new pg.Client({ connectionString })

  try {
    await client.connect()
    console.log('Connected to database')

    // Create tables
    await client.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        email TEXT UNIQUE NOT NULL,
        name TEXT,
        image TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
    `)

    await client.query(`
      CREATE TABLE IF NOT EXISTS buckets (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL,
        sort_order INTEGER DEFAULT 0,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
    `)

    await client.query(`
      CREATE TABLE IF NOT EXISTS entries (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        bucket_id INTEGER REFERENCES buckets(id) ON DELETE CASCADE,
        date DATE NOT NULL,
        checked BOOLEAN NOT NULL DEFAULT TRUE,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE (user_id, bucket_id, date)
      );
    `)

    await client.query(`
      CREATE TABLE IF NOT EXISTS sessions (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        token_hash TEXT UNIQUE NOT NULL,
        expires_at TIMESTAMPTZ NOT NULL,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
    `)

    // Clean existing test data
    await client.query(`DELETE FROM entries;`)
    await client.query(`DELETE FROM sessions;`)
    await client.query(`DELETE FROM buckets;`)
    await client.query(`DELETE FROM users;`)
    console.log('Cleaned existing data')

    // Insert test users
    const userIds = []
    for (const user of TEST_USERS) {
      const result = await client.query(
        `INSERT INTO users (email, name, image) VALUES ($1, $2, $3) RETURNING id`,
        [user.email, user.name, user.image]
      )
      userIds.push(result.rows[0].id)
    }
    console.log(`Created ${userIds.length} test users`)

    // Insert buckets
    const bucketIds = []
    for (const bucket of TEST_BUCKETS) {
      const result = await client.query(
        `INSERT INTO buckets (name, sort_order) VALUES ($1, $2) RETURNING id`,
        [bucket.name, bucket.sortOrder]
      )
      bucketIds.push(result.rows[0].id)
    }
    console.log(`Created ${bucketIds.length} buckets`)

    // Generate random entries for the past 60 days
    const daysBack = 60
    let entryCount = 0

    for (const userId of userIds) {
      // Each user has a different consistency level (40-90%)
      const consistency = 0.4 + Math.random() * 0.5

      for (let d = 0; d < daysBack; d++) {
        const date = new Date()
        date.setDate(date.getDate() - d)
        const dateStr = date.toISOString().slice(0, 10)

        for (const bucketId of bucketIds) {
          // Random check based on user's consistency
          if (Math.random() < consistency) {
            await client.query(
              `INSERT INTO entries (user_id, bucket_id, date, checked) VALUES ($1, $2, $3, $4)
               ON CONFLICT (user_id, bucket_id, date) DO UPDATE SET checked = EXCLUDED.checked`,
              [userId, bucketId, dateStr, true]
            )
            entryCount++
          }
        }
      }
    }
    console.log(`Created ${entryCount} check-in entries`)

    console.log('\nTest data seeded successfully!')
    console.log('\nTest users (use any email for dev login):')
    TEST_USERS.forEach(u => console.log(`  - ${u.email} (${u.name})`))

  } catch (err) {
    console.error('Error seeding data:', err)
    process.exit(1)
  } finally {
    await client.end()
  }
}

seed()
