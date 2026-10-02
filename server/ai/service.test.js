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
  assert.equal(result.body.error.code.includes('credentials'), false)
})

test('malformed Groq response does not call Gemini', async () => {
  let geminiCalls = 0
  const result = await handleAIRequest({ action: 'translate', text: 'Bonjour.' }, {
    groq: { apiKey: 'configured', name: 'Groq', async complete() { throw new ProviderFailure('malformed_response', false) } },
    gemini: { apiKey: 'configured', name: 'Gemini', async complete() { geminiCalls += 1; return 'unused' } },
  })

  assert.equal(geminiCalls, 0)
  assert.equal(result.status, 502)
  assert.equal(result.body.error.code, 'provider_invalid_response')
  assert.equal(result.body.error.retryable, false)
})

for (const action of ['grammar', 'example']) {
  test(`${action} uses the same single transient Groq-to-Gemini fallback`, async () => {
    let groqCalls = 0
    let geminiCalls = 0
    const result = await handleAIRequest({ action, text: 'le vieux livre', ...(action === 'grammar' ? { context: 'Il lit le vieux livre.' } : {}) }, {
      groq: { apiKey: 'configured', name: 'Groq', async complete() { groqCalls += 1; throw new ProviderFailure('rate_limit', true, { status: 429, retryAfterSeconds: 7 }) } },
      gemini: { apiKey: 'configured', name: 'Gemini', async complete({ messages }) { geminiCalls += 1; assert.match(messages[1].content, /le vieux livre/u); return 'Une phrase exemple.' } },
    })

    assert.equal(groqCalls, 1)
    assert.equal(geminiCalls, 1)
    assert.equal(result.status, 200)
    assert.equal(result.body.usedBackup, true)
    assert.equal(result.body.action, action)
  })
}

test('final provider rate limit is distinguishable and carries a bounded retry hint', async () => {
  const result = await handleAIRequest({ action: 'grammar', text: 'les fleurs' }, {
    groq: { apiKey: 'configured', name: 'Groq', async complete() { throw new ProviderFailure('rate_limit', true, { status: 429, retryAfterSeconds: 9999 }) } },
    gemini: null,
  })
  assert.equal(result.status, 429)
  assert.equal(result.body.error.code, 'provider_rate_limited')
  assert.equal(result.body.error.provider, 'Groq')
  assert.equal(result.body.error.action, 'grammar')
  assert.equal(result.body.error.retryAfterSeconds, 300)
  assert.equal(result.body.error.retryable, true)
  assert.deepEqual(result.headers, { 'Retry-After': '300' })
})

test('transient backup failure reports the backup provider category without another retry', async () => {
  let groqCalls = 0
  let geminiCalls = 0
  const result = await handleAIRequest({ action: 'example', text: 'la mer' }, {
    groq: { apiKey: 'configured', name: 'Groq', async complete() { groqCalls += 1; throw new ProviderFailure('timeout', true) } },
    gemini: { apiKey: 'configured', name: 'Gemini', async complete() { geminiCalls += 1; throw new ProviderFailure('service', true, { status: 503 }) } },
  })
  assert.equal(groqCalls, 1)
  assert.equal(geminiCalls, 1)
  assert.equal(result.body.error.code, 'provider_unavailable')
  assert.equal(result.body.error.provider, 'Gemini')
  assert.equal(result.body.error.action, 'example')
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
