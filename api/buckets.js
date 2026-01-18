import { sql } from '@vercel/postgres'
import { ensureSchema, seedBuckets } from './_lib/db.js'
import { readJson, sendJson, methodNotAllowed } from './_lib/http.js'
import { requireUser } from './_lib/auth.js'

export default async function handler(req, res) {
  if (!['GET', 'POST', 'PUT', 'DELETE'].includes(req.method)) {
    return methodNotAllowed(res, ['GET', 'POST', 'PUT', 'DELETE'])
  }

  const auth = await requireUser(req, res)
  if (!auth) return

  await ensureSchema()

  if (req.method === 'GET') {
    await seedBuckets()
    const { rows } = await sql`
      SELECT id, name, sort_order AS "sortOrder"
      FROM buckets
      ORDER BY sort_order ASC, id ASC;
    `
    return sendJson(res, 200, { buckets: rows })
  }

  const payload = await readJson(req)
  if (!payload) {
    return sendJson(res, 400, { error: 'Missing payload' })
  }

  if (req.method === 'POST') {
    const { name } = payload
    if (!name?.trim()) {
      return sendJson(res, 400, { error: 'Bucket name required' })
    }
    const { rows: maxRows } = await sql`SELECT COALESCE(MAX(sort_order), 0) AS max FROM buckets;`
    const nextOrder = Number(maxRows[0]?.max || 0) + 1
    const { rows } = await sql`
      INSERT INTO buckets (name, sort_order)
      VALUES (${name.trim()}, ${nextOrder})
      RETURNING id, name, sort_order AS "sortOrder";
    `
    return sendJson(res, 200, { bucket: rows[0] })
  }

  if (req.method === 'PUT') {
    const { id, name, sortOrder } = payload
    if (!id) {
      return sendJson(res, 400, { error: 'Bucket id required' })
    }
    const { rows } = await sql`
      UPDATE buckets
      SET name = COALESCE(${name?.trim() || null}, name),
          sort_order = COALESCE(${Number.isInteger(sortOrder) ? sortOrder : null}, sort_order)
      WHERE id = ${id}
      RETURNING id, name, sort_order AS "sortOrder";
    `
    return sendJson(res, 200, { bucket: rows[0] })
  }

  if (req.method === 'DELETE') {
    const { id } = payload
    if (!id) {
      return sendJson(res, 400, { error: 'Bucket id required' })
    }
    await sql`DELETE FROM buckets WHERE id = ${id};`
    return sendJson(res, 200, { ok: true })
  }
}
