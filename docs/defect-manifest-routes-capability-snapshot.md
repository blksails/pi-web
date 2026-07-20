# 缺陷记录：发布清单从不产出 `routes`，registry 能力快照对 agent-declared-routes 永远为假

> 立项日期：2026-07-20　来源：`#6 发布→应用闭环 E2E` 生产真机执行的旁证 + `publish-agent-entry-and-bundle` 实现期复核
> 同源缺陷：[defect-agent-publish-declaration-gaps.md](./defect-agent-publish-declaration-gaps.md)（#28 / #29）
> 主题：**与 #28/#29 同一模式——声明位缺失导致下游静默失真；区别在于本条不阻断发布，因而更隐蔽。**

---

## 复现

1. 取任一声明了 `routes` 的 agent（仓内现成的：`examples/agent-routes-demo`，声明 `ping` / `echo` / `whoami`；`examples/aigc-canvas-agent` 声明 `gallery-stats`）。
2. 经 `pi-web publish` 发布到 registry（0.3.1 起 agent 通道已可用）。
3. 查该版本的能力快照：

```bash
curl -s "$REG/v1/admin/sources/<org>%2F<name>" -H "Authorization: Bearer $TOKEN" \
  | jq '.versions[-1].capabilities'
```

## 现象

```json
{ "hasWebext": false, "hasRoutes": false, "hasSkills": false }
```

`hasRoutes` **恒为 `false`**，无论该 agent 声明了多少条 route。

而同一会话中这些 route **完全可用** —— `#6` 生产真机实测（会话 `6d346b60-…`）：

```
GET  /api/sessions/<SID>/agent-routes            → [ping(GET), echo(GET,POST), whoami(GET)]
GET  .../agent-routes/ping                       → {"pong":true}
POST .../agent-routes/ping                       → 405 METHOD_NOT_ALLOWED   （反验）
GET  .../agent-routes/health                     → 404 ROUTE_NOT_FOUND      （反验）
```

⇒ **运行时事实与 registry 快照直接矛盾**：快照说「这个包没有路由」，运行时却能列举并调用三条。

## 根因（两侧）

| 侧 | 位置 | 事实 |
|---|---|---|
| 产出侧 | pi-web `server/cli/publish/manifest-compiler.ts:349` `sign()` | 构造的 `base` 只写 `schemaVersion` / `name` / `version` / `kind` / `publisher`（:363-367）+ `entry`（:368）+ RESOURCE_FIELDS（:371）+ `webext`（:374）。**函数体内 `routes` 出现 0 次**，从不产出该字段 |
| 消费侧 | pi-clouds `packages/registry-client/src/manifest/capabilities.ts:11` | `hasRoutes: Array.isArray(manifest.routes) && manifest.routes.length > 0` |

契约本身是齐备的，缺的只是产出：

- registry 侧 `packages/registry-client/src/manifest/types.ts:62` 已定义 `readonly routes?: readonly string[]`（**路由名数组**）
- agent 侧 `packages/agent-kit/src/types.ts:185` 定义 `routes?: AgentRouteDecl[]`，其 `:99-111` 的 `AgentRouteDecl` 含 `readonly name: string`

⇒ 从 agent 声明推导出 registry 需要的 `string[]` 是直接的 `.map(r => r.name)`，**不存在形状障碍**。

## 影响面

- **任何依据 `hasRoutes` 的决策都会误判**：UI 是否展示路由入口、bake 是否预热路由相关层、按能力筛选/检索 source、平台侧统计。
- 快照由 registry 在 register 时派生并落台账（`capabilities.ts` 文件头注释：「权威快照由 register 时派生并落台账；version 不可变故不会漂移」）⇒ **一旦发布即固化为错误值，且因版本不可变而无法就地修正**，只能发新版本。
- 与 #28/#29 的区别：**本条不阻断发布**。#28 是硬失败（还烧版本号），作者立刻会发现；本条一路成功，只是快照悄悄失真——所以可能已经在存量版本里积累了错误数据（生产上 `e2e/aigc-canvas-agent` 1.0.0–1.0.2 的 `capabilities` 全为 `false`，其中至少 routes 一项与实际能力不符）。

## 修复方向

**核心难点不在写入，而在「发布期如何得知 agent 声明了哪些 route」。** route 声明在 `index.ts` 的 `defineAgent({ routes })` 里，是**运行时值**；而 `compile()` 是纯静态文件遍历，不执行包代码。三条候选：

1. **装配期上报 → 缓存 → 发布期读取**（推荐方向待评估）
   runner 已在装配期把 route 声明上报主进程（`packages/server/src/runner/agent-routes-wiring.ts:29`）。若能在本地开发/构建阶段把该结果落盘为约定产物，发布期直接读取即可。**优点**：单一真源仍是 agent 代码本身，不引入第二声明位；**缺点**：需要一次「跑起来」才能产出，与「发布期不执行代码」的现有约束有张力。

2. **在 `pi-web.json` 增设 `routes: string[]` 声明位**
   最简单，但**会造出第二权威**——与 `defineAgent({ routes })` 可能不一致，正是 #28/#29 这一族缺陷的成因模式。若采纳必须同时提供一致性校验（发布期比对声明与实际），否则是在制造下一个同类缺陷。

3. **发布期静态提取**
   解析 `routes/` 目录约定（一路由一文件、文件名即 route 名，见 `examples/agent-routes-demo` 与 `examples/aigc-canvas-agent` 的既有组织方式）。**优点**：零执行、零新声明位；**缺点**：只覆盖遵循目录约定的写法，`index.ts` 里内联声明的 route 会漏。

> ⚠️ 无论选哪条，都需要**一致性保障**：发布期写入的 `routes` 与运行时 `agent-routes` 端点列举的结果必须一致，否则只是把「快照恒假」换成「快照可能假」。建议比照 `publish-agent-entry-and-bundle` 的 R1.7（「CLI 声明的入口须与安装后运行时探测所得指向同一文件」）设一条等价的端到端断言。

## 关联

- `.kiro/specs/publish-agent-entry-and-bundle/` — #28/#29 的修复 spec；其 `research.md` 的 Open Items 已登记本条
- pi-clouds `.kiro/specs/closed-loop-e2e/execution-report-2026-07-20.md` — 面⑥ 真机取证（routes 实际可用的证据）
- `.kiro/specs/agent-declared-routes/` — routes 特性本身的 spec
