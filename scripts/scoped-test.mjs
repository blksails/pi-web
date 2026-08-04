#!/usr/bin/env node
/**
 * scoped-test — 只跑指定测试文件，自动路由到它们各自的 vitest 面。
 *
 * 用法：
 *   node scripts/scoped-test.mjs test/cli/cli-args.test.ts packages/logger/test/x.test.ts
 *   node scripts/scoped-test.mjs /abs/path/to/repo/test/foo.test.ts     # 绝对路径也吃
 *
 * 为什么需要它：pi-web 是**多测试面**的 monorepo，没有一条 vitest 命令能覆盖所有测试文件。
 *   - 根 `vitest.config.ts` 的 include 只有 `test/**`，environment=jsdom，带 `test/setup.ts`，
 *     并声明了一大批 `@blksails/pi-web-*` → 源码 TS 的 alias；
 *   - `packages/<pkg>/` 各有自己的 config，alias / environment / setupFiles 都不同。
 * 拿根 vitest 去跑子包的测试文件，会因为解析不到包内 alias 而红；反过来同理。
 * 这个红是**工具用错了**，不是代码坏了——而它看起来和真的回归一模一样，最会浪费时间。
 *
 * 退出码：0 全绿；非 0 有失败面（打印每一面的结果）；2 = 参数里没有任何测试文件。
 */
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const isTestFile = (p) => /\.(test|spec)\.[cm]?[jt]sx?$/.test(p)

/** 绝对路径（kiro 的 `_Boundary:_` 会绝对化）与相对路径都归一到仓库根的相对路径 */
function toRepoRelative(p) {
  const abs = path.isAbsolute(p) ? p : path.resolve(process.cwd(), p)
  const rel = path.relative(REPO, abs)
  return rel.startsWith('..') ? null : rel.split(path.sep).join('/')
}

/** packages/<dir> → 包名。用 package.json 里的 name，不靠目录名猜（两者并不总是一致） */
function packageNameOf(dir) {
  const pkg = path.join(REPO, 'packages', dir, 'package.json')
  if (!existsSync(pkg)) return null
  try {
    return JSON.parse(readFileSync(pkg, 'utf8')).name || null
  } catch {
    return null
  }
}

const inputs = process.argv.slice(2)
if (!inputs.length) {
  console.error('用法: node scripts/scoped-test.mjs <测试文件路径...>')
  process.exit(2)
}

// ── 路由：把每个测试文件分派到它所属的面 ──
const faces = new Map()   // key → { label, cmd, args, files[] }
const skipped = []
const unroutable = []

for (const raw of inputs) {
  const rel = toRepoRelative(raw)
  if (!rel) { unroutable.push(`${raw}（在仓库之外）`); continue }
  if (!isTestFile(rel)) { skipped.push(rel); continue }

  const m = rel.match(/^packages\/([^/]+)\//)
  if (m) {
    const name = packageNameOf(m[1])
    if (!name) { unroutable.push(`${rel}（packages/${m[1]} 没有 package.json）`); continue }
    const key = `pkg:${name}`
    if (!faces.has(key)) {
      faces.set(key, {
        label: name,
        cmd: 'pnpm',
        // --filter 让命令在该包目录下执行，所以文件路径要相对包目录
        args: ['--filter', name, 'exec', 'vitest', 'run'],
        strip: `packages/${m[1]}/`,
        files: [],
      })
    }
    faces.get(key).files.push(rel)
    continue
  }

  if (rel.startsWith('test/')) {
    const key = 'root'
    if (!faces.has(key)) {
      faces.set(key, { label: '应用级 (根 vitest)', cmd: 'pnpm', args: ['exec', 'vitest', 'run'], strip: '', files: [] })
    }
    faces.get(key).files.push(rel)
    continue
  }

  unroutable.push(`${rel}（不在 test/ 也不在 packages/*/ 下，无对应 vitest 面）`)
}

if (skipped.length) {
  console.error(`跳过 ${skipped.length} 个非测试文件：${skipped.join(', ')}`)
}
if (unroutable.length) {
  console.error(`⚠ 无法路由 ${unroutable.length} 个：\n  ${unroutable.join('\n  ')}`)
}
if (!faces.size) {
  // 「没有测试可跑」不能报成绿。实现者要么补测试，要么明确标记需要人工验证。
  console.error('✗ 参数里没有任何可路由的测试文件——本次改动没有自动验证覆盖。')
  process.exit(2)
}

// ── 依次执行各面（面数通常是 1–2，串行足够，也避免并发争资源）──
const results = []
for (const face of faces.values()) {
  const files = face.files.map((f) => (face.strip ? f.slice(face.strip.length) : f))
  console.error(`\n▶ ${face.label}：${files.length} 个文件`)
  const r = spawnSync(face.cmd, [...face.args, ...files], { cwd: REPO, stdio: 'inherit' })
  results.push({ label: face.label, code: r.status ?? 1 })
}

console.error('\n── scoped-test 汇总 ──')
for (const r of results) console.error(`${r.code === 0 ? '✓' : '✗'} ${r.label}${r.code === 0 ? '' : `（退出码 ${r.code}）`}`)
process.exit(results.some((r) => r.code !== 0) ? 1 : 0)
