import { getUserFromRequest } from '../_lib/auth.js'
import { sendJson, methodNotAllowed } from '../_lib/http.js'

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return methodNotAllowed(res, ['GET'])
  }

  const { user, isAdmin } = await getUserFromRequest(req)
  return sendJson(res, 200, { user, isAdmin })
}
