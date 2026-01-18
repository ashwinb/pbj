import { sql } from '@vercel/postgres'
import { clearSessionCookie, getUserFromRequest } from '../_lib/auth.js'
import { sendJson, methodNotAllowed } from '../_lib/http.js'

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return methodNotAllowed(res, ['POST'])
  }

  const { sessionId } = await getUserFromRequest(req)
  if (sessionId) {
    await sql`DELETE FROM sessions WHERE id = ${sessionId};`
  }
  clearSessionCookie(res)
  return sendJson(res, 200, { ok: true })
}
