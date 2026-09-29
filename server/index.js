import { readFile, stat } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createAppServer } from './app.js'
import { createProviders } from './ai/providers/index.js'
import { parseAllowedOrigins } from './config.js'

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)))
const LOCAL_PORT = 3001

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

function integerSetting(env, name, fallback, min, max) {
  const raw = env[name]
  if (raw === undefined || raw.trim() === '') return fallback
  const value = Number(raw)
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw new Error(`Invalid server configuration for ${name}.`)
  }
  return value
}

await loadLocalEnv()

const isProduction = process.env.NODE_ENV === 'production'
const port = integerSetting(process.env, 'PORT', LOCAL_PORT, 1, 65_535)
const staticDir = isProduction ? resolve(ROOT, 'dist') : undefined
if (staticDir) {
  try {
    if (!(await stat(resolve(staticDir, 'index.html'))).isFile()) throw new Error()
  } catch {
    process.stderr.write('FrançaisLab production build is missing. Run npm run build before starting the server.\n')
    process.exit(1)
  }
}

const providers = createProviders(process.env)

let server
try {
  server = createAppServer({
    providers,
    staticDir,
    rateLimitMax: integerSetting(process.env, 'AI_RATE_LIMIT_MAX', 20, 1, 5_000),
    rateLimitWindowMs: integerSetting(process.env, 'AI_RATE_LIMIT_WINDOW_MS', 60_000, 1_000, 86_400_000),
    trustProxyHops: integerSetting(process.env, 'TRUST_PROXY_HOPS', 0, 0, 10),
    allowedOrigins: parseAllowedOrigins(process.env.ALLOWED_ORIGINS),
  })
} catch (error) {
  process.stderr.write(`${error.message}\n`)
  process.exit(1)
}

const host = isProduction ? '0.0.0.0' : '127.0.0.1'
server.listen(port, host, () => {
  process.stdout.write(`FrançaisLab server listening on ${host}:${port}\n`)
})

server.on('error', () => {
  process.stderr.write('FrançaisLab server could not start. Check the port and server configuration.\n')
  process.exitCode = 1
})
