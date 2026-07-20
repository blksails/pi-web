# 缺陷记录：agent 发布链路的声明位缺失（#28 / #29）

> 立项日期：2026-07-20　来源：pi-clouds `#6 发布→应用闭环 E2E` 首次真机执行（生产）
> 权威证据：pi-clouds 仓 `.kiro/specs/closed-loop-e2e/execution-report-2026-07-20.md`
> 主题：**约定信息本可推导，却要求显式声明；不声明就静默失败或永久烧号。**

---

## #28（阻断级）kind=agent 的 CLI 发布通道 100% 不通

### 复现

任意 `kind:"agent"` 的包 → `pi-web publish --key <k> --channel stable`

### 现象

upload 与 registerVersion 均返回成功，但版本落库即 `status=failed`：

```
failureReason: "VALIDATION: manifest.entry must be an object"
```

随后 `setChannel` 报 `PUBLISH_CHANNEL VERSION_REJECTED`。**且该版本号被永久烧掉**——failed 版本占号，`VersionConflictError` 保护使同号不可重发。本轮已烧掉 `e2e/agent-routes-demo@1.0.0`。

### 根因（两侧）

| 侧 | 位置 | 事实 |
|---|---|---|
| pi-web | `server/cli/publish/manifest-compiler.ts:204-217` | `sign()` 产出的 manifest 只有 `schemaVersion/name/version/kind/publisher` + RESOURCE_FIELDS + `webext`，**从不产 `entry`** |
| pi-clouds | `packages/registry-client/src/manifest/validate.ts:75-76` | `kind === "agent"` 时无条件 `assertIntegrityRef(m["entry"], "entry")` |

### 反证

registry 上 `e2e/aigc-canvas-agent` 1.0.x 有 `entry`，是因为**它们不是 CLI 发的**——由人手工构造 manifest 重签后 `registerVersion`。即：agent 的发布通道从未被 CLI 正经走通过。

### 修复要点

`entry.path` 如何确定是**设计决策**（`probeEntry` 约定？`pkg.main`？固定 `index.ts`？），不是一行 bugfix，需评审。向后兼容要求：已发布的手工版本不得失效。

---

## #29 manifest 缺正规声明字段：入口 / routes / webext 只能借 `pi.extensions` 走私

### 现状

manifest schema 没有承载 agent 入口与附属产物的字段组。`index.ts` 与 `routes/**` 想进 bundle，只能塞进 `pi.extensions`——#6 本轮就是这么发的：

```json
"extensions": ["index.ts", "routes/*.ts"]
```

### webext 面：约定固定，声明却强制且零利用率

扫描 `examples/`（2026-07-20）：

| 事实 | 数据 |
|---|---|
| webext 源码路径约定 | 一律 `.pi/web/web.config.tsx` |
| webext 产物路径约定 | 一律 `.pi/web/dist/`（`manifest.json` + `web-extension.mjs`） |
| 已有构建好 dist 的 example | 10 个 |
| 有源码待构建的 example | 7 个 |
| **声明了 `web.dist` 的 example** | **0 个**（含 dist 已建好的 `plugin-code-review-agent`） |

`manifest-compiler.ts:126` 的条件是 `if (m.web?.dist)`——**未声明即整段跳过，无任何提示**。于是包发出去 `hasWebext:false`，registry、cloud 一路 fail-closed 到默认 UI，**没有一环会告诉你「这个包本该有面板」**。

### 由此导致的生产现象：aigc canvas 面板失效

三层断点（2026-07-20 主控查证）：

1. **发布侧**：`examples/aigc-canvas-agent/package.json` 的 `pi-web` 字段只有 `title/avatar/description`，无 `web.dist` 声明、无构建脚本、无 `.pi/web/dist` ⇒ dist 从未入过 bundle
2. **registry 侧**：canvas 1.0.0 / 1.0.1 / 1.0.2 的 `capabilities` 全为 `{"hasRoutes":false,"hasSkills":false,"hasWebext":false}`；manifest 字段只有 `kind/name/entry/version/publisher/signature/schemaVersion`，**无 webext 声明位**
3. **服务端侧**：pi-clouds `apps/cloud/lib/webext/canvas-webext-route.ts` 顶部 task 9 结论——pi-cloud 服务端本地不存在任何源的 `.pi/web/dist`（源装在沙箱内），唯一路径是从 registry bundle 取；而 R3.4 消费面端点 `GET /v1/webext-dist/...` 实测 **404**，未上线

⇒ 面板失效是**结构性未完成**，不是回归：与 #23 claim 路修复、#25 canvas 换血、#26 contentTag 改动均无关（1.0.0/1.0.1 早于这些改动，同样 `hasWebext:false`）。

### 修复方向：约定优先

- **(a) 自动纳入**：`manifest-compiler.ts:126` 的 `if (m.web?.dist)` 改为「显式声明优先，否则探测默认路径 `.pi/web/dist/manifest.json`，存在即自动纳入」。向后兼容：非标准路径仍可用显式声明覆盖
- **(b) 有源无产物明确失败**：检测到 `.pi/web/web.config.tsx` 存在但 dist 不存在 → 报错并提示先构建，**不再静默跳过**（canvas 正是死于此）
- **(c) 不做隐式自动构建**：发布环境未必具备构建依赖，且会造成「发布物与本地所见不一致」；报错 + 明确提示命令更安全
- **(d) 陈旧产物防护**：比对 `web.config.tsx` 与 dist 的 mtime，产物旧于源则警告
- **(e) 入口/routes 声明位**：清单增设正规的 `entry` + `files`（或 `agent.include`）字段组，与 #28 一并收口

### 待查

canvas 的 OSS bundle 里究竟有无 `.pi/web/dist`（按上述推断应为「无」，需实证）。

---

## 关联

- pi-clouds `.kiro/specs/closed-loop-e2e/execution-report-2026-07-20.md` — 真机执行报告与全部原始证据
- pi-clouds `.kiro/specs/closed-loop-e2e/credentials-delivery-checklist.md` B4 — 已按实测更正
