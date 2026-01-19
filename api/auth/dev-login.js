import { sql } from '../_lib/sql.js'
import { ensureSchema } from '../_lib/db.js'
import { createSession, setSessionCookie } from '../_lib/auth.js'
import { readJson, sendJson, methodNotAllowed } from '../_lib/http.js'

export default async function handler(req, res) {
  // Only allow in dev mode
  if (process.env.DEV_AUTH !== 'true') {
    return sendJson(res, 404, { error: 'Not found' })
  }

  if (req.method !== 'POST') {
    return methodNotAllowed(res, ['POST'])
  }

  // Handle both pre-parsed body (vercel dev) and stream (production)
  const payload = req.body || await readJson(req)
  if (!payload?.email) {
    return sendJson(res, 400, { error: 'Email required' })
  }

  await ensureSchema()

  const email = payload.email.trim().toLowerCase()

  // Find or create user
  let { rows } = await sql`
    SELECT id, email, name, image FROM users WHERE email = ${email}
  `

  let user
  if (rows.length === 0) {
    // Create user
    const result = await sql`
      INSERT INTO users (email, name, image)
      VALUES (${email}, ${email.split('@')[0]}, ${`https://i.pravatar.cc/150?u=${email}`})
      RETURNING id, email, name, image
    `
    user = result.rows[0]
  } else {
    user = rows[0]
  }

  // Create session
  const { token, expiresAt } = await createSession(user.id)
  setSessionCookie(res, token, expiresAt)

  return sendJson(res, 200, { user })
}
