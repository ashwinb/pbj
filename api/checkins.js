import { sql } from '@vercel/postgres'
import { ensureSchema } from './_lib/db.js'
import { readJson, sendJson, methodNotAllowed } from './_lib/http.js'
import { requireUser } from './_lib/auth.js'

function monthBounds(month) {
  const [year, monthPart] = month.split('-').map(Number)
  const start = new Date(Date.UTC(year, monthPart - 1, 1))
  const end = new Date(Date.UTC(year, monthPart, 0))
  return {
    start: start.toISOString().slice(0, 10),
    end: end.toISOString().slice(0, 10),
  }
}

export default async function handler(req, res) {
  if (!['GET', 'POST'].includes(req.method)) {
    return methodNotAllowed(res, ['GET', 'POST'])
  }

  const auth = await requireUser(req, res)
  if (!auth) return

  await ensureSchema()

  if (req.method === 'GET') {
    const url = new URL(req.url, `http://${req.headers.host}`)
    const month = url.searchParams.get('month')
    if (!month) {
      return sendJson(res, 400, { error: 'month is required' })
    }

    const { start, end } = monthBounds(month)

    const usersResult = await sql`
      SELECT id, email, name, image
      FROM users
      ORDER BY name ASC;
    `

    const entriesResult = await sql`
      SELECT user_id AS "userId",
             bucket_id AS "bucketId",
             date::text AS date,
             checked
      FROM entries
      WHERE date BETWEEN ${start} AND ${end};
    `

    return sendJson(res, 200, {
      users: usersResult.rows,
      entries: entriesResult.rows,
    })
  }

  const payload = await readJson(req)
  if (!payload?.bucketId || !payload?.date) {
    return sendJson(res, 400, { error: 'bucketId and date required' })
  }

  const checked = payload.checked !== false
  const date = payload.date

  // Validate date is within editable range (today and past 2 days)
  const todayDate = new Date().toISOString().slice(0, 10)
  const earliest = new Date()
  earliest.setDate(earliest.getDate() - 2)
  const earliestDate = earliest.toISOString().slice(0, 10)

  if (date < earliestDate || date > todayDate) {
    return sendJson(res, 400, { error: 'Can only edit entries for today and past 2 days' })
  }

  await sql`
    INSERT INTO entries (user_id, bucket_id, date, checked)
    VALUES (${auth.user.id}, ${payload.bucketId}, ${date}, ${checked})
    ON CONFLICT (user_id, bucket_id, date)
    DO UPDATE SET checked = EXCLUDED.checked;
  `

  return sendJson(res, 200, { ok: true })
}
