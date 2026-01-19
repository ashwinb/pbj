import { sql } from './_lib/sql.js'
import { ensureSchema } from './_lib/db.js'
import { readJson, sendJson, methodNotAllowed } from './_lib/http.js'
import { requireUser } from './_lib/auth.js'

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return methodNotAllowed(res, ['POST'])
  }

  const auth = await requireUser(req, res)
  if (!auth) return

  await ensureSchema()

  const payload = req.body || await readJson(req)
  if (!payload?.date) {
    return sendJson(res, 400, { error: 'date required' })
  }

  const { date, notes } = payload

  if (!notes?.trim()) {
    await sql`
      DELETE FROM user_notes
      WHERE user_id = ${auth.user.id} AND date = ${date};
    `
  } else {
    await sql`
      INSERT INTO user_notes (user_id, date, notes, updated_at)
      VALUES (${auth.user.id}, ${date}, ${notes.trim()}, NOW())
      ON CONFLICT (user_id, date)
      DO UPDATE SET notes = EXCLUDED.notes, updated_at = NOW();
    `
  }

  return sendJson(res, 200, { ok: true })
}
