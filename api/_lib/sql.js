import pg from 'pg'

let pool = null

function getPool() {
  if (!pool) {
    pool = new pg.Pool({
      connectionString: process.env.POSTGRES_URL,
      ssl: process.env.POSTGRES_URL?.includes('sslmode=require')
        ? { rejectUnauthorized: false }
        : false,
    })
  }
  return pool
}

// Tagged template function compatible with @vercel/postgres style
export function sql(strings, ...values) {
  const text = strings.reduce((acc, str, i) => {
    return acc + str + (i < values.length ? `$${i + 1}` : '')
  }, '')

  return getPool().query(text, values)
}
