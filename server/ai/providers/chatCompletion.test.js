import test from 'node:test'
import assert from 'node:assert/strict'
import { requestChatCompletion } from './chatCompletion.js'
import { ProviderFailure } from '../providerTypes.js'

const request = () => requestChatCompletion({
  endpoint: 'https://provider.invalid/completions',
  apiKey: 'test-only-key',
  model: 'test-model',
  messages: [{ role: 'user', content: 'synthetic test text' }],
  maxTokens: 20,
})

async function withFetch(fetchMock, callback) {
  const originalFetch = globalThis.fetch
  globalThis.fetch = fetchMock
  try { await callback() } finally { globalThis.fetch = originalFetch }
}

test('chat completion classifies provider transient statuses and preserves bounded Retry-After', async () => {
  for (const [status, kind] of [[429, 'rate_limit'], [408, 'timeout'], [425, 'service'], [503, 'service']]) {
    await withFetch(async () => new Response('private provider error body', {
      status,
      headers: { 'Retry-After': '12' },
    }), async () => {
      await assert.rejects(request(), (error) => {
        assert.ok(error instanceof ProviderFailure)
        assert.equal(error.kind, kind)
        assert.equal(error.status, status)
        assert.equal(error.transient, true)
        assert.equal(error.retryAfterSeconds, 12)
        assert.equal(error.message.includes('private provider error body'), false)
        return true
      })
    })
  }
})

test('chat completion keeps invalid credentials and permanent request failures non-transient', async () => {
  for (const [status, kind] of [[401, 'credentials'], [403, 'credentials'], [400, 'request'], [404, 'request']]) {
    await withFetch(async () => new Response('sensitive raw response', { status }), async () => {
      await assert.rejects(request(), (error) => {
        assert.equal(error.kind, kind)
        assert.equal(error.transient, false)
        assert.equal(error.status, status)
        assert.equal(error.message.includes('sensitive'), false)
        return true
      })
    })
  }
})

test('chat completion classifies network errors as transient without exposing internals', async () => {
  await withFetch(async () => { throw new Error('sensitive socket detail') }, async () => {
    await assert.rejects(request(), (error) => {
      assert.equal(error.kind, 'network')
      assert.equal(error.transient, true)
      assert.equal(error.message.includes('sensitive'), false)
      return true
    })
  })
})

test('chat completion rejects malformed successful responses permanently', async () => {
  await withFetch(async () => new Response('{bad json', { status: 200 }), async () => {
    await assert.rejects(request(), (error) => {
      assert.equal(error.kind, 'malformed_response')
      assert.equal(error.transient, false)
      return true
    })
  })
})

test('chat completion classifies an aborted provider request as a transient timeout', async () => {
  const originalSetTimeout = globalThis.setTimeout
  const originalClearTimeout = globalThis.clearTimeout
  globalThis.setTimeout = (callback) => { callback(); return 1 }
  globalThis.clearTimeout = () => {}
  try {
    await withFetch(async (_url, options) => {
      assert.equal(options.signal.aborted, true)
      throw new Error('aborted')
    }, async () => {
      await assert.rejects(request(), (error) => {
        assert.equal(error.kind, 'timeout')
        assert.equal(error.transient, true)
        return true
      })
    })
  } finally {
    globalThis.setTimeout = originalSetTimeout
    globalThis.clearTimeout = originalClearTimeout
  }
})
