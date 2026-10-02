import test from 'node:test'
import assert from 'node:assert/strict'
import { createGeminiProvider } from './gemini.js'
import { ProviderFailure } from '../providerTypes.js'

test('Gemini adapter uses the documented server-authenticated generateContent API and parses text', async () => {
  const originalFetch = globalThis.fetch
  let request
  globalThis.fetch = async (url, options) => {
    request = { url: String(url), options }
    return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: 'Bonjour' }, { text: ' means hello.' }] } }] }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  try {
    const provider = createGeminiProvider({ GEMINI_API_KEY: 'test-only-key', GEMINI_MODEL: 'test-model' })
    const result = await provider.complete({
      messages: [{ role: 'system', content: 'Tutor instructions' }, { role: 'user', content: 'Bonjour' }],
      maxTokens: 100,
    })

    assert.equal(result, 'Bonjour means hello.')
    assert.equal(request.url, 'https://generativelanguage.googleapis.com/v1beta/models/test-model:generateContent')
    assert.equal(request.options.headers['x-goog-api-key'], 'test-only-key')
    assert.equal(JSON.parse(request.options.body).generationConfig.maxOutputTokens, 100)
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('Gemini adapter is unconfigured when its optional key is absent', () => {
  const provider = createGeminiProvider({})
  assert.equal(provider.apiKey, '')
})

test('Gemini classifies rate limits, timeouts and service errors as transient with retry hints', async () => {
  const originalFetch = globalThis.fetch
  try {
    const provider = createGeminiProvider({ GEMINI_API_KEY: 'test-only-key' })
    for (const [status, kind] of [[429, 'rate_limit'], [408, 'timeout'], [425, 'service'], [503, 'service']]) {
      globalThis.fetch = async (_url, _options) => new Response('provider response is never exposed', {
        status,
        headers: { 'Retry-After': '15' },
      })
      await assert.rejects(provider.complete({ messages: [{ role: 'system', content: 'Tutor' }, { role: 'user', content: 'Bonjour' }], maxTokens: 20 }), (error) => {
        assert.ok(error instanceof ProviderFailure)
        assert.equal(error.kind, kind)
        assert.equal(error.transient, true)
        assert.equal(error.status, status)
        assert.equal(error.retryAfterSeconds, 15)
        assert.equal(error.message.includes('provider response'), false)
        return true
      })
    }
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('Gemini credential, model/request and malformed-success failures are permanent', async () => {
  const originalFetch = globalThis.fetch
  try {
    const provider = createGeminiProvider({ GEMINI_API_KEY: 'test-only-key' })
    for (const [status, kind] of [[403, 'credentials'], [400, 'request'], [404, 'request']]) {
      globalThis.fetch = async () => new Response('raw provider details', { status })
      await assert.rejects(provider.complete({ messages: [{ role: 'system', content: 'Tutor' }, { role: 'user', content: 'Bonjour' }], maxTokens: 20 }), (error) => {
        assert.equal(error.kind, kind)
        assert.equal(error.transient, false)
        assert.equal(error.status, status)
        assert.equal(error.message.includes('raw provider details'), false)
        return true
      })
    }
    globalThis.fetch = async () => new Response('{malformed', { status: 200 })
    await assert.rejects(provider.complete({ messages: [{ role: 'system', content: 'Tutor' }, { role: 'user', content: 'Bonjour' }], maxTokens: 20 }), (error) => {
      assert.equal(error.kind, 'malformed_response')
      assert.equal(error.transient, false)
      return true
    })
  } finally {
    globalThis.fetch = originalFetch
  }
})
