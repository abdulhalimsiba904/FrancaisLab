import test from 'node:test'
import assert from 'node:assert/strict'
import { createGeminiProvider } from './gemini.js'

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
