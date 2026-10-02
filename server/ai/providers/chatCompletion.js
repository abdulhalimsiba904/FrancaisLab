import { ProviderFailure } from '../providerTypes.js'

const REQUEST_TIMEOUT_MS = 12_000
const MAX_PROVIDER_RESPONSE_BYTES = 64 * 1024

function retryAfterSeconds(response) {
  const value = response.headers?.get?.('retry-after')
  if (!value) return undefined
  const seconds = Number(value)
  if (Number.isFinite(seconds) && seconds > 0) return Math.min(Math.ceil(seconds), 300)
  const date = Date.parse(value)
  if (!Number.isFinite(date)) return undefined
  const remaining = Math.ceil((date - Date.now()) / 1000)
  return remaining > 0 ? Math.min(remaining, 300) : undefined
}

export async function requestChatCompletion({ endpoint, apiKey, model, messages, maxTokens }) {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)

  try {
    let response
    try {
      response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model,
          messages,
          max_completion_tokens: maxTokens,
          stream: false,
        }),
        signal: controller.signal,
      })
    } catch {
      throw new ProviderFailure(controller.signal.aborted ? 'timeout' : 'network', true)
    }

    if (!response.ok) {
      const status = response.status
      const transient = status === 408 || status === 425 || status === 429 || status >= 500
      const kind = status === 401 || status === 403
        ? 'credentials'
        : status === 429
          ? 'rate_limit'
          : status === 408
            ? 'timeout'
            : status >= 500 || status === 425
              ? 'service'
              : 'request'
      throw new ProviderFailure(kind, transient, { status, retryAfterSeconds: retryAfterSeconds(response) })
    }

    let raw = ''
    try {
      raw = await response.text()
    } catch {
      throw new ProviderFailure(controller.signal.aborted ? 'timeout' : 'malformed_response', controller.signal.aborted)
    }
    if (Buffer.byteLength(raw, 'utf8') > MAX_PROVIDER_RESPONSE_BYTES) {
      throw new ProviderFailure('malformed_response', false)
    }

    let payload
    try {
      payload = JSON.parse(raw)
    } catch {
      throw new ProviderFailure('malformed_response', false)
    }
    const content = payload?.choices?.[0]?.message?.content
    if (typeof content !== 'string' || !content.trim() || content.length > 4_000) {
      throw new ProviderFailure('malformed_response', false)
    }
    return content.trim()
  } finally {
    clearTimeout(timeout)
  }
}
