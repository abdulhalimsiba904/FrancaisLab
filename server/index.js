import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createGeminiProvider } from './ai/providers/gemini.js'
import { createGroqProvider } from './ai/providers/groq.js'
import { handleAIRequest } from './ai/service.js'

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)))
const PORT = 3001
const MAX_BODY_BYTES = 16 * 1024

async function loadLocalEnv() {
  let contents
  try {
    contents = await readFile(resolve(ROOT, '.env'), 'utf8')
  } catch {
    return
  }

  for (const line of contents.split(/\r?\n/u)) {
    const match = line.match(/^\s*(?:export\s+)?([A-Z][A-Z0-9_]*)\s*=\s*(.*?)\s*$/u)
    if (!match || process.env[match[1]] !== undefined) continue
    let value = match[2]
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1)
    }
    process.env[match[1]] = value
  }
}

function sendJson(response, status, body) {
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  })
  response.end(JSON.stringify(body))
}

async function readJsonBody(request) {
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

await loadLocalEnv()
const providers = {
  groq: createGroqProvider(process.env),
  gemini: createGeminiProvider(process.env),
}

const server = createServer(async (request, response) => {
  const pathname = new URL(request.url ?? '/', 'http://127.0.0.1').pathname
  if (pathname !== '/api/ai') {
    sendJson(response, 404, { error: { code: 'not_found', message: 'This API route was not found.', retryable: false } })
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

  try {
    const body = await readJsonBody(request)
    const result = await handleAIRequest(body, providers)
    sendJson(response, result.status, result.body)
  } catch (error) {
    const status = error?.status === 413 ? 413 : error?.status === 400 ? 400 : 500
    const body = status === 413
      ? { error: { code: 'request_too_large', message: 'This selection is too large. Select a shorter passage.', retryable: false } }
      : status === 400
        ? { error: { code: 'invalid_json', message: 'The request could not be read. Please try again.', retryable: false } }
        : { error: { code: 'server_error', message: 'The request could not be completed. Please try again.', retryable: true } }
    sendJson(response, status, body)
  }
})

server.listen(PORT, '127.0.0.1', () => {
  process.stdout.write(`FrançaisLab AI API listening on http://127.0.0.1:${PORT}\n`)
})

server.on('error', () => {
  process.stderr.write('FrançaisLab AI API could not start. Check whether port 3001 is already in use.\n')
  process.exitCode = 1
})
