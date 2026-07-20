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

> **2026-07-20 补充事实（供方案定夺）**：`probeEntry` 已是一套成熟且**运行时正在使用**的约定，位于 `packages/server/src/agent-source/entry-probe.ts:51-68`：
> 1. `package.json` 的 `pi-web.entry` **覆盖优先**；覆盖文件不存在则抛 `EntryOverrideError`，**不静默回退**
> 2. 否则按 `index.ts` > `index.js` > `index.mjs` 取首个存在者
> 3. 均无 → `{ kind: "none" }`
>
> 三条支撑「发布期直接复用 `probeEntry`」而非在 `pi-web.json` 另设 `entry` 字段：
> - **零错位**：发布期与运行时同一函数、同一优先级，不会出现「发布时认 A、运行时加载 B」
> - **零存量迁移**：全仓 **40 个 example、39 个有 `index.ts`、0 个用过 `pi-web.entry` 覆盖** ⇒ 约定命中率 ~97.5%，且无任何存量依赖显式声明
> - **跨包引用已有先例**：`server/cli/install/local-source-registry.ts:40` 已 `import { probeEntry } from "@blksails/pi-web-server"`，该 barrel 明确标注「仅 node builtins + agent-source 只读探测，无 pi SDK 值导入，可安全重导出」（`packages/server/src/index.ts:43`）
>
> 反之，在 `pi-web.json` 新增 `entry` 字段会造出**第二个声明位**，与 `package.json#pi-web.entry` 可能不一致，反而扩大本缺陷的同类面。

### 同源缺口（同一模式的其它出口，一并收口）

| # | 缺口 | 位置 / 事实 |
|---|---|---|
| 1 | **entry 文件本身没有入 bundle 的通道** | `bundlePaths` 只由 `pi.*` glob 与 `web.dist` 两处填充（`manifest-compiler.ts:96-146`），**不含 entry**。故即便补上 `manifest.entry`，入口文件仍不会进 tarball——#6 能跑通是因为把 `index.ts` 走私进了 `pi.extensions`。修复须让 entry **自动加入 `bundlePaths`** |
| 2 | **`kind` 缺省两侧不一致** | registry 侧 `deriveEffectiveKind` 缺省 **`agent`**（pi-clouds `packages/registry-client/src/manifest/kind.ts`）；pi-web 侧 `PiWebManifestSchema` 的 `kind` 默认 **`plugin`**（`packages/protocol/src/plugin/plugin-manifest.ts:117`）。不写 `kind` 的 agent 包会被发成 plugin——**发布成功但类型错**（plugin 不要求 entry），运行时却按 agent 加载 |
| 3 | **`settings.schema` 同样没有 bundle 通道** | `RESOURCE_FIELDS` 仅 `skills\|extensions\|prompts\|themes`（`manifest-compiler.ts:30-31`），声明了 `settings` 的包，其 `schema.json` 进不了 bundle（`module-settings-agent` 即此形态） |

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
| 已有构建好 dist 的 example | **13 个** |
| 有源码待构建的 example | 7 个（`aigc-agent` / `aigc-canvas-agent` / `aigc-canvas-nosurface-agent` / `canvas-plugin-stickers` / `logging-demo-agent` / `module-settings-agent` / `surface-demo-agent`） |
| **声明了 `web.dist` 的 example** | **1 个** —— `plugin-code-review-agent`，且填的值就是约定默认路径本身：`"web": { "dist": ".pi/web/dist", "commands": ["review"] }` |
| **拥有 `pi-web.json`（可发布）的 example** | **3 个 / 共 40 个** —— `canvas-component-watermark`(kind=component) / `module-settings-agent`(kind=agent) / `plugin-code-review-agent`(kind=plugin) |

> 📌 **2026-07-20 实测更正（原记「已建 10 个」「声明者 0 个，含 plugin-code-review-agent」）**：dist 实为 13 个；`plugin-code-review-agent` 恰恰是**唯一声明了** `web.dist` 的那个。这一更正**加强而非削弱**「约定优先」的论证——全仓唯一使用该字段的样本，填的正是约定默认值，证明该字段在实践中纯属样板冗余。
>
> 📌 更大的图景：**40 个 example 只有 3 个带发布清单**，其余 37 个根本不可发布。故「顺手修 examples 的声明」的实际形态不是改声明，而是补清单——那是另一个量级的工作，需单独定范围。
>
> 📌 活体样本：`module-settings-agent` 同时命中 (b) 与 (e) 两条——它是 `kind:"agent"`、有 `.pi/web/web.config.tsx` 而无 dist、且 `pi-web.json` **无 `pi` 字段**（⇒ 现实现下 `bundlePaths` 为空，即使补上 entry，它声明的 `settings/schema.json` 仍进不了 bundle）。修复后它应当**明确报错提示先构建**，可直接用作回归 fixture。

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

### 待查（已降级：不影响结论）

canvas 的 OSS bundle 里究竟有无 `.pi/web/dist`。**无论有无，面板失效的定因都不变**：

- 若**无**（推断如此）——第 1 层断点成立，dist 从未入 bundle。
- 若**有**（例如 1.0.0 的 bundle 由更早的非 CLI 途径打包时夹带了 dist）——**结论同样成立**：manifest 里没有 `webext` 声明位，registry 因而不会为它建索引（三个版本 `capabilities.hasWebext:false` 即证），消费面 `/v1/webext-dist/<hash>/<file>` 是**按 manifest 索引寻址**的，拿不到未索引的字节。

⇒ 断点在**声明位**而非字节是否存在。实证下载需要消费面 tenant token（publish token 打 `GET /sources/:id` 实测返回 `UNAUTHORIZED: missing or invalid tenant token`），成本高于收益，故不作为修复前置。

---

## 关联

- pi-clouds `.kiro/specs/closed-loop-e2e/execution-report-2026-07-20.md` — 真机执行报告与全部原始证据
- pi-clouds `.kiro/specs/closed-loop-e2e/credentials-delivery-checklist.md` B4 — 已按实测更正
