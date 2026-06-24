# 04 · 包结构与依赖关系

pi-web 由 7 个可独立发布的 npm 包组成，依赖方向单向收敛：`@pi-web/protocol` 是契约根，所有包向它单方向依赖，后端与前端之间不存在反向引用。

---

## 依赖关系总览

```
@pi-web/protocol  (契约根，零运行时依赖)
    ├── @pi-web/server          (Node only)
    ├── @pi-web/agent-kit       (Node only，轻量型帮助)
    │       └── @pi-web/tool-kit        (声明层 + 运行层)
    └── @pi-web/web-kit         (作者侧 UI 控制层 SDK)
            └── @pi-web/react   (headless hooks)
                    └── @pi-web/ui      (AI Elements 组件库)
```

各包核心属性如下：

| 包名 | 目录 | 运行环境 | 发布形态 | 状态 |
|---|---|---|---|---|
| `@pi-web/protocol` | `packages/protocol/` | 同构(浏览器/Node) | ✅ | 已实现 |
| `@pi-web/server` | `packages/server/` | Node ≥22.19 | ✅ | 已实现 |
| `@pi-web/react` | `packages/react/` | 浏览器(SSR 安全) | ✅ | 已实现 |
| `@pi-web/ui` | `packages/ui/` | 浏览器(SSR 安全) | ✅ | 已实现 |
| `@pi-web/agent-kit` | `packages/agent-kit/` | Node(dev/运行时可选) | ✅ | 已实现 |
| `@pi-web/tool-kit` | `packages/tool-kit/` | 主入口同构 / `./runtime` Node only | ✅ | 已实现 |
| `@pi-web/web-kit` | `packages/web-kit/` | 浏览器(构建时) | ✅ | 已实现 |
| `@pi-web/embed` | _(未建)_ | 浏览器 | 🔲 | 规划中 |

> **发布形态说明**：表中 ✅ 表示该包面向公开发布（`package.json` 非 `private`），但当前 7 个包**均尚未发布到 npm**，仓库内部一律经 pnpm `workspace:*` 互相消费，版本统一为 `0.1.0`。发布所需的 `publishConfig`（`dist` 构建产物 + `types`/`import` 映射）目前**仅 `@pi-web/protocol` 已完整配置**，其余包发布前仍需补齐。
>
> `@pi-web/embed`（Web Component `<pi-web-chat>` + iframe widget）列于 roadmap `embed-integrations`，尚未进入本批次实现。

---

## 各包详解

### @pi-web/protocol

**职责**：全项目唯一契约根。定义 RPC 类型/Schema、SSE 帧、UIMessage data-part、REST DTO、附件描述符、配置表单 IR（`config/`）、agent-web-extension 控制层契约（`web-ext/`）。

**运行时依赖**：仅 `zod`（零其他运行时依赖），同构，可安全引入浏览器 bundle。

**导出面** (`packages/protocol/src/index.ts`)：

| 子模块 | 主要导出 |
|---|---|
| `version` | `protocolVersion`, `ProtocolVersion` |
| `rpc/*` | RPC model/command/response/event/extension-ui/session-state |
| `transport/*` | `SpawnSpec`, `UiSpec`, `DataPart`, `UiMessageChunk`, SSE 帧, REST DTO, completion DTO |
| `attachment/` | `AttachmentDto` 及上传响应 DTO |
| `config/` | 配置表单 IR + adapter + 配置域契约 |
| `web-ext/` | WebExtension manifest / ui-rpc / descriptor / artifact 契约 |

**exports 字段**：

```json
{
  ".": "./src/index.ts"
}
```

> 协议变更必须遵循语义化版本；SSE 帧携带 `protocolVersion` 以便运行时兼容性检测。

---

### @pi-web/server

**职责**：后端引擎。包含 agent 源解析、bootstrap runner 路径解析、RPC 通道、会话注册与翻译、HTTP 路由处理器抽象、附件存储（L0/L1）、附件 tool-bridge（L2）、补全接口、扩展管理等六大模块。

**运行时依赖**：`@pi-web/protocol`、`@earendil-works/pi-ai`（≥0.79.6）、`@earendil-works/pi-coding-agent`（≥0.79.6）、`jiti`、`pg`、`zod`。Node ≥22.19 only。

**exports 字段**（三个导出子路径）：

```json
{
  ".":               "./src/index.ts",
  "./trust":         "./src/trust/index.ts",
  "./model-options": "./src/config/model-options.ts"
}
```

**主入口（`.`）聚合的六大模块**（`packages/server/src/index.ts`）：

| 模块 | 路径 | 说明 |
|---|---|---|
| `rpc-channel` | `./rpc-channel/index.js` | `PiRpcChannel` 接口 + `PiRpcProcess` local 实现（child_process JSONL framing） |
| `agent-source` | `./agent-source/index.js` | agent 源解析（目录\|git）+ 入口探测 + 双模式判定 + `SpawnSpec` 生成 |
| `session` | `./session/index.js` | `PiSession`（事件广播 + 生命周期）+ 事件→UIMessage 翻译 |
| `session-store` | `./session-store/index.js` | `SessionStore`/Registry 内存实现（接口外置备扩展） |
| `http` | `./http/index.js` | 框架无关 `createPiWebHandler`（Web Fetch API），REST + SSE 路由 |
| `extensions` | `./extensions/index.js` | 扩展安装/列出/卸载 + 来源白名单 + 命令面板集成 |

另有单独导出：
- `attachment` / `attachment-bridge` — 附件系统 L0-L2（均为纯 node builtins，可经 barrel 安全重导出）
- `completion` — 补全 DTO 路由
- `config` — 配置读取与 model-options 工厂
- `resolveSandboxEntry` — 沙箱入口解析
- `runnerBootstrapPath` — runner 子进程启动脚本路径

> **注意**：`./runner` 子路径**不**从主入口 barrel 重导出，以防 Next.js/webpack 将 pi SDK 打入路由 bundle。runner 仅由 `runner-bootstrap.mjs` 在子进程中经 `jiti` 加载。

**`./trust` 子路径**：导出信任策略（`FsProjectTrustStore`），读写 `<agentDir>/trust.json`，零 pi SDK 值依赖，作为稳定的显式信任面保留。

**`./model-options` 子路径**：导出 model-options 工厂，供 Next.js 路由获取可用模型列表。

---

### @pi-web/react

**职责**：headless 客户端层。提供 transport、REST client、SSE 连接管理、React hooks，无样式/无 JSX 组件。

**依赖**：`@pi-web/protocol`、`@pi-web/web-kit`；peer deps: `react`、`ai`（AI SDK v5）、`@ai-sdk/react`。

**主要导出**：

| 类别 | 关键符号 |
|---|---|
| transport | `PiTransport`（AI SDK v5 `ChatTransport` 实现）, `uploadAttachment` |
| client | `createPiClient`, `PiClient`, `PiHttpError`, `PiProtocolVersionError` |
| SSE | `PiSessionConnection`, `ControlStore`, `parseSse`, `decodeUiMessageChunk` |
| provider | `PiProvider`, `usePiContext` |
| hooks | `usePiSession`, `usePiControls`, `useExtensionUI`, `useModels`, `useAttachments`, `useBranches`, `useSuggestions` |
| web-ext | `verifyExtension`, `loadExtension`, `buildImportMap`, `createUiRpcBus` |
| config | 配置表单状态 + 设置面板注册表 + 域 IO |

**exports 字段**：

```json
{ ".": "./src/index.ts" }
```

---

### @pi-web/ui

**职责**：AI Elements 组件库（有样式）。基于 shadcn/ui + Tailwind CSS，提供 `<PiChat>`、工具部件、推理块、提示输入框、模型/思考/stats 控制面板、权限弹窗，以及 schema-driven 配置 UI（渲染器注册表 + 可搜索下拉）。

**依赖**：`@pi-web/protocol`、`@pi-web/react`、`@pi-web/web-kit`；外部 UI 库：`@radix-ui/*`、`cmdk`、`lucide-react`、`streamdown`、`clsx`、`tailwind-merge`。

**exports 字段**：

```json
{
  ".":           "./src/index.ts",
  "./styles.css": "./src/styles.css"
}
```

> 消费方需同时导入 `@pi-web/ui/styles.css`（Tailwind 样式入口）。

支持 Storybook 开发：`pnpm --filter @pi-web/ui storybook`（端口 6006）。

---

### @pi-web/agent-kit

**职责**：给自定义 agent 作者使用的轻量型帮助包。`defineAgent()` 是纯 identity 函数，仅提供编译期类型检查，零运行时副作用——即使不使用本包，定义的 `AgentDefinition` 结构与 runner 的要求完全兼容。

**依赖**：`@pi-web/protocol`；peer dep: `@earendil-works/pi-coding-agent`（仅类型）。

**主要导出**：

```typescript
// 定义入口
export function defineAgent(def: AgentDefinition): AgentDefinition

// 类型
export type { AgentDefinition, AgentContext, AgentModel }
export type { ToolDefinition, SystemPromptValue, ThinkingLevel, ... }

// 便利
export { defineMinimalAgent, minimalAgentPreset }
export { emitUi }                    // 工具内发出 data-pi-ui 部件

// 附件 tool 上下文（仅类型，运行期构造在 @pi-web/server）
export type { AttachmentToolContext, AttachmentToolHandle, ... }
```

**用法示例**：

```typescript
// <agent-dir>/index.ts
import { defineAgent } from "@pi-web/agent-kit";

export default defineAgent({
  // 省略 model → 继承 ~/.pi/agent/settings.json 的默认 provider/model，开箱即用。
  // 如需固定模型：model: { provider: "anthropic", modelId: "claude-opus-4-5" }
  //（但对应 provider 必须有有效凭据，否则 LLM 调用会失败）。
  systemPrompt: "You are a helpful assistant.",
});
```

> 可直接参考仓库 `examples/hello-agent/index.ts:1`（带自定义 `echo` 工具的最小可运行 agent）。详细用法见 [07 · Agent 开发](07-agent-development.md)。

---

### @pi-web/tool-kit

**职责**：通用工具套件。分为两层——主入口（前端安全声明层）和 `./runtime` 子入口（Node only 执行层）。

**依赖**：`@pi-web/agent-kit`、`undici`（运行层）；peer deps: `@earendil-works/pi-ai`、`@earendil-works/pi-coding-agent`。

**exports 字段**：

```json
{
  ".":         "./src/index.ts",    // 声明层，前端安全
  "./runtime": "./src/runtime.ts"   // 执行层，Node only
}
```

**主入口（声明层）**：

```typescript
export * from "./engine/types.js"         // 引擎类型
export { AIGC_TOOLS, imageGeneration, imageEdit }  // AIGC 工具声明
```

**`./runtime` 子入口（执行层）**：

| 类别 | 关键符号 |
|---|---|
| 引擎 | `runEndpoint`, `resolveVars`, `proxyFetch` |
| 附件 | `getAttachmentToolContext`, `persistPicked`, `resolveInputToDataUri` |
| 工具编译 | `compileTool` |
| AIGC 工具集 | `buildAigcTools`, `AIGC_TOOLS` |

> 凡含 pi SDK 值导入的逻辑一律放 `./runtime`，严禁混入主入口，以守 Next/webpack externals 边界。

---

### @pi-web/web-kit

**职责**：agent source `.pi/web` 的作者侧 SDK（UI 控制层），与 `@pi-web/agent-kit` 对称——`defineAgent()` 对应 `defineWebExtension()`。作者写 `.pi/web` 入口，默认导出 `WebExtension`；随包发布的 `pi-web build` CLI 预构建为 ESM bundle + manifest。

**依赖**：`@pi-web/protocol`、`esbuild`（构建工具）；peer deps: `react`、`ai`。

**exports 字段**：

```json
{
  ".":       "./src/index.ts",
  "./build": "./build/index.ts"    // 构建 CLI 入口
}
```

**bin 入口**：`pi-web` → `./build/cli.ts`

**主要导出**（稳定核）：

```typescript
export { defineWebExtension }         // identity helper + 类型
export type { WebExtension, SlotContribution, ContributionPoints, ... }
export { SLOTS }                      // 插槽常量表
export type { UiRpcClient }           // 宿主↔扩展 RPC 类型
export type { WebExtHostContext }
// protocol re-export（可序列化契约）
export type { SlotKey, WebExtConfig, ArtifactDeclaration, UiRpcPoint, ... }
```

**用法示例**：

```tsx
// <agent-dir>/.pi/web/web.config.tsx
import { defineWebExtension } from "@pi-web/web-kit";

export default defineWebExtension({
  manifestId: "my-ext",            // 必填:扩展唯一标识
  capabilities: ["slots"],
  slots: {
    // SlotKey 为 camelCase(panelRight / headerLeft / artifactSurface …);
    // 贡献值可为 ReactNode,或受 { extId } props 的组件。
    panelRight: <MyPanel />,
  },
});
```

> 插槽 key 取自 `SLOTS` 常量表（`SLOTS.panelRight` 等），亦可直接写字面量；可用插槽全集见 `packages/web-kit/src/slots.ts:8` 与 [10 · Web UI 扩展](10-web-ui-extension.md)。完整可运行范例见仓库 `examples/webext-slots-agent/.pi/web/web.config.tsx:1`。

---

## 规划中的包

| 包名 | 规划 spec | 说明 |
|---|---|---|
| `@pi-web/embed` | `embed-integrations` | Web Component `<pi-web-chat>` + iframe widget，支持非 React 项目嵌入 |

---

## 依赖方向速查

```
@pi-web/protocol  ←──────── 所有包
@pi-web/server    ────依赖──→ @pi-web/protocol 只
@pi-web/agent-kit ────依赖──→ @pi-web/protocol 只
@pi-web/tool-kit  ────依赖──→ @pi-web/agent-kit
@pi-web/web-kit   ────依赖──→ @pi-web/protocol
@pi-web/react     ────依赖──→ @pi-web/protocol + @pi-web/web-kit
@pi-web/ui        ────依赖──→ @pi-web/protocol + @pi-web/react + @pi-web/web-kit

禁止：server ↔ react/ui（后端与前端不互相依赖）
禁止：protocol 反向依赖任何包
```

---

## 下一步 / 相关文档

- [03 · 架构总览](03-architecture.md) — 各包在运行时的拓扑与进程边界
- [05 · 配置参考](05-configuration.md) — `@pi-web/server/model-options` 与环境变量
- [07 · Agent 开发](07-agent-development.md) — `@pi-web/agent-kit` 与 `defineAgent()` 的详细用法
- [09 · 扩展与技能](09-extensions-and-skills.md) — `@pi-web/web-kit` 与 `defineWebExtension()`
- [11 · AIGC 工具](11-aigc-tools.md) — `@pi-web/tool-kit/runtime` 的 `buildAigcTools`
- [13 · HTTP API 参考](13-http-api-reference.md) — `@pi-web/server` HTTP 模块的路由约定
