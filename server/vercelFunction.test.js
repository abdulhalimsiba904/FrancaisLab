import test from 'node:test'
import assert from 'node:assert/strict'
import { Readable } from 'node:stream'
import { createVercelAIHandler } from '../api/ai.js'
import { ProviderFailure } from './ai/providerTypes.js'

function mockRequest(body, headers = {}) {
  const request = Readable.from([Buffer.from(JSON.stringify(body))])
  request.method = 'POST'
  request.url = '/api/ai'
  request.headers = { 'content-type': 'application/json', host: 'study.example', 'x-forwarded-proto': 'https', ...headers }
  request.socket = { remoteAddress: '127.0.0.1' }
  return request
}

function mockResponse() {
  return {
    statusCode: 0,
    headers: {},
    writeHead(status, headers) { this.statusCode = status; this.headers = headers },
    end(body) { this.body = JSON.parse(body) },
  }
}

function mockParsedRequest(body, headers = {}) {
  return {
    method: 'POST',
    url: '/api/ai',
    body,
    headers: { 'content-type': 'application/json', host: 'study.example', 'x-forwarded-proto': 'https', ...headers },
    socket: { remoteAddress: '127.0.0.1' },
  }
}

test('Vercel function handles a valid mocked translation through the shared AI service', async () => {
  const calls = []
  const handler = createVercelAIHandler({
    allowedOrigins: [],
    providers: {
      groq: { apiKey: 'mock', name: 'Groq', async complete(input) { calls.push(input); return 'Hello.' } },
      gemini: null,
    },
  })
  const response = mockResponse()
  await handler(mockRequest({ action: 'translate', text: 'Bonjour.' }, { origin: 'https://study.example', 'x-forwarded-for': '198.51.100.5' }), response)
  assert.equal(response.statusCode, 200)
  assert.deepEqual(response.body, { action: 'translate', result: 'Hello.', provider: 'Groq', usedBackup: false })
  assert.equal(calls.length, 1)
  assert.equal(calls[0].messages[1].content, 'Bonjour.')
})

test('Vercel function returns the shared validation response without calling a provider', async () => {
  let calls = 0
  const handler = createVercelAIHandler({ providers: {
    groq: { apiKey: 'mock', name: 'Groq', async complete() { calls += 1; return 'unused' } },
    gemini: null,
  } })
  const response = mockResponse()
  await handler(mockRequest({ action: 'upload', text: 'Bonjour.' }), response)
  assert.equal(response.statusCode, 400)
  assert.equal(response.body.error.code, 'invalid_request')
  assert.equal(calls, 0)
})

test('Vercel parsed request bodies are accepted and malformed JSON stays a client error', async () => {
  const handler = createVercelAIHandler({ providers: {
    groq: { apiKey: 'mock', name: 'Groq', async complete() { return 'Hello.' } },
    gemini: null,
  } })
  const validResponse = mockResponse()
  await handler(mockParsedRequest({ action: 'translate', text: 'Bonjour.' }), validResponse)
  assert.equal(validResponse.statusCode, 200)

  const malformedRequest = mockParsedRequest(undefined)
  Object.defineProperty(malformedRequest, 'body', { get() { throw new SyntaxError('malformed') } })
  const malformedResponse = mockResponse()
  await handler(malformedRequest, malformedResponse)
  assert.equal(malformedResponse.statusCode, 400)
  assert.equal(malformedResponse.body.error.code, 'invalid_json')
})

test('Vercel function maps provider failures to the shared safe response', async () => {
  const handler = createVercelAIHandler({ providers: {
    groq: { apiKey: 'mock', name: 'Groq', async complete() { throw new ProviderFailure('service', true) } },
    gemini: null,
  } })
  const response = mockResponse()
  await handler(mockRequest({ action: 'explain', text: 'C’est bien.' }), response)
  assert.equal(response.statusCode, 503)
  assert.equal(response.body.error.code, 'provider_unavailable')
  assert.equal(response.body.error.retryable, true)
  assert.deepEqual(response.body.error, {
    code: 'provider_unavailable',
    message: 'Groq is temporarily unavailable. Please try again.',
    retryable: true,
    provider: 'Groq',
    action: 'explain',
  })
})

test('Vercel function exposes a sanitized provider rate limit and Retry-After', async () => {
  const handler = createVercelAIHandler({ providers: {
    groq: { apiKey: 'mock', name: 'Groq', async complete() { throw new ProviderFailure('rate_limit', true, { status: 429, retryAfterSeconds: 9 }) } },
    gemini: null,
  } })
  const response = mockResponse()
  await handler(mockRequest({ action: 'grammar', text: 'les fleurs' }), response)
  assert.equal(response.statusCode, 429)
  assert.equal(response.headers['Retry-After'], '9')
  assert.deepEqual(response.body.error, {
    code: 'provider_rate_limited',
    message: 'Groq is rate-limiting requests. Please wait about 9 seconds before retrying.',
    retryable: true,
    provider: 'Groq',
    action: 'grammar',
    retryAfterSeconds: 9,
  })
})

test('Vercel same-origin validation uses Vercel host/protocol headers rather than forwarded client input', async () => {
  const handler = createVercelAIHandler({ providers: { groq: null, gemini: null } })
  const response = mockResponse()
  await handler(mockRequest({ action: 'translate', text: 'Bonjour.' }, {
    origin: 'https://attacker.example',
    host: 'study.example',
    'x-forwarded-proto': 'https',
    'x-forwarded-host': 'attacker.example',
    'x-forwarded-for': '203.0.113.3',
  }), response)
  assert.equal(response.statusCode, 403)
  assert.equal(response.body.error.code, 'origin_not_allowed')
})
