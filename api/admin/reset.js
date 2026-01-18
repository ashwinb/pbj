import { resetData } from '../_lib/db.js'
import { sendJson, methodNotAllowed } from '../_lib/http.js'
import { requireUser } from '../_lib/auth.js'

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return methodNotAllowed(res, ['POST'])
  }

  const auth = await requireUser(req, res)
  if (!auth) return

  if (!auth.isAdmin) {
    return sendJson(res, 403, { error: 'Forbidden' })
  }

  await resetData()
  return sendJson(res, 200, { ok: true })
}
