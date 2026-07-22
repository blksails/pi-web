# M2 垂直切片回归验证(任务 3.1,Req 8)

> fresh-evidence:命令原文 + 真实计数 + 时间戳。改建 = `ConfigCodec` 内部迁到 `LocalWorkspace.user`。
> 采集时间:2026-07-22T05:xx UTC(各命令 `Start at` 为本地时钟)。

## 结论

**config 域改建行为零变化、本地全绿。** 垂直切片模型成立:一刀切到 Workspace 端口上,pi-web 本地无回归。

## 证据

### 1. `packages/server` 全量单测 — ✅ 2165 passed | 17 skipped(rc=0)

```
cd packages/server && pnpm test
→ Test Files  245 passed | 7 skipped (252)
       Tests  2165 passed | 17 skipped (2182)
    Duration  ~35s   Start at 13:02:49
```
无失败。含所有下游 config 消费方(config-routes / logging-config / sandbox-config / secret-merge 等)。

### 2. typecheck — ✅ rc=0

```
cd packages/server && pnpm run typecheck   # tsc -p tsconfig.json --noEmit
→ 无输出,rc=0
```

### 3. config 单测面(改建直接目标)— ✅ 16 passed

```
pnpm exec vitest run test/config/config-codec.test.ts test/config/config-codec.error-partition.test.ts
→ Tests  16 passed (16)
```
既有 8 条断言零改动全绿(行为零变化)+ 真实-fs 收紧守卫 4 + 错误分区 stub 守卫 4。
独立 reviewer 亲手验证 2 个变异体(io 降级、底层 merge:true)均转红后还原。

### 4. config e2e(goal 要求的端到端环节)

```
PI_WEB_STUB_AGENT=1 pnpm exec vitest run -c vitest.node-e2e.config.ts \
  e2e/node/config-domains.e2e.test.ts \
  e2e/node/module-settings-agent.e2e.test.ts \
  e2e/node/source-settings-endpoint.e2e.test.ts
```

| e2e 文件 | 结果 | 说明 |
|---------|------|------|
| `config-domains.e2e.test.ts` | ✅ PASS | 五域经真实 config 路由单例 + 临时 agentDir 的读写往返 —— **改建的直接端到端验证** |
| `source-settings-endpoint.e2e.test.ts` | ✅ PASS | per-source settings 路由(未改建,回归确认) |
| `module-settings-agent.e2e.test.ts` | ⚠️ 2 failed / 8 passed | **既有失败,与本 spec 无关**(见下对照实验) |

#### 对照实验:module-settings-agent 的 2 failed 是既有的

失败点:`waitForRoute` 等待 agent route `entities` declaration 超时(`module-settings-agent.e2e.test.ts:190`,25s deadline)—— 属 agent-declared-routes 握手,不经 ConfigCodec。

严格对照(stash 本 spec 改动 → 回到 HEAD fs 实现 → 重跑):

```
git stash push packages/server/src/config/config-codec.ts packages/server/test/config/config-codec.test.ts
PI_WEB_STUB_AGENT=1 pnpm exec vitest run -c vitest.node-e2e.config.ts e2e/node/module-settings-agent.e2e.test.ts
→ Tests  2 failed | 8 passed (10)   # ← 基线同样 2 failed,与改建版逐一致
git stash pop   # 已恢复
```

**结论:改建版与 HEAD 基线在该 e2e 上表现完全相同(均 2 failed | 8 passed)→ 既有问题,非本 spec 引入。**
