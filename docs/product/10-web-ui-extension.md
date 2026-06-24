# 10 · Web UI 扩展（agent-web-extension）

每个 agent source 可在 `.pi/web` 目录携带一套 **WebExtension**（ESM bundle + manifest），宿主在该 source 的会话激活时动态加载，自定义布局、渲染、交互与隔离表面——而不触碰宿主的 document、session 与安全边界。

---

## 五层模型（Tier 1–5）

| Tier | 名称 | 能力 | 必需 bundle |
|------|------|------|-------------|
| 1 | **区域插槽** | 填入 18 个具名 slot（background、header、panelRight 等） | 是 |
| 2 | **渲染器注册表** | 替换 tool/data-part 的卡片渲染，per-session 命名空间 | 是 |
| 3 | **贡献点 + RPC** | slash、@mention、autocomplete、keybindings，经 `ui-rpc` 总线回 agent | 是 |
| 4 | **Artifact iframe** | 沙箱 iframe（`sandbox="allow-scripts"`），无同源凭证，postMessage 通信 | 是（artifact HTML） |
| 5 | **纯声明配置** | theme token、layout 预设、empty 空态文案——零 bundle，直接读 manifest.json | 否 |

宿主采用**模型 A**：宿主永远持有页面根、session、transport 与安全边界；扩展只能填入宿主让出的具名插槽、注册贡献点或在 iframe 内自由渲染。

---

## 端到端：从零跑通一个扩展

宿主有两条加载车道：**构建期集成**（仓库内白名单 source 静态 import `.pi/web/web.config`，见 `lib/app/webext-registry.ts:68`）与**独立预构建 + import map**（外部 git source 走 `.pi/web/dist` + SRI + 签名校验）。下面以构建期车道、Tier1 区域插槽为例，给出最短可跑通路径（每步可独立验证）：

1. **试现成示例（最快）** — 直接体验仓库内 `examples/webext-layout-agent`，无需自己写：
   ```bash
   pnpm dev   # http://localhost:3000
   ```
   打开页面后，在 agent source 输入框（`data-agent-source-input`，占位文案 `./examples/hello-agent or https://github.com/org/repo`）填 `./examples/webext-layout-agent` 提交。
2. **验证生效** — 进入会话后应看到 `headerCenter` 文案与右侧 `panelRight` 面板，DOM 上分别带 `data-pi-ext-header` 与 `data-pi-chat-aside`。
3. **写自己的扩展** — 在你自己的 agent source 下建 `.pi/web/web.config.tsx`，`export default defineWebExtension({...})`（见下文「最简 Tier1 示例」）。
4. **装 SDK 并构建** — 在该 agent source 根目录执行：
   ```bash
   pnpm add -D @pi-web/web-kit
   pnpm pi-web build --id <extId> --api "^0.1.0" --dir .pi/web --out .pi/web/dist
   ```
   成功时终端打印 `[pi-web build] <extId> → … (integrity=sha384-…)`，并在 `.pi/web/dist/` 生成 `web-extension.mjs` + `manifest.json`。该 `dist/` 产物供「独立预构建」车道（外部 source）加载与校验。
5. **指向你的 source** — `pnpm dev` 后在 source 输入框填你 agent source 的本地路径或 git URL 即可。
6. **没生效？** — 多为签名/版本/门控问题，对照 [18 故障排查 FAQ](./18-troubleshooting-faq.md) 第 3 节「Web Extension / UI 问题」，或本章末尾「常见问题」。

> Tier5 纯声明扩展可跳过第 4 步的构建：手写 `manifest.json`（含 `config`，无 `entry`）即可被宿主直接合成描述符。

---

## 目录契约与 manifest

### `.pi/web` 目录结构

```
<agent-source>/
└── .pi/
    └── web/
        ├── web.config.tsx        # 入口（defaultExport = defineWebExtension(…)）
        ├── styles.css            # 可选，构建时自动 scope
        ├── artifact.html         # Tier4 用，独立 origin 加载
        └── dist/                 # pi-web build 产物
            ├── web-extension.mjs
            ├── ext.css           # 可选
            └── manifest.json
```

入口文件按 `web.config.tsx` → `web.config.ts` → `index.tsx` → `index.ts` 顺序自动探测。

### manifest.json 结构

`pi-web build` 自动产出，也可手写（Tier5 纯声明场景）：

```json
{
  "id": "webext-contrib",
  "targetApiVersion": "^0.1.0",
  "entry": "web-extension.mjs",
  "integrity": "sha384-…",
  "capabilities": ["contributions"]
}
```

**Tier5 纯声明**示例（无 `entry` 字段，零 bundle）：

```json
{
  "id": "webext-declarative",
  "targetApiVersion": "^0.1.0",
  "capabilities": ["config"],
  "config": {
    "documentTitle": "Declarative · pi-web",
    "theme": { "--primary": "262 83% 58%" },
    "layout": "wide",
    "empty": {
      "title": "纯声明式扩展 · 零代码",
      "subtitle": "theme/layout/文案来自 manifest.json，不携带任何 bundle。",
      "starters": [{ "id": "q1", "label": "说明", "value": "…", "mode": "fill" }],
      "mergeCommands": "prepend"
    }
  }
}
```

---

## 编写扩展

### 安装作者侧 SDK

```bash
pnpm add -D @pi-web/web-kit
```

### 最简 Tier1 示例（区域插槽）

下面是仓库内 `examples/webext-layout-agent/.pi/web/web.config.tsx` 的精简版——填 `headerCenter` 与 `panelRight` 两个插槽，并用 Tier5 声明 `panelRatio` 让出右侧面板比例：

```tsx
// .pi/web/web.config.tsx
import * as React from "react";
import { defineWebExtension } from "@pi-web/web-kit";

function InfoPanel(): React.JSX.Element {
  return (
    <div data-testid="layout-panel" style={{ padding: 12 }}>
      <h3>领域检视面板</h3>
      <p>webext-layout-agent 填充的 panelRight。</p>
    </div>
  );
}

export default defineWebExtension({
  manifestId: "webext-layout",
  capabilities: ["slots", "config"],
  config: { panelRatio: "3:7" }, // 对话 30% / 面板 70%；需配合 slots.panelRight
  slots: {
    headerCenter: <span data-testid="layout-header">Layout Agent</span>,
    panelRight: <InfoPanel />,
  },
});
```

### 构建

```bash
# 在 agent source 根目录执行（@pi-web/web-kit 的 bin 名即 pi-web → build/cli.ts）
pnpm pi-web build \
  --id my-agent-ext \
  --api "^0.1.0" \
  --dir .pi/web \
  --out .pi/web/dist
  # 可选：--sign <hmac-secret> 为 manifest 写入签名
```

> 注意 flag 是 `--api`/`--dir`/`--out`（见 `packages/web-kit/build/cli.ts:32`），不是 `--target-api-version`/`--entry-dir`/`--out-dir`。仓库内的示例则统一由 `scripts/build-webext-examples.ts` 调用程序化 API `buildWebExtension({...})` 构建（`node --import jiti/register scripts/build-webext-examples.ts`）。

产物写入 `.pi/web/dist/`：`web-extension.mjs`、`manifest.json`（含 SRI），有 `styles.css` 时另出 `ext.css`。

---

## Tier 1：区域插槽（Slots）

### 18 个协议保留插槽

| SlotKey | 位置说明 | data 属性 |
|---------|----------|-----------|
| `background` | 绝对铺满、`-z-10`，消息层之下 | `data-pi-chat-background` |
| `headerLeft` / `headerCenter` / `headerRight` | header 三区 | `data-pi-ext-header` |
| `sidebarLeft` | 左侧侧边栏 | `data-pi-ext-sidebar-left` |
| `panelRight` | 右侧领域检视面板（lg 断点） | `data-pi-chat-aside` |
| `empty` | 空态屏 | `data-pi-ext-empty` |
| `footer` | 底部 | — |
| `promptInput` | 输入框装饰层 | `data-pi-ext-prompt-input` |
| `accessoryAboveEditor` / `accessoryBelowEditor` | 输入框上下 | `data-pi-ext-accessory-above/below` |
| `accessoryInlineLeft` / `accessoryInlineRight` | 输入框行内左右 | `data-pi-ext-accessory-inline-left/right` |
| `toolbar` | 工具栏 | `data-pi-ext-toolbar` |
| `notifications` | 通知层 | `data-pi-ext-notifications` |
| `statusBar` | 状态栏 | `data-pi-ext-status-bar` |
| `artifactSurface` | Artifact 独立表面 | `data-pi-ext-artifact-surface` |
| `dialogLayer` | 对话框层（`z-[60]`，不拦截内核交互） | `data-pi-ext-dialog-layer` |

**插槽语义**：扩展内容以追加（additive）方式挂载，不替换内核表面。宿主未声明对应插槽时忽略、不报错（Req 2.3）。

### background 插槽的 isolate 陷阱

`background` 渲染在 `absolute inset-0 -z-10`。宿主用 Tailwind `isolate` 为聊天主列建立独立 stacking context（`packages/ui/src/chat/pi-chat.tsx:940`），使负 z-index 被限定于此列之内——**而非逃逸到根上下文被 app-shell 不透明壳底遮挡**。

```tsx
// pi-chat.tsx:940（宿主实现细节，扩展作者无需改动）
<div className="relative isolate flex min-w-0 flex-1 flex-col">
  {backgroundLayer}
  …
</div>
```

---

## Tier 2：自定义渲染器（per-session Registry）

渲染注册表以 per-session 实例化，扩展 ID 作为命名空间前缀，多扩展互不覆盖。

### 注册渲染器

```tsx
export default defineWebExtension({
  manifestId: "webext-renderer",
  capabilities: ["renderers"],
  renderers: {
    tools: {
      // 命中 `tool-echo` part 时替换默认工具卡
      echo: EchoToolRenderer,
    },
    dataParts: {
      // 命中 `data-metric` data-part 时触发
      "data-metric": MetricRenderer,
    },
  },
});
```

渲染器 props 与宿主 registry 同形：

```typescript
type ToolRenderer = ComponentType<{ part: AnyPart; message: UIMessage }>;
type DataPartRenderer = ComponentType<{ part: AnyPart; message: UIMessage }>;
```

### 开发时触发说明

真实 dev 环境（无 `PI_WEB_STUB_AGENT=1`）下，宿主**不会**自动发出 `echo` 或 `data-metric` part——需要 LLM 实际调用对应工具（或用 stub 模式）才能触发自定义渲染器。

- **stub 触发**：`PI_WEB_STUB_AGENT=1` 时离线 stub agent 每轮发出 `echo` 工具调用，无需 LLM 即可验证渲染器。
- **真实 LLM 触发**：agent `index.ts` 注册 `echo` customTool，要求 LLM 在用户请求回显时调用。

---

## Tier 3：贡献点与 UI↔Agent RPC

### RPC 总线架构

```
浏览器扩展
  │  rpc.request({ point: "slash", action: "list", payload: { query } })
  ▼
UiRpcBus（packages/react/src/web-ext/ui-rpc-bus.ts）
  │  POST /sessions/:id/ui-rpc  → { correlationId, point, action, payload, protocolVersion }
  ▼
server command-routes.ts → session.uiRpc()
  │  → agent 进程处理 → 返回结果
  ▼
SSE control 帧：{ control: "ui-rpc", response: { correlationId, ok, result } }
  │
UiRpcBus 按 correlationId 配对 → resolve Promise
```

超时默认 **15000 ms**，支持 `AbortSignal` 取消。失败以 `{ ok: false, error }` 回填，不抛、不崩会话。

### 注册贡献点

```tsx
import { defineWebExtension, type UiRpcClient } from "@pi-web/web-kit";

export default defineWebExtension({
  manifestId: "webext-contrib",
  capabilities: ["contributions"],
  contributions: {
    slash: {
      async list(query: string, rpc: UiRpcClient) {
        const res = await rpc.request({ point: "slash", action: "list", payload: { query } });
        return (res.ok ? res.result : []) as Array<{ id: string; title: string }>;
      },
      async execute(id: string, rpc: UiRpcClient) {
        await rpc.request({ point: "slash", action: "execute", payload: { id } });
      },
    },
    mention: {
      trigger: "@",
      async query(q: string, rpc: UiRpcClient) {
        const res = await rpc.request({ point: "mention", action: "resolve", payload: { q } });
        return (res.ok ? res.result : []) as Array<{ id: string; label: string }>;
      },
    },
    keybindings: [{ combo: "Mod+k", commandId: "deploy" }],
  },
});
```

### 空闲控制流（openControlOnlyStream）

**关键行为**：贡献点经 ui-rpc 回 agent 时，需要接收 SSE `control` 下行帧配对响应。但 per-prompt 消息流仅在用户发消息时打开。因此：

- 扩展声明了 `contributions`（`hasContributions = true`）**且会话空闲**（`!isBusy`）时，宿主自动开启一条 `openControlOnlyStream` 连接，专门接收 ui-rpc 响应。
- 仅当同时满足 `hasContributions && !isBusy` 才开启；prompt 流传输期间关闭（由 per-prompt 流处理 control 帧），**避免并发冲突**（`packages/ui/src/chat/pi-chat.tsx:406-410`）。

```typescript
// pi-chat.tsx:400-410（宿主逻辑）
const hasContributions = extension?.contributions !== undefined;
const hasArtifactRpc =
  extension?.artifact !== undefined && extensionBaseUrl !== undefined;
const needsIdleControl = hasContributions || hasArtifactRpc;
React.useEffect(() => {
  if (connection === undefined || isBusy || !needsIdleControl) return;
  return connection.openControlOnlyStream();
}, [connection, isBusy, needsIdleControl]);
```

---

## Tier 4：Artifact 隔离表面

### 工作原理

1. 扩展在描述符中声明 `artifact.entry`（相对于 `.pi/web/dist/` 的路径）。
2. 宿主用 `<ArtifactSurface src="…" sandbox="allow-scripts">` 加载（**不含** `allow-same-origin`），iframe 获得不透明 origin，无法访问宿主 cookie/DOM/凭证。
3. 双向通信经 postMessage，消息结构由 `@pi-web/protocol` 的 `ArtifactMessage` 类型约束：

```typescript
type ArtifactMessage =
  | { kind: "ready"; manifestId: string }
  | { kind: "resize"; height: number }
  | { kind: "rpc"; request: UiRpcRequest }   // artifact → 宿主中转回 agent
  | { kind: "event"; name: string; data: unknown }; // 宿主 → artifact 推送
```

非法来源或非法结构的消息**直接丢弃**（Req 5.4）。

### 配置 artifact（web.config.tsx）

```tsx
export default defineWebExtension({
  manifestId: "webext-artifact",
  capabilities: ["artifact"],
  artifact: {
    entry: "artifact.html",
    initialHeight: 240,
  },
});
```

### 门控：NEXT_PUBLIC_PI_EXTENSION_BASE_URL

`ArtifactSurface` 的 `src` 由 `extensionBaseUrl + artifact.entry` 拼接。**若未配置 `NEXT_PUBLIC_PI_EXTENSION_BASE_URL` 环境变量，`ArtifactSurface` 不会挂载**——这是正确的门控行为，不是 bug（`components/chat-app.tsx:375-377`）。

```bash
# .env.local
# dev：webext 与主 app 同源时直接用 dev 地址
NEXT_PUBLIC_PI_EXTENSION_BASE_URL=http://localhost:3000
# 生产：指向独立托管 artifact 资源的源（与排查步骤一致，见 ./18-troubleshooting-faq.md 第 3.1 节）
# NEXT_PUBLIC_PI_EXTENSION_BASE_URL=https://ext.example.com
```

设置后需重启 dev（`NEXT_PUBLIC_*` 在构建/启动期注入，运行时改 `.env.local` 不热更）。仍不出现 iframe 时，按 [18 故障排查 FAQ](./18-troubleshooting-faq.md) 第 3.1 节核对。

---

## Tier 5：纯声明配置（config）

无需 bundle，直接在 `manifest.json` 的 `config` 字段声明：

| 字段 | 类型 | 说明 |
|------|------|------|
| `documentTitle` | string | 加载该 source 后同步 `document.title`；切源后还原 |
| `layout` | `"centered"` \| `"wide"` \| `"full"` \| `"split"` | 版面预设（宿主 `LayoutPreset`，见 `packages/ui/src/customization/layout.ts:8`） |
| `panelRatio` | `"centered"` \| `"2:1"` \| `"3:7"` | 右侧面板初始比例，闭集枚举（`packages/protocol/src/web-ext/config.ts:23`，需配合 `slots.panelRight`） |
| `theme` | `Record<string, string>` | CSS 变量覆盖（宿主 token 前缀） |
| `empty.title/subtitle` | string | 空态屏文案 |
| `empty.starters` | array | 建议项列表 |
| `empty.mergeCommands` | `"prepend"` \| `"append"` \| `"replace"` | 与 agent slash 命令合并策略 |

**`config.layout="split"` 注意事项**：声明 `split` 布局但未在 `slots.panelRight` 提供内容时，宿主不渲染空的 `<aside>` 占位，优雅退化为居中版面（`pi-chat.tsx:1058-1062`）。之前版本曾留出 384px 空白侧边区域，已修复。

---

## 安全围栏

### 门控流程

1. **SRI 完整性**：重算 entry 字节 sha384，与 `manifest.integrity` 比对。
2. **签名白名单**：用 `PI_WEB_EXT_WHITELIST` 中的密钥 HMAC-SHA256 验签（任一命中即受信）。
3. **版本兼容**：`manifest.targetApiVersion`（semver range）须兼容宿主 `PI_WEB_KIT_VERSION`（默认 `0.1.0`）。

任何校验失败 → 拒绝加载，回退默认 UI，记审计日志。

### 相关环境变量

| 变量 | 说明 | 默认 |
|------|------|------|
| `PI_WEB_EXT_WHITELIST` | 逗号分隔的受信 HMAC 密钥 | `""` |
| `PI_WEB_EXT_REQUIRE_SIGNATURE` | 是否强制签名（`"false"` 关闭） | `"true"` |
| `PI_WEB_KIT_VERSION` | 宿主 web-kit 版本，用于版本兼容判定 | `"0.1.0"` |
| `NEXT_PUBLIC_PI_EXTENSION_BASE_URL` | Artifact 表面的基础 URL（缺失则不挂载） | — |

### CSS Scoping

`pi-web build` 把所有 class 选择器改写为 `.pw-<extId>-<原 class 名>`（`packages/web-kit/build/css-scope-plugin.ts`），拒绝 `*`/`html`/`body`/`:root`/顶层裸标签等全局选择器、Tailwind preflight、`@layer base`，命名空间化 `@keyframes`/`@font-face`，并要求自定义 CSS 变量须以 `--pw-<extId>-` 开头（只读宿主 token，不可覆写），防止多扩展样式互污。

---

## 加载流程（运行时）

```
选定 agent source → 宿主读取 .pi/web/dist/manifest.json
  │
  ├─ isDeclarativeOnly(manifest)?
  │    是 → 仅校验版本，从 manifest.config 合成描述符（Tier5，零 bundle）
  │    否 → fetch entry 字节 → SRI + 签名 + 版本校验
  │            ↓ 通过
  │         注入 import map（react/react-dom/@pi-web/web-kit → 宿主单例 URL）
  │         动态 import(entryUrl) → 取 default export WebExtension 描述符
  │
  ▼
applyExtension：合并 slots / per-session registry / contributions / config
  │
  ▼
PiChat 渲染：插槽挂载、渲染器生效、贡献点注册、artifact iframe 挂载
```

import map 在 `<head>` 静态注入，保证扩展中裸 `import "react"` 解析到宿主已加载的单例，避免 hook 冲突。

---

## 示例索引（examples/）

| 目录 | Tier | 说明 |
|------|------|------|
| `examples/webext-declarative-agent/` | Tier5 | 紫色主题、宽版布局、空态文案，纯 `manifest.json`，零 bundle |
| `examples/webext-layout-agent/` | Tier1 | `panelRight`（领域检视面板）+ header 三区 + `panelRatio: "3:7"` |
| `examples/webext-background-agent/` | Tier1 | `background` 插槽，动画极光背景，类名自命名空间 |
| `examples/webext-slots-agent/` | Tier1+5 | 18 个插槽全集 fixture + 空态声明式配置验收 |
| `examples/webext-renderer-agent/` | Tier2 | 自定义 `echo` 工具卡（`EchoToolRenderer`）+ `data-metric` data-part 渲染器 |
| `examples/webext-contrib-agent/` | Tier3 | slash 命令、@mention、autocomplete、inlineComplete、keybindings 全集，经 ui-rpc 回 agent |
| `examples/webext-artifact-agent/` | Tier4 | `artifact.html` sandbox iframe，postMessage resize/rpc 通信 |

E2E 测试入口：`e2e/browser/webext.e2e.ts`、`webext-full.e2e.ts`、`webext-document-title.e2e.ts`（均使用 `PI_WEB_STUB_AGENT=1` 离线 stub）。

---

## 常见问题

**Q：为什么 Artifact iframe 不出现？**
A：检查是否设置了 `NEXT_PUBLIC_PI_EXTENSION_BASE_URL`。未设置时宿主不挂载 `ArtifactSurface`，这是正确门控，非 bug（`components/chat-app.tsx:375`）。

**Q：渲染器没有触发？**
A：真实 dev 环境中，宿主只在收到匹配的 tool/data-part 时才调用自定义渲染器。用 `PI_WEB_STUB_AGENT=1` 启动可驱动 `echo` 工具触发，或让 LLM agent 实际调用对应工具。

**Q：`config.layout="split"` 但右侧是空白？**
A：`split` 仅声明布局意图，须同时在 `slots.panelRight` 提供实际组件；否则宿主不渲染 aside 容器，自动退化为居中版面（`pi-chat.tsx:1058`）。

**Q：slash/mention 触发后无响应？**
A：确认扩展声明了 `capabilities: ["contributions"]`，且会话**处于空闲状态**（`!isBusy`）——prompt 发送期间 per-prompt 流接管，空闲控制流暂停。

---

## 下一步 / 相关章节

- 扩展与技能安装管理 → [09 扩展与 Skills](./09-extensions-and-skills.md)
- 声明式 Config UI 与动态 widget → [12 Config UI](./12-config-ui.md)
- AIGC 图像生成工具（与 artifact 表面结合使用）→ [11 AIGC 工具](./11-aigc-tools.md)
- 浏览器 e2e 隔离构建跑法 → [17 开发与测试](./17-development-and-testing.md)
- `POST /sessions/:id/ui-rpc` 端点 → [13 HTTP API 参考](./13-http-api-reference.md)
