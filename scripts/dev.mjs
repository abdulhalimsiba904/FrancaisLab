import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const viteEntry = resolve(root, 'node_modules/vite/bin/vite.js')
const viteEnv = { ...process.env }
for (const key of ['GROQ_API_KEY', 'GEMINI_API_KEY', 'GROQ_MODEL', 'GEMINI_MODEL']) delete viteEnv[key]

const children = [
  spawn(process.execPath, [resolve(root, 'server/index.js')], { cwd: root, stdio: 'inherit' }),
  spawn(process.execPath, [viteEntry, ...process.argv.slice(2)], { cwd: root, stdio: 'inherit', env: viteEnv }),
]
let stopping = false

function stop(exitCode = 0) {
  if (stopping) return
  stopping = true
  process.exitCode = exitCode
  for (const child of children) if (child.exitCode === null) child.kill('SIGTERM')
}

for (const child of children) {
  child.on('error', () => stop(1))
  child.on('exit', (code, signal) => {
    if (!stopping) stop(signal ? 1 : (code ?? 1))
  })
}
process.on('SIGINT', () => stop(0))
process.on('SIGTERM', () => stop(0))
