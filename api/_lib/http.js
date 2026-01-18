export async function readJson(req) {
  let body = ''
  for await (const chunk of req) {
    body += chunk
  }
  if (!body) return null
  try {
    return JSON.parse(body)
  } catch (error) {
    return null
  }
}

export function sendJson(res, status, payload) {
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json')
  res.end(JSON.stringify(payload))
}

export function methodNotAllowed(res, methods) {
  res.statusCode = 405
  res.setHeader('Allow', methods.join(', '))
  res.end(JSON.stringify({ error: 'Method not allowed' }))
}
