import test from 'node:test'
import assert from 'node:assert/strict'
import { developmentApiProxy } from './devProxy.js'
import { requestOriginAllowed } from './ai/http.js'

test('Vite proxy preserves the browser host and API accepts only that same LAN origin', () => {
  assert.deepEqual(developmentApiProxy, {
    target: 'http://127.0.0.1:3001',
    changeOrigin: false,
  })

  const request = {
    headers: { host: '192.168.1.24:5174', origin: 'http://192.168.1.24:5174' },
    socket: { encrypted: false },
  }
  assert.equal(requestOriginAllowed(request), true)
  assert.equal(requestOriginAllowed({
    ...request,
    headers: { ...request.headers, origin: 'https://attacker.example' },
  }), false)
})
