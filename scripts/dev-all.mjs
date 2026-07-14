#!/usr/bin/env node
// 一条命令拉起 dev 全栈:API server(3000) + vite(5173),任一退出/Ctrl-C 时同时收尾
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

const procs = []
// 非 TTY(后台/CI)下 stdin 会 EOF,vite 见 stdin 关闭即自退,故只在交互终端里透传 stdin
const stdinMode = process.stdin.isTTY ? 'inherit' : 'ignore'
function run(cmd, args) {
  const child = spawn(cmd, args, { cwd: root, stdio: [stdinMode, 'inherit', 'inherit'], shell: false })
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

process.on('SIGINT', () => shutdown(0))
process.on('SIGTERM', () => shutdown(0))

run(process.execPath, [
  '--import', './node_modules/.pnpm/jiti@2.7.0/node_modules/jiti/lib/jiti-register.mjs',
  'server/index.ts',
])
run(path.join(root, 'node_modules', '.bin', 'vite'), [])
