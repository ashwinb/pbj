import { sql } from './_lib/sql.js'
import { ensureSchema, MAX_BUCKETS_PER_USER } from './_lib/db.js'
import { readJson, sendJson, methodNotAllowed } from './_lib/http.js'
import { requireUser } from './_lib/auth.js'

export default async function handler(req, res) {
  if (!['GET', 'POST', 'PUT', 'DELETE'].includes(req.method)) {
    return methodNotAllowed(res, ['GET', 'POST', 'PUT', 'DELETE'])
  }

  const auth = await requireUser(req, res)
  if (!auth) return

  await ensureSchema()

  const userId = auth.user.id

  if (req.method === 'GET') {
    const { rows } = await sql`
      SELECT id, name, sort_order AS "sortOrder"
      FROM buckets
      WHERE user_id = ${userId}
      ORDER BY sort_order ASC, id ASC;
    `
    return sendJson(res, 200, { buckets: rows })
  }

  const payload = req.body || await readJson(req)
  if (!payload) {
    return sendJson(res, 400, { error: 'Missing payload' })
  }

  if (req.method === 'POST') {
    const { name } = payload
    if (!name?.trim()) {
      return sendJson(res, 400, { error: 'Bucket name required' })
    }

    // Check bucket limit
    const { rows: countRows } = await sql`SELECT COUNT(*)::int AS count FROM buckets WHERE user_id = ${userId};`
    if (countRows[0].count >= MAX_BUCKETS_PER_USER) {
      return sendJson(res, 400, { error: `Maximum ${MAX_BUCKETS_PER_USER} habits allowed` })
    }

    const { rows: maxRows } = await sql`SELECT COALESCE(MAX(sort_order), 0) AS max FROM buckets WHERE user_id = ${userId};`
    const nextOrder = Number(maxRows[0]?.max || 0) + 1
    const { rows } = await sql`
      INSERT INTO buckets (user_id, name, sort_order)
      VALUES (${userId}, ${name.trim()}, ${nextOrder})
      RETURNING id, name, sort_order AS "sortOrder";
    `
    return sendJson(res, 200, { bucket: rows[0] })
  }

  if (req.method === 'PUT') {
    const { id, name, sortOrder } = payload
    if (!id) {
      return sendJson(res, 400, { error: 'Bucket id required' })
    }

    // Verify ownership
    const { rows: ownerCheck } = await sql`SELECT id FROM buckets WHERE id = ${id} AND user_id = ${userId};`
    if (ownerCheck.length === 0) {
      return sendJson(res, 404, { error: 'Bucket not found' })
    }

    const { rows } = await sql`
      UPDATE buckets
      SET name = COALESCE(${name?.trim() || null}, name),
          sort_order = COALESCE(${Number.isInteger(sortOrder) ? sortOrder : null}, sort_order)
      WHERE id = ${id} AND user_id = ${userId}
      RETURNING id, name, sort_order AS "sortOrder";
    `
    return sendJson(res, 200, { bucket: rows[0] })
  }

  if (req.method === 'DELETE') {
    const { id } = payload
    if (!id) {
      return sendJson(res, 400, { error: 'Bucket id required' })
    }

    // Verify ownership
    const { rows: ownerCheck } = await sql`SELECT id FROM buckets WHERE id = ${id} AND user_id = ${userId};`
    if (ownerCheck.length === 0) {
      return sendJson(res, 404, { error: 'Bucket not found' })
    }

    await sql`DELETE FROM buckets WHERE id = ${id} AND user_id = ${userId};`
    return sendJson(res, 200, { ok: true })
  }
}
