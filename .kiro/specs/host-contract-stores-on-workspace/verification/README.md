# M4 垂直验证(任务 6,Req 8)

> fresh-evidence:命令 + 真实计数 + 时间戳。改动 = 4 个 store 内部改建到 LocalWorkspace(trust 不迁)。
> 采集:2026-07-22T08:xx UTC。

## 结论

**M4 四个 store 迁移行为零变化、本地全绿;trust 本期不迁(勘误⑭)。** 云端实现 1 个 TenantWorkspace 即白拿这四个 store 的模型成立。

## 证据

### 1. `packages/server` 全量单测 — ✅ 2174 passed | 17 skipped(rc=0)
```
cd packages/server && pnpm test
→ Test Files 246 passed | 7 skipped (253);Tests 2174 passed | 17 skipped (2191)
```
= 2172(M3 baseline)+ 2(per-source corrupt 守卫,复核后补)。既有各 store 单测不改断言全绿。

### 2. typecheck — ✅ rc=0(双侧)
```
cd packages/server && pnpm run typecheck   → rc=0
pnpm exec tsc -p tsconfig.json --noEmit     → rc=0(lib/app 不受 store 接口变化影响)
```

### 3. 各 store 单测(行为零变化基线)— ✅
| store | 命令 | 结果 |
|---|---|---|
| FavoritesStore | `vitest run test/agent-source-list/favorites-store.test.ts favorites-routes.test.ts` | 9 passed |
| SessionFavoritesStore | `vitest run test/session-actions/session-favorites-store.test.ts` | 8 passed |
| per-source settings | `vitest run test/config/source-settings-codec.test.ts` | **20 passed**(18 既有 + 2 复核后补的 corrupt 守卫) |
| sources 注册表 | `vitest run test/agent-source-list/registry-provider.test.ts` | 6 passed |

### 4. per-source 端到端(goal 的 e2e 环节)— ✅
```
PI_WEB_STUB_AGENT=1 pnpm exec vitest run -c vitest.node-e2e.config.ts e2e/node/source-settings-endpoint.e2e.test.ts
→ Tests 6 passed (6)
```
经真实路由 → `SourceSettingsCodec` → LocalWorkspace 双命名空间。

## 独立复核(REJECT → 修复 → 有牙)

reviewer 逐 store 变异体验证守卫充分性:
- favorites 键名改错 / list 删 catch → 被既有坏 JSON 用例抓住 ✅
- session list 删 catch → 抓住 ✅;registry list 删 catch → 抓住 ✅
- per-source `writeJson(merge:false)`→`merge:true` → 被「clear 写入删除密钥」用例抓住 ✅
- **per-source `load` 删 corrupt catch → 38 例全绿零反应 ❌**(REJECT 的核心:迁移新引入的 corrupt→{} 分支无守卫)

**修复**:`source-settings-codec.test.ts` 补 source + project 两条「损坏 JSON → load 返回 {}」守卫。亲手变异验证(禁用 corrupt 降级)→ 两条**均转红**,还原后 20 passed。

reviewer 其余全 PASS:等价映射逐一致(键/路径/merge/静默降级)、deepMerge 收敛(私有副本已删)、trust 零改动 + 勘误⑭、范围隔离(未碰 M1/attachment/session-store)。

## trust=B(勘误⑭)

trust store 代码 `git diff` 为空;契约 §3.7 表下记录三处张力(同步 API / pi CLI 字节契约 / 损坏抛+键名),§8.3「五个」收敛为「四个 + trust 悬置」。
