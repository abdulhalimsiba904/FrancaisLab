import test from 'node:test'
import assert from 'node:assert/strict'
import { handleAIRequest } from './service.js'
import { ProviderFailure } from './providerTypes.js'

test('transient Groq failure calls Gemini once and marks backup response', async () => {
  let groqCalls = 0
  let geminiCalls = 0
  const result = await handleAIRequest({ action: 'translate', text: 'Bonjour.' }, {
    groq: {
      apiKey: 'configured',
      name: 'Groq',
      async complete() { groqCalls += 1; throw new ProviderFailure('rate_limit', true) },
    },
    gemini: {
      apiKey: 'configured',
      name: 'Gemini',
      async complete({ messages }) {
        geminiCalls += 1
        assert.equal(messages[1].content, 'Bonjour.')
        return 'Hello.'
      },
    },
  })

  assert.equal(groqCalls, 1)
  assert.equal(geminiCalls, 1)
  assert.deepEqual(result, {
    status: 200,
    body: { action: 'translate', result: 'Hello.', provider: 'Gemini', usedBackup: true },
  })
})

test('permanent Groq failure does not call Gemini', async () => {
  let geminiCalls = 0
  const result = await handleAIRequest({ action: 'explain', text: 'C’est bien.' }, {
    groq: { apiKey: 'configured', name: 'Groq', async complete() { throw new ProviderFailure('credentials', false) } },
    gemini: { apiKey: 'configured', name: 'Gemini', async complete() { geminiCalls += 1; return 'unused' } },
  })

  assert.equal(geminiCalls, 0)
  assert.equal(result.status, 502)
  assert.equal(result.body.error.code, 'provider_configuration')
  assert.equal(JSON.stringify(result).includes('credentials'), false)
})

test('malformed Groq response does not call Gemini', async () => {
  let geminiCalls = 0
  const result = await handleAIRequest({ action: 'translate', text: 'Bonjour.' }, {
    groq: { apiKey: 'configured', name: 'Groq', async complete() { throw new ProviderFailure('malformed_response', false) } },
    gemini: { apiKey: 'configured', name: 'Gemini', async complete() { geminiCalls += 1; return 'unused' } },
  })

  assert.equal(geminiCalls, 0)
  assert.equal(result.status, 503)
})

test('Gemini can answer directly when Groq is not configured', async () => {
  let geminiCalls = 0
  const result = await handleAIRequest({ action: 'translate', text: 'Bonjour.' }, {
    groq: null,
    gemini: { apiKey: 'configured', name: 'Gemini', async complete() { geminiCalls += 1; return 'Hello.' } },
  })

  assert.equal(geminiCalls, 1)
  assert.equal(result.body.usedBackup, false)
  assert.equal(result.body.provider, 'Gemini')
})

test('translation rejects context and no keys return a setup response without provider calls', async () => {
  let calls = 0
  const invalid = await handleAIRequest({ action: 'translate', text: 'Bonjour.', context: 'Salut.' }, {
    groq: { apiKey: 'configured', name: 'Groq', async complete() { calls += 1; return 'unused' } },
    gemini: { apiKey: 'configured', name: 'Gemini', async complete() { calls += 1; return 'unused' } },
  })
  assert.equal(invalid.status, 400)
  assert.equal(invalid.body.error.code, 'invalid_request')
  assert.equal(calls, 0)

  const setup = await handleAIRequest({ action: 'translate', text: 'Bonjour.' }, { groq: null, gemini: null })
  assert.equal(setup.status, 503)
  assert.equal(setup.body.error.code, 'setup_required')
})
