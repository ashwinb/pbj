import { createHash, randomBytes } from 'crypto'
import { parse, serialize } from 'cookie'
import { sql } from '@vercel/postgres'
import { ensureSchema } from './db.js'

const SESSION_COOKIE = 'pbj_session'
const SESSION_DAYS = 45
const ADMIN_EMAILS = new Set(['ashwinb@gmail.com'])

export function isAdminEmail(email) {
  return ADMIN_EMAILS.has(email)
}

function hashToken(token) {
  return createHash('sha256').update(token).digest('hex')
}

export async function createSession(userId) {
  await ensureSchema()
  const token = randomBytes(32).toString('hex')
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000)
  const tokenHash = hashToken(token)
  await sql`
    INSERT INTO sessions (user_id, token_hash, expires_at)
    VALUES (${userId}, ${tokenHash}, ${expiresAt.toISOString()});
  `
  return { token, expiresAt }
}

export function setSessionCookie(res, token, expiresAt) {
  const cookie = serialize(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    expires: expiresAt,
  })
  res.setHeader('Set-Cookie', cookie)
}

export function clearSessionCookie(res) {
  res.setHeader(
    'Set-Cookie',
    serialize(SESSION_COOKIE, '', {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      path: '/',
      expires: new Date(0),
    })
  )
}

export async function getUserFromRequest(req) {
  await ensureSchema()
  const cookies = parse(req.headers.cookie || '')
  const token = cookies[SESSION_COOKIE]
  if (!token) return { user: null, isAdmin: false, sessionId: null }

  const tokenHash = hashToken(token)
  const { rows } = await sql`
    SELECT sessions.id AS session_id,
           users.id AS user_id,
           users.email,
           users.name,
           users.image,
           sessions.expires_at
    FROM sessions
    JOIN users ON users.id = sessions.user_id
    WHERE sessions.token_hash = ${tokenHash};
  `

  const session = rows[0]
  if (!session) return { user: null, isAdmin: false, sessionId: null }

  if (new Date(session.expires_at) < new Date()) {
    await sql`DELETE FROM sessions WHERE id = ${session.session_id};`
    return { user: null, isAdmin: false, sessionId: null }
  }

  const user = {
    id: session.user_id,
    email: session.email,
    name: session.name,
    image: session.image,
  }

  return {
    user,
    isAdmin: isAdminEmail(session.email),
    sessionId: session.session_id,
  }
}

export async function requireUser(req, res) {
  const { user, isAdmin, sessionId } = await getUserFromRequest(req)
  if (!user) {
    res.statusCode = 401
    res.end(JSON.stringify({ error: 'Unauthorized' }))
    return null
  }
  return { user, isAdmin, sessionId }
}
