import { handleAIRequest } from './service.js'

const MAX_BODY_BYTES = 16 * 1024

export function sendJson(response, status, body, extraHeaders = {}) {
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    ...extraHeaders,
  })
  response.end(JSON.stringify(body))
}

export function requestOriginAllowed(request, allowedOrigins = [], originContext) {
  const suppliedOrigin = request.headers.origin
  if (!suppliedOrigin) return true

  let origin
  try {
    origin = new URL(suppliedOrigin)
  } catch {
    return false
  }
  if (!['http:', 'https:'].includes(origin.protocol) || origin.origin !== suppliedOrigin) return false
  if (allowedOrigins.length > 0) return allowedOrigins.includes(origin.origin)

  const context = originContext ?? {
    host: request.headers.host,
    protocol: request.socket?.encrypted ? 'https:' : 'http:',
  }
  return Boolean(context.host && ['http:', 'https:'].includes(context.protocol)
    && origin.host.toLowerCase() === context.host.toLowerCase()
    && origin.protocol === context.protocol)
}

async function readJsonBody(request) {
  // Vercel's Node Functions may provide an already-parsed request body.
  let parsedBody
  try {
    parsedBody = request.body
  } catch {
    throw Object.assign(new Error('invalid_json'), { status: 400 })
  }
  if (parsedBody !== undefined) {
    if (typeof parsedBody === 'string' || Buffer.isBuffer(parsedBody)) {
      if (Buffer.byteLength(parsedBody) > MAX_BODY_BYTES) throw Object.assign(new Error('too_large'), { status: 413 })
      try { return JSON.parse(parsedBody.toString()) } catch { throw Object.assign(new Error('invalid_json'), { status: 400 }) }
    }
    try {
      if (Buffer.byteLength(JSON.stringify(parsedBody)) > MAX_BODY_BYTES) throw Object.assign(new Error('too_large'), { status: 413 })
    } catch (error) {
      if (error?.status === 413) throw error
      throw Object.assign(new Error('invalid_json'), { status: 400 })
    }
    return parsedBody
  }

  const chunks = []
  let size = 0
  for await (const chunk of request) {
    size += chunk.length
    if (size > MAX_BODY_BYTES) throw Object.assign(new Error('too_large'), { status: 413 })
    chunks.push(chunk)
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'))
  } catch {
    throw Object.assign(new Error('invalid_json'), { status: 400 })
  }
}

export async function handleAIEndpoint(request, response, {
  providers,
  allowedOrigins = [],
  originContext,
  consumeRateLimit,
} = {}) {
  if (!requestOriginAllowed(request, allowedOrigins, typeof originContext === 'function' ? originContext(request) : originContext)) {
    sendJson(response, 403, { error: { code: 'origin_not_allowed', message: 'This request origin is not allowed.', retryable: false } })
    return
  }
  if (request.method !== 'POST') {
    sendJson(response, 405, { error: { code: 'method_not_allowed', message: 'Use POST for this request.', retryable: false } })
    return
  }
  if (!request.headers['content-type']?.toLowerCase().includes('application/json')) {
    sendJson(response, 415, { error: { code: 'unsupported_media_type', message: 'Send this request as JSON.', retryable: false } })
    return
  }
  if (consumeRateLimit) {
    const limit = consumeRateLimit(request)
    if (!limit.allowed) {
      sendJson(response, 429, { error: { code: 'rate_limited', message: 'Too many AI requests. Please wait before trying again.', retryable: true } }, {
        'Retry-After': String(limit.retryAfter),
      })
      return
    }
  }

  try {
    const body = await readJsonBody(request)
    const result = await handleAIRequest(body, providers)
    sendJson(response, result.status, result.body, result.headers)
  } catch (error) {
    const status = error?.status === 413 ? 413 : error?.status === 400 ? 400 : 500
    const body = status === 413
      ? { error: { code: 'request_too_large', message: 'This selection is too large. Select a shorter passage.', retryable: false } }
      : status === 400
        ? { error: { code: 'invalid_json', message: 'The request could not be read. Please try again.', retryable: false } }
        : { error: { code: 'server_error', message: 'The request could not be completed. Please try again.', retryable: true } }
    sendJson(response, status, body)
  }
}
