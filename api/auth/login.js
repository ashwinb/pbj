import { OAuth2Client } from 'google-auth-library'
import { sql } from '@vercel/postgres'
import { ensureSchema } from '../_lib/db.js'
import { createSession, setSessionCookie } from '../_lib/auth.js'
import { readJson, sendJson, methodNotAllowed } from '../_lib/http.js'

const client = new OAuth2Client()

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return methodNotAllowed(res, ['POST'])
  }

  const payload = await readJson(req)
  if (!payload?.credential) {
    return sendJson(res, 400, { error: 'Missing credential' })
  }

  if (!process.env.GOOGLE_CLIENT_ID) {
    return sendJson(res, 500, { error: 'Missing GOOGLE_CLIENT_ID' })
  }

  const ticket = await client.verifyIdToken({
    idToken: payload.credential,
    audience: process.env.GOOGLE_CLIENT_ID,
  })
  const profile = ticket.getPayload()

  if (!profile?.email) {
    return sendJson(res, 401, { error: 'Unable to verify Google account' })
  }

  await ensureSchema()

  const { rows } = await sql`
    INSERT INTO users (email, name, image)
    VALUES (${profile.email}, ${profile.name || profile.email}, ${profile.picture || null})
    ON CONFLICT (email)
    DO UPDATE SET name = EXCLUDED.name, image = EXCLUDED.image
    RETURNING id, email, name, image;
  `

  const user = rows[0]
  const { token, expiresAt } = await createSession(user.id)
  setSessionCookie(res, token, expiresAt)

  return sendJson(res, 200, {
    user,
  })
}
