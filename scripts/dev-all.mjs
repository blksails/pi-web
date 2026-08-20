#!/usr/bin/env node
// 一条命令拉起 dev 全栈:API server(3000) + vite(5173),任一退出/Ctrl-C 时同时收尾
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const devEnv = { ...process.env, NODE_ENV: process.env.NODE_ENV ?? 'development' }
const apiUrl = process.env.PI_WEB_DEV_API_URL ?? `http://127.0.0.1:${process.env.PORT ?? 3000}`
const apiReadyTimeoutMs = Number(process.env.PI_WEB_DEV_API_READY_TIMEOUT_MS ?? 90000)

const procs = []
// 非 TTY(后台/CI)下 stdin 会 EOF,vite 见 stdin 关闭即自退,故只在交互终端里透传 stdin
const stdinMode = process.stdin.isTTY ? 'inherit' : 'ignore'
function run(cmd, args) {
  const child = spawn(cmd, args, { cwd: root, env: devEnv, stdio: [stdinMode, 'inherit', 'inherit'], shell: false })
  child.on('exit', (code) => shutdown(code ?? 0))
  procs.push(child)
  return child
}

let exiting = false
function shutdown(code) {
  if (exiting) return
  exiting = true
  for (const p of procs) {
    if (p.exitCode === null) p.kill('SIGTERM')
  }
  process.exitCode = code
}

async function waitForApi() {
  const until = Date.now() + apiReadyTimeoutMs
  const probeUrl = new URL('/api/bootstrap', apiUrl)
  while (!exiting && Date.now() < until) {
    try {
      const response = await fetch(probeUrl)
      if (response.status < 500) return
    } catch {
      // API server still starting; keep Vite closed so its proxy sees no transient refusal.
    }
    await new Promise((resolve) => setTimeout(resolve, 200))
  }
  if (exiting) throw new Error('API server exited before readiness')
  throw new Error(`Timed out waiting for API after ${apiReadyTimeoutMs}ms: ${probeUrl}`)
}

process.on('SIGINT', () => shutdown(0))
process.on('SIGTERM', () => shutdown(0))

// e2b 模式:e2b@2.33 内部 __toESM(require("platform")) 经 jiti ESM register hook 转换后崩
// (getRuntime 读 platform.default.version → undefined)。改用编程式 jiti + nativeModules 的引导
// (scripts/dev-server-native-e2b.mjs)。默认(非 e2b)dev 仍用官方 jiti-register(零变化)。
if (process.env.PI_WEB_TRANSPORT === 'e2b') {
  run(process.execPath, ['scripts/dev-server-native-e2b.mjs'])
} else {
  run(process.execPath, [
    '--import', './node_modules/.pnpm/jiti@2.7.0/node_modules/jiti/lib/jiti-register.mjs',
    'server/index.ts',
  ])
}
try {
  await waitForApi()
  if (!exiting) {
    const viteArgs = [path.join(root, 'node_modules', 'vite', 'bin', 'vite.js')]
    if (process.env.PI_WEB_DEV_CLIENT_HOST) viteArgs.push('--host', process.env.PI_WEB_DEV_CLIENT_HOST)
    if (process.env.PI_WEB_DEV_CLIENT_PORT) viteArgs.push('--port', process.env.PI_WEB_DEV_CLIENT_PORT)
    run(process.execPath, viteArgs)
  }
} catch (error) {
  console.error(error)
  shutdown(1)
}
