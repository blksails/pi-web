# 回归基线快照（任务 1.1）

> 采集时间：2026-07-21
> 采集点：**本 spec 任何代码改动之前**，分支 `docs/host-contract-v1`，HEAD `b43bef5`
> 用途：任务 7.1 / 7.2 与本快照逐面比对。**新增失败一律视为本期缺陷；本表已列出的失败保持既有问题标注，不混入本期结论。**

## 为什么必须四面分采

后续任务 6.2 改动的是**包主入口**（`packages/server/src/index.ts`），而主入口是根应用与其它子包的消费面。
只跑单个包会漏红——这是仓内既有的多测试面陷阱，故四面分别采集、分别比对。

## 结果总表

| # | 面 | 命令 | 结果 | 计数 |
|---|---|---|---|---|
| 1 | 递归子包单测 | `pnpm test` | ✅ EXIT=0 | 12 包全绿，**4352 passed / 17 skipped / 0 failed** |
| 2 | 根应用测试 | `pnpm test:app` | ✅ EXIT=0 | **798 passed / 1 skipped / 0 failed**（85 文件） |
| 3 | 离线 Node e2e | `pnpm e2e:node` | ⚠️ EXIT=1 | **72 passed / 3 failed**（22 文件中 2 文件失败） |
| 4 | 递归类型检查 | `pnpm typecheck` | ✅ EXIT=0 | 全部子包 + 根，零错误 |
| 5 | 浏览器 e2e 检阅 | `pnpm build:dist && pnpm e2e` | ✅ EXIT=0 | **115 passed / 7 skipped / 0 failed** |

### ⚠️ 面 5 的基线是第三次采集才有效 —— 前两次的失败均非产品缺陷

| 轮次 | 结果 | 处置 |
|---|---|---|
| 首轮 `5-e2e-browser.log` | 11 failed | **无效**：环境污染 + 既有缺陷混杂 |
| 次轮 `5-e2e-browser-clean.log` | 7 failed | **无效**：排除污染后仍含既有缺陷 |
| 终轮 `5-e2e-browser-final.log` | **0 failed** | ✅ 有效基线 |

**污染源（4 条，非缺陷）**：仓库根 `.env.local` 设有 `NEXT_PUBLIC_PI_WEB_SOURCE_PICKER=1` 与
`NEXT_PUBLIC_PI_WEB_LAUNCHER_RAIL=1`，而 `server/index.ts` 的**第一个 import** 即加载 `.env.local`。
两个门控被强制打开后：源列表渲染（用例断言默认 build 下不渲染）、`data-new-session` 因 rail
开启而不渲染（`components/chat-app.tsx:785` 的门控，注释写明「rail 开启时冗余」）→ 四条超时。

→ **本地跑浏览器 e2e 必须显式置 0**：
```
NEXT_PUBLIC_PI_WEB_SOURCE_PICKER=0 NEXT_PUBLIC_PI_WEB_LAUNCHER_RAIL=0 pnpm e2e
```
（`.env.local` 不覆盖已存在的进程 env —— `server/load-env.ts:47` 「真实进程 env 优先」。）

**既有缺陷（7 条，已修复于 `1f1caa1`）**：webext 运行时夹具 `targetApiVersion: "^0.1.0"`
与宿主 web-kit 0.5.0 不兼容，兼容门按设计拒绝下发。产品行为正确、夹具陈旧。详见该提交。

## ⚠️ 面 3 的既有失败（3 条，已复跑判定性质）

复跑同两个文件一次，结果与首轮**不同**，据此区分两类：

### 稳定既有失败 — 2 条

`e2e/node/module-settings-agent.e2e.test.ts` → `A2) HTTP agent-routes 层`

- `routes 声明帧到达后,GET agent-routes/entities 回吐原始 { entities } 形状`
- `未声明的 route 名 → 404 ROUTE_NOT_FOUND`

两轮均失败且失败条目完全一致 → **确定性既有缺陷**，与本 spec 无关（本 spec 不触碰 agent-routes）。
比对时：这两条**允许**继续失败，但**不允许**新增第三条或改变失败形态。

### flaky（偶发） — 1 条

`e2e/node/attachment-completion.e2e.test.ts` → `8.1/8.2: 上传后 @ 补全含 attachment 候选与分组`

首轮失败，复跑**通过** → **非确定性**，与本 spec 无关。
比对时：该文件失败**不作为**本期缺陷判据；若稳定失败则需另行核查。

## 比对规则（任务 7.1 / 7.2 执行时遵循）

1. 面 1、2、4 为零失败基线 —— 出现**任何**失败即为本期缺陷。
2. 面 3 允许上述 2 条稳定失败 + 1 条 flaky；**其余任何失败**即为本期缺陷。
3. 面 5 以 **`5-e2e-browser-final.log`** 为准（零失败），且**必须带门控置 0 的 env 前缀**运行，否则复现的是污染态。
4. 通过数不得低于基线（防止用例被静默跳过而伪装成"无新增失败"）。

## 原始日志

- `1-test-recursive.log` / `2-test-app.log` / `3-e2e-node.log` / `4-typecheck.log`
- `5a-build.log`（浏览器面前置构建）
- `5-e2e-browser.log`（首轮，污染态，仅存证） / `5-e2e-browser-clean.log`（次轮，仅存证） / **`5-e2e-browser-final.log`（有效基线）**
