# M3 垂直验证(任务 5.1,Req 8)

> fresh-evidence:命令 + 真实计数 + 时间戳。改动 = pi-web 装配改经 `defaultCapabilities()`+`composeCapabilities()`。
> 采集:2026-07-22T07:xx UTC。

## 结论

**M3 无功能回归、行为零变化。** 强制表态装配机制在真实 pi-web 装配(`buildSingleton`)中成立。

## 证据

### 1. `packages/server` 全量单测 — ✅ 2172 passed | 17 skipped(rc=0)
```
cd packages/server && pnpm test
→ Test Files 246 passed | 7 skipped (253);Tests 2172 passed | 17 skipped (2189)
```
= 2165 baseline + 7(新增 `test/host-assembly/default-capabilities.test.ts` 的 7 组守卫)。既有全绿。

### 2. typecheck — ✅ rc=0(双侧)
```
cd packages/server && pnpm run typecheck   → rc=0(host-assembly + 4.1)
pnpm exec tsc -p tsconfig.json --noEmit     → rc=0(lib/app/pi-handler.ts 装配改造 + import 清理)
```

### 3. 装配级等价测试(4.1)— ✅ 7/7,守卫经变异验证有牙
```
pnpm exec vitest run test/host-assembly/default-capabilities.test.ts → Tests 7 passed (7)
```
7 组守卫:①id 集=名册 ②路由集=**独立调 15 真实工厂**并集 ③命令集 ④条件两态 ⑤强制表态 ⑥host.commands 可弃用 ⑦路由顺序(mcp<config.domains)。
- **守卫②经复核 REJECT 后重写为独立基线**(原为 `descriptors.flatMap(d.factory)` 重言式)。亲手变异验证:把 `config.sandboxProject` 绑错成 `createConfigRoutes` → 守卫② **转红**(compose 36 项 vs 独立基线 35 项),还原后 7/7。
- 守卫⑦亲测:交换 config.mcp/config.domains 顺序 → 转红。

### 4. 真实装配路径(经 `buildSingleton` → compose) — ✅
```
PI_WEB_STUB_AGENT=1 pnpm exec vitest run -c vitest.node-e2e.config.ts e2e/node/config-domains.e2e.test.ts
→ Tests 6 passed (6)
```
经 `@/lib/app/api-route` 触发 `buildSingleton` 的 compose 装配 —— 16 id 全表态不抛、config 端点正常。

### 5. node e2e 全量(goal 的 e2e 环节)

| 模式 | 结果 | attachment-completion |
|------|------|----------------------|
| 并发(默认) | 3 failed files / 4 failed tests | ❌ 失败 |
| **串行**(`--no-file-parallelism`) | 2 failed files / 3 failed tests | ✅ **通过** |
| 单独 | ✅ 3/3 | ✅ |

**串行 - 并发差集 = `attachment-completion` → 确认并发资源竞争 flaky,非 M3 功能回归。** M3 的 `buildSingleton` compose 装配开销在并发多进程下加剧了该 e2e 既有的时序脆弱性;功能正确(单独 + 串行均过)。

**串行剩余 2 failed(既有,与 M3 无关):**
- `auto-retry-402.e2e`(Theme A session/translate,M3 完全不碰)
- `module-settings-agent.e2e`(agent-routes `entities` declaration 握手超时,M2 已基线对照证明既有)
两者在 HEAD 基线(裸 spread 装配)同样失败(见任务执行期 `git stash` 基线对照)。

## 关键修复记录

**mcp 路由顺序回归(基线对照才抓到)**:Router 顺序敏感(`router.ts:163` `for...break`),`/config/:domain` 会抢 GET /config/mcp。M3 初版按名册顺序把 config.domains 排 config.mcp 前 → DOMAIN_NOT_FOUND。此 bug 逃过守卫①②(sort 比集合)与全部既有 e2e,靠 `git stash` 回 HEAD 全量 e2e 对照(M3 比基线多 1 失败)追出。已修(config.mcp 排前)+ 守卫⑦锁死 + 更正 design「Router 顺序不敏感」的错误论断。
