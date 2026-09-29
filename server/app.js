import { createServer } from 'node:http'
import { readFile, realpath, stat } from 'node:fs/promises'
import { extname, relative, resolve, sep } from 'node:path'
import { handleAIEndpoint, sendJson } from './ai/http.js'

const SPA_ROUTES = new Set(['/', '/reader', '/saved'])
const MIME_TYPES = new Map([
  ['.css', 'text/css; charset=utf-8'],
  ['.html', 'text/html; charset=utf-8'],
  ['.ico', 'image/x-icon'],
  ['.jpeg', 'image/jpeg'],
  ['.jpg', 'image/jpeg'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.mjs', 'text/javascript; charset=utf-8'],
  ['.png', 'image/png'],
  ['.svg', 'image/svg+xml'],
  ['.txt', 'text/plain; charset=utf-8'],
  ['.wasm', 'application/wasm'],
  ['.webp', 'image/webp'],
  ['.woff', 'font/woff'],
  ['.woff2', 'font/woff2'],
])

function sendNotFound(response, isApi) {
  if (isApi) {
    sendJson(response, 404, { error: { code: 'not_found', message: 'This API route was not found.', retryable: false } })
    return
  }
  response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8', 'X-Content-Type-Options': 'nosniff' })
  response.end('Not found')
}

function fixedWindowLimiter({ maxRequests, windowMs, now = Date.now, maxClients = 10_000 }) {
  const clients = new Map()

  return function consume(clientAddress) {
    const currentTime = now()
    let entry = clients.get(clientAddress)
    if (!entry || currentTime >= entry.resetAt) {
      if (!entry && clients.size >= maxClients) {
        for (const [address, client] of clients) {
          if (currentTime >= client.resetAt) clients.delete(address)
        }
        if (clients.size >= maxClients) return { allowed: false, retryAfter: Math.max(1, Math.ceil(windowMs / 1000)) }
      }
      entry = { count: 0, resetAt: currentTime + windowMs }
      clients.set(clientAddress, entry)
    }

    if (entry.count >= maxRequests) {
      return { allowed: false, retryAfter: Math.max(1, Math.ceil((entry.resetAt - currentTime) / 1000)) }
    }

    entry.count += 1
    return { allowed: true }
  }
}

function lastForwardedValue(value) {
  return typeof value === 'string' ? value.split(',').at(-1)?.trim() : undefined
}

export function getClientAddress(request, trustProxyHops = 0) {
  const socketAddress = request.socket.remoteAddress || 'unknown'
  if (trustProxyHops < 1) return socketAddress

  const forwarded = request.headers['x-forwarded-for']
  if (typeof forwarded !== 'string') return socketAddress
  const addresses = forwarded.split(',').map((address) => address.trim()).filter(Boolean)
  if (addresses.length < trustProxyHops) return socketAddress
  return addresses[addresses.length - trustProxyHops] || socketAddress
}

function safeStaticPath(staticRoot, pathname) {
  let decoded
  try {
    decoded = decodeURIComponent(pathname)
  } catch {
    return null
  }
  if (decoded.includes('\0')) return null

  const segments = decoded.replaceAll('\\', '/').split('/').filter(Boolean)
  if (segments.some((segment) => segment === '.' || segment === '..' || segment.includes(':'))) return null
  const candidate = resolve(staticRoot, ...segments)
  const relativePath = relative(staticRoot, candidate)
  if (relativePath === '..' || relativePath.startsWith(`..${sep}`) || relativePath.startsWith('..\\')) return null
  return candidate
}

async function serveStatic(request, response, staticDir, pathname) {
  if (!['GET', 'HEAD'].includes(request.method || '')) {
    response.writeHead(405, { Allow: 'GET, HEAD', 'X-Content-Type-Options': 'nosniff' })
    response.end('Method not allowed')
    return true
  }

  const normalizedPath = pathname.length > 1 ? pathname.replace(/\/+$/u, '') : pathname
  const requestedPath = normalizedPath === '/' ? '/index.html' : normalizedPath
  let staticRoot
  try {
    staticRoot = await realpath(staticDir)
  } catch {
    response.writeHead(503, { 'Content-Type': 'text/plain; charset=utf-8', 'X-Content-Type-Options': 'nosniff' })
    response.end('Frontend build is not available')
    return true
  }

  const candidate = safeStaticPath(staticRoot, requestedPath)
  if (!candidate) {
    sendNotFound(response, false)
    return true
  }

  const locateFile = async (path) => {
    const filePath = await realpath(path)
    const relativePath = relative(staticRoot, filePath)
    if (relativePath === '..' || relativePath.startsWith(`..${sep}`) || relativePath.startsWith('..\\')) {
      sendNotFound(response, false)
      return null
    }
    const fileInfo = await stat(filePath)
    if (!fileInfo.isFile()) throw Object.assign(new Error('not_file'), { code: 'ENOENT' })
    return filePath
  }

  let filePath
  try {
    filePath = await locateFile(candidate)
  } catch {
    if (SPA_ROUTES.has(normalizedPath)) {
      try {
        filePath = await locateFile(resolve(staticRoot, 'index.html'))
      } catch {
        sendNotFound(response, false)
        return true
      }
    } else {
      sendNotFound(response, false)
      return true
    }
  }
  if (!filePath) return true

  try {
    const body = await readFile(filePath)
    const isHashedAsset = normalizedPath.startsWith('/assets/')
    response.writeHead(200, {
      'Content-Type': MIME_TYPES.get(extname(filePath).toLowerCase()) || 'application/octet-stream',
      'Content-Length': body.byteLength,
      'Cache-Control': isHashedAsset ? 'public, max-age=31536000, immutable' : 'no-cache',
      'X-Content-Type-Options': 'nosniff',
    })
    response.end(request.method === 'HEAD' ? undefined : body)
  } catch {
    sendNotFound(response, false)
  }
  return true
}

export function createAppServer({
  providers = { groq: null, gemini: null },
  staticDir,
  rateLimitMax = 20,
  rateLimitWindowMs = 60_000,
  trustProxyHops = 0,
  allowedOrigins = [],
  now = Date.now,
} = {}) {
  const resolvedStaticDir = staticDir ? resolve(staticDir) : null
  const limiter = fixedWindowLimiter({ maxRequests: rateLimitMax, windowMs: rateLimitWindowMs, now })

  return createServer(async (request, response) => {
    let pathname
    try {
      pathname = new URL(request.url ?? '/', 'http://localhost').pathname
    } catch {
      sendNotFound(response, false)
      return
    }

    const isApi = pathname === '/api' || pathname.startsWith('/api/')
    if (pathname !== '/api/ai') {
      if (isApi) {
        sendNotFound(response, true)
        return
      }
      if (resolvedStaticDir) {
        await serveStatic(request, response, resolvedStaticDir, pathname)
      } else {
        sendNotFound(response, false)
      }
      return
    }

    await handleAIEndpoint(request, response, {
      providers,
      allowedOrigins,
      originContext: () => {
        const host = trustProxyHops > 0
          ? (lastForwardedValue(request.headers['x-forwarded-host']) || request.headers.host)
          : request.headers.host
        const forwardedProtocol = trustProxyHops > 0 ? lastForwardedValue(request.headers['x-forwarded-proto']) : undefined
        return { host, protocol: forwardedProtocol ? `${forwardedProtocol.toLowerCase()}:` : request.socket.encrypted ? 'https:' : 'http:' }
      },
      consumeRateLimit: (apiRequest) => limiter(getClientAddress(apiRequest, trustProxyHops)),
    })
  })
}
