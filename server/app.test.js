import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createAppServer, getClientAddress } from './app.js'

const mockProviders = {
  groq: { apiKey: 'mock', name: 'Groq', async complete() { return 'Bonjour en anglais.' } },
  gemini: null,
}

async function withServer(options, callback) {
  const server = createAppServer(options)
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const address = server.address()
  const baseUrl = `http://127.0.0.1:${address.port}`
  try {
    await callback(baseUrl)
  } finally {
    await new Promise((resolve) => {
      server.close(resolve)
      server.closeAllConnections()
    })
  }
}

async function mockStaticDir(callback) {
  const directory = await mkdtemp(join(tmpdir(), 'francaislab-server-'))
  const staticDir = join(directory, 'dist')
  try {
    await mkdir(join(staticDir, 'assets'), { recursive: true })
    await writeFile(join(staticDir, 'index.html'), '<!doctype html><main>FrançaisLab SPA</main>')
    await writeFile(join(staticDir, 'assets', 'app.js'), 'console.log("ok")')
    await writeFile(join(directory, 'outside.txt'), 'outside')
    await callback(staticDir)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}

test('production static serving provides SPA routes and typed assets, but 404s missing paths', async () => {
  await mockStaticDir(async (staticDir) => {
    await withServer({ staticDir }, async (baseUrl) => {
      for (const route of ['/', '/reader', '/saved']) {
        const response = await fetch(`${baseUrl}${route}`)
        assert.equal(response.status, 200)
        assert.match(response.headers.get('content-type'), /text\/html/u)
        assert.match(await response.text(), /FrançaisLab SPA/u)
      }

      const asset = await fetch(`${baseUrl}/assets/app.js`)
      assert.equal(asset.status, 200)
      assert.match(asset.headers.get('content-type'), /text\/javascript/u)
      assert.match(asset.headers.get('cache-control'), /immutable/u)

      const missingAsset = await fetch(`${baseUrl}/assets/missing.js`)
      assert.equal(missingAsset.status, 404)
      const unknownRoute = await fetch(`${baseUrl}/not-a-route`)
      assert.equal(unknownRoute.status, 404)
      const traversal = await fetch(`${baseUrl}/%2e%2e%2foutside.txt`)
      assert.equal(traversal.status, 404)
    })
  })
})

test('unknown API paths never fall through to the SPA and keep JSON errors', async () => {
  await mockStaticDir(async (staticDir) => {
    await withServer({ staticDir }, async (baseUrl) => {
      for (const path of ['/api', '/api/unknown', '/api/ai/extra']) {
        const response = await fetch(`${baseUrl}${path}`)
        assert.equal(response.status, 404)
        assert.match(response.headers.get('content-type'), /application\/json/u)
        assert.equal((await response.json()).error.code, 'not_found')
      }
    })
  })
})

test('AI endpoint rejects cross-origin requests by default and accepts same-origin requests', async () => {
  let providerCalls = 0
  const providers = {
    groq: { apiKey: 'mock', name: 'Groq', async complete() { providerCalls += 1; return 'Bonjour en anglais.' } },
    gemini: null,
  }
  await withServer({ providers }, async (baseUrl) => {
    const body = JSON.stringify({ action: 'translate', text: 'Bonjour.' })
    const rejected = await fetch(`${baseUrl}/api/ai`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: 'https://untrusted.example' },
      body,
    })
    assert.equal(rejected.status, 403)
    assert.equal((await rejected.json()).error.code, 'origin_not_allowed')
    assert.equal(providerCalls, 0)

    const accepted = await fetch(`${baseUrl}/api/ai`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: baseUrl },
      body,
    })
    assert.equal(accepted.status, 200)
    assert.equal(providerCalls, 1)
  })
})

test('an explicit origin list replaces the same-origin default check', async () => {
  await withServer({ providers: mockProviders, allowedOrigins: ['https://study.example'] }, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/ai`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: 'https://study.example' },
      body: JSON.stringify({ action: 'translate', text: 'Bonjour.' }),
    })
    assert.equal(response.status, 200)

    const rejected = await fetch(`${baseUrl}/api/ai`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: 'https://other.example' },
      body: JSON.stringify({ action: 'translate', text: 'Bonjour.' }),
    })
    assert.equal(rejected.status, 403)
  })
})

test('configured proxy headers preserve same-origin checks behind TLS termination', async () => {
  await withServer({ providers: mockProviders, trustProxyHops: 1 }, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/ai`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        origin: 'https://study.example',
        'x-forwarded-for': '203.0.113.20',
        'x-forwarded-host': 'study.example',
        'x-forwarded-proto': 'https',
      },
      body: JSON.stringify({ action: 'translate', text: 'Bonjour.' }),
    })
    assert.equal(response.status, 200)
  })
})

test('AI rate limit returns 429 and a Retry-After header', async () => {
  await withServer({ providers: mockProviders, rateLimitMax: 1, rateLimitWindowMs: 60_000 }, async (baseUrl) => {
    const request = () => fetch(`${baseUrl}/api/ai`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'translate', text: 'Bonjour.' }),
    })
    assert.equal((await request()).status, 200)
    const limited = await request()
    assert.equal(limited.status, 429)
    assert.equal(limited.headers.get('retry-after'), '60')
    assert.equal((await limited.json()).error.code, 'rate_limited')
  })
})

test('forwarded client IP is ignored unless an explicit proxy hop count is configured', () => {
  const request = {
    socket: { remoteAddress: '192.0.2.20' },
    headers: { 'x-forwarded-for': '198.51.100.1, 203.0.113.8' },
  }
  assert.equal(getClientAddress(request), '192.0.2.20')
  assert.equal(getClientAddress(request, 1), '203.0.113.8')
  assert.equal(getClientAddress({ ...request, headers: {} }, 1), '192.0.2.20')
})
