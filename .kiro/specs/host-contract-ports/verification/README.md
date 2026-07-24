# 任务 7.1 四面回归结果

> 执行时间：2026-07-22
> HEAD：`f199765`（第 6 组收口后）
> 基线：`../baseline/README.md`（HEAD `b43bef5`，本 spec 任何代码改动之前）

## 结果总表

| # | 面 | 命令 | 基线 | 本次 | 判定 |
|---|---|---|---|---|---|
| 1 | 递归子包单测 | `pnpm test` | 4352 passed / 0 failed | **4651 passed / 0 failed**（12 包全绿） | ✅ 通过数 +299（本 spec 新增），零失败 |
| 2 | 根应用测试 | `pnpm test:app` | 798 passed / 1 skipped | **798 passed / 1 skipped**（85 文件） | ✅ 与基线逐字相同 |
| 3 | 离线 Node e2e | `pnpm e2e:node` | 72 passed / 3 failed | **72 passed / 3 failed** | ✅ 失败集合逐条相同 |
| 4 | 递归类型检查 | `pnpm typecheck` | 全绿 | **EXIT=0，13 包 Done，零 `error TS`** | ✅ |

## 按基线比对规则逐条核对

1. **面 1、2、4 为零失败基线 —— 出现任何失败即为本期缺陷** → 三面均零失败 ✅
2. **面 3 允许 2 条稳定既有 + 1 条 flaky，其余任何失败即为本期缺陷** → 失败集合与基线**完全一致**，无第四条、形态未变 ✅
   - 稳定既有 2 条：`e2e/node/module-settings-agent.e2e.test.ts` → `A2) HTTP agent-routes 层`（本 spec 不触碰 agent-routes）
   - flaky 1 条：`e2e/node/attachment-completion.e2e.test.ts` → **单独复跑 3 passed**（`5-flaky-recheck.log`），与基线判定一致
3. **通过数不得低于基线**（防止用例被静默跳过而伪装成「无新增失败」）→ 面 1 +299、面 2 持平、面 3 持平 ✅

## 结论

**四面无新增失败，通过数均不低于基线。Req 10.1 / 10.2 机械闭合。**

面 1 的 +299 来自本 spec 新增用例（workspace 键校验/上限/合并/本地实现/一致性套件、capability 类型层、host-manifest 组装引擎、config-domain 注册表、三个 barrel 守卫）。

## 一处诚实标注

任务 6.2 复核者未复跑全量（本机 vitest 单文件转译约 7.5 分钟），当时明确标注「那一行数字是实施者的观测，不是我的」，并建议把 Req 10.2 的机械闭合放到 7.1 —— **本次即为该闭合**，四面均由主控独立跑出。

## 原始日志

`71-typecheck.log` / `71-test-recursive.log` / `71-test-app.log` / `71-e2e-node.log` / `71-flaky-recheck.log`
