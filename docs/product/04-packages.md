# 04 · 包结构与依赖关系

pi-web 由 7 个可独立发布的 npm 包组成，依赖方向单向收敛：`@blksails/pi-web-protocol` 是契约根，所有包向它单方向依赖，后端与前端之间不存在反向引用。

---

## 依赖关系总览

```
@blksails/pi-web-protocol  (契约根，零运行时依赖)
    ├── @blksails/pi-web-server          (Node only)
    ├── @blksails/pi-web-agent-kit       (Node only，轻量型帮助)
    │       └── @blksails/pi-web-tool-kit        (声明层 + 运行层)
    └── @blksails/pi-web-kit         (作者侧 UI 控制层 SDK)
            └── @blksails/pi-web-react   (headless hooks)
                    └── @blksails/pi-web-ui      (AI Elements 组件库)
```

各包核心属性如下：

| 包名 | 目录 | 运行环境 | 发布形态 | 状态 |
|---|---|---|---|---|
| `@blksails/pi-web-protocol` | `packages/protocol/` | 同构(浏览器/Node) | ✅ | 已实现 |
| `@blksails/pi-web-server` | `packages/server/` | Node ≥22.19 | ✅ | 已实现 |
| `@blksails/pi-web-react` | `packages/react/` | 浏览器(SSR 安全) | ✅ | 已实现 |
| `@blksails/pi-web-ui` | `packages/ui/` | 浏览器(SSR 安全) | ✅ | 已实现 |
| `@blksails/pi-web-agent-kit` | `packages/agent-kit/` | Node(dev/运行时可选) | ✅ | 已实现 |
| `@blksails/pi-web-tool-kit` | `packages/tool-kit/` | 主入口同构 / `./runtime` Node only | ✅ | 已实现 |
| `@blksails/pi-web-kit` | `packages/web-kit/` | 浏览器(构建时) | ✅ | 已实现 |
| `@blksails/embed` | _(未建)_ | 浏览器 | 🔲 | 规划中 |

> **发布形态说明**：表中 ✅ 表示该包面向公开发布（`package.json` 非 `private`），但当前 7 个包**均尚未发布到 npm**，仓库内部一律经 pnpm `workspace:*` 互相消费，版本统一为 `0.1.0`。发布所需的 `publishConfig`（`dist` 构建产物 + `types`/`import` 映射）目前**仅 `@blksails/pi-web-protocol` 已完整配置**，其余包发布前仍需补齐。
>
> `@blksails/embed`（Web Component `<pi-web-chat>` + iframe widget）列于 roadmap `embed-integrations`，尚未进入本批次实现。

---

## 各包详解

### @blksails/pi-web-protocol

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

### @blksails/pi-web-server

**职责**：后端引擎。包含 agent 源解析、bootstrap runner 路径解析、RPC 通道、会话注册与翻译、HTTP 路由处理器抽象、附件存储（L0/L1）、附件 tool-bridge（L2）、补全接口、扩展管理等六大模块。

**运行时依赖**：`@blksails/pi-web-protocol`、`@earendil-works/pi-ai`（≥0.79.6）、`@earendil-works/pi-coding-agent`（≥0.79.6）、`jiti`、`pg`、`zod`。Node ≥22.19 only。

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

### @blksails/pi-web-react

**职责**：headless 客户端层。提供 transport、REST client、SSE 连接管理、React hooks，无样式/无 JSX 组件。

**依赖**：`@blksails/pi-web-protocol`、`@blksails/pi-web-kit`；peer deps: `react`、`ai`（AI SDK v5）、`@ai-sdk/react`。

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

### @blksails/pi-web-ui

**职责**：AI Elements 组件库（有样式）。基于 shadcn/ui + Tailwind CSS，提供 `<PiChat>`、工具部件、推理块、提示输入框、模型/思考/stats 控制面板、权限弹窗，以及 schema-driven 配置 UI（渲染器注册表 + 可搜索下拉）。

**依赖**：`@blksails/pi-web-protocol`、`@blksails/pi-web-react`、`@blksails/pi-web-kit`；外部 UI 库：`@radix-ui/*`、`cmdk`、`lucide-react`、`streamdown`、`clsx`、`tailwind-merge`。

**exports 字段**：

```json
{
  ".":           "./src/index.ts",
  "./styles.css": "./src/styles.css"
}
```

> 消费方需同时导入 `@blksails/pi-web-ui/styles.css`（Tailwind 样式入口）。

支持 Storybook 开发：`pnpm --filter @blksails/pi-web-ui storybook`（端口 6006）。

#### 自研 i18n 机制

`@blksails/pi-web-ui` 内置一套**轻量自研的国际化运行时**（`packages/ui/src/i18n/`），刻意不引入 `react-i18next`、`formatjs` 等第三方库：字典是纯对象、翻译是纯字符串查表，同构（浏览器/Node）且零运行时依赖。它随组件库整包 barrel 一同导出（`packages/ui/src/index.ts` 从 `./i18n/index.js` 重导出），消费方无需额外安装或配置。

**字典结构**：`Locale` 目前有 `"zh"` 与 `"en"` 两种，各自是一张 `Record<string, string>`（`packages/ui/src/i18n/messages.ts`）。key 采用 `域.子项` 的点分命名（如 `chat.empty.title`、`sessionItemMenu.deleteConfirmBody`），两张表按同一组 key 平行维护，约 173 条。key 类型故意保持宽松的 `string`（而非字面量联合），以便增量迁移时逐步补齐。

**`t()` 翻译函数**：组件通过 `useI18n()` 拿到翻译函数 `t`，签名为 `(key: string, params?: Record<string, string | number>) => string`。其行为契约（`packages/ui/src/i18n/context.tsx` 的 `translate`）：

| 特性 | 行为 |
|---|---|
| **绝不抛错** | 任意 key 都返回一个字符串，不会因缺失 key 崩溃 |
| **缺失回退** | 查找顺序为「当前 locale → `zh` → key 原文」：先查当前语言，缺失则回退中文，再缺失则**原样返回 key 本身**（保证 UI 永远有可见文本，便于发现漏翻） |
| **参数替换** | `params` 存在时对模板内 `{name}` 占位符做插值；占位符名不在 `params` 中则保留原文。参数值类型为 `string | number`（数字会 `String()` 转字符串），不支持复数、日期等 ICU 语法 |

**无 Provider 默认 zh**：`useI18n()` 不强制外层挂 Provider——`I18nContext` 的 `defaultContext` 直接绑定 `translate("zh", …)`，因此在没有 `I18nProvider` 的场景（如某些 Storybook story 或裸用单个组件）下 `t` 仍可用，默认输出中文。挂上 `I18nProvider` 后才获得语言切换能力：它以 `locale` state 驱动 `t`，客户端挂载后从 `localStorage` 的 `pi-web.locale` 键读回用户偏好（首帧仍用 `initialLocale` 以避免 SSR 水合不匹配），`setLocale` 写回同一键持久化。

**语言切换 UI**：`I18nProvider` 由宿主 app 在 `app/providers.tsx` 挂载（经整包 barrel 引入）；面向用户的切换按钮是 `app/theme-controls.tsx` 的 `LocaleToggleButton`（`data-pi-locale-toggle`），它用 `useLocale()` 拿到 `{ locale, setLocale }` 在 `zh ↔ en` 间切换，与主题切换按钮并排渲染在 `components/chat-app.tsx` 的头部。注意：**语言切换 UI 属于宿主 app 层而非组件库**——`@blksails/pi-web-ui` 只导出 `I18nProvider` / `useI18n` / `useLocale` 三个原语，切换控件由集成方按需自行组装。

**给组件作者的用法要点（prop 默认值须下沉函数体）**：当一个文案有对应的**可覆盖 prop** 时，不要把 `t("…")` 写成解构参数的默认值——那样默认值会在渲染前、`t` 尚不可用（且不随 locale 变化）时被固化。约定是把该 prop 接收为 `undefined`（如重命名为 `xxxProp`），再在函数体内用 `??` 回退到 `t()`：

```tsx
// packages/ui/src/chat/pi-chat.tsx（约定示例）
function PiChat({ emptyTitle: emptyTitleProp, /* … */ }: PiChatProps) {
  const t = useI18n();
  const emptyTitle = emptyTitleProp ?? t("chat.empty.title");   // 下沉到函数体
  // …
}
```

这样既让调用方可显式覆盖文案，又保证未覆盖时走响应式的 `t()`（随语言切换实时更新）。纯内部、无对应 prop 的文案则直接 `t("…")` 即可。

---

### @blksails/pi-web-agent-kit

**职责**：给自定义 agent 作者使用的轻量型帮助包。`defineAgent()` 是纯 identity 函数，仅提供编译期类型检查，零运行时副作用——即使不使用本包，定义的 `AgentDefinition` 结构与 runner 的要求完全兼容。

**依赖**：`@blksails/pi-web-protocol`；peer dep: `@earendil-works/pi-coding-agent`（仅类型）。

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

// 附件 tool 上下文（仅类型，运行期构造在 @blksails/pi-web-server）
export type { AttachmentToolContext, AttachmentToolHandle, ... }
```

**用法示例**：

```typescript
// <agent-dir>/index.ts
import { defineAgent } from "@blksails/pi-web-agent-kit";

export default defineAgent({
  // 省略 model → 继承 ~/.pi/agent/settings.json 的默认 provider/model，开箱即用。
  // 如需固定模型：model: { provider: "anthropic", modelId: "claude-opus-4-5" }
  //（但对应 provider 必须有有效凭据，否则 LLM 调用会失败）。
  systemPrompt: "You are a helpful assistant.",
});
```

> 可直接参考仓库 `examples/hello-agent/index.ts:1`（带自定义 `echo` 工具的最小可运行 agent）。详细用法见 [07 · Agent 开发](07-agent-development.md)。

---

### @blksails/pi-web-tool-kit

**职责**：通用工具套件。分为两层——主入口（前端安全声明层）和 `./runtime` 子入口（Node only 执行层）。

**依赖**：`@blksails/pi-web-agent-kit`、`undici`（运行层）；peer deps: `@earendil-works/pi-ai`、`@earendil-works/pi-coding-agent`。

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

### @blksails/pi-web-kit

**职责**：agent source `.pi/web` 的作者侧 SDK（UI 控制层），与 `@blksails/pi-web-agent-kit` 对称——`defineAgent()` 对应 `defineWebExtension()`。作者写 `.pi/web` 入口，默认导出 `WebExtension`；随包发布的 `pi-web build` CLI 预构建为 ESM bundle + manifest。

**依赖**：`@blksails/pi-web-protocol`、`esbuild`（构建工具）；peer deps: `react`、`ai`。

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
import { defineWebExtension } from "@blksails/pi-web-kit";

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
| `@blksails/embed` | `embed-integrations` | Web Component `<pi-web-chat>` + iframe widget，支持非 React 项目嵌入 |

---

## 依赖方向速查

```
@blksails/pi-web-protocol  ←──────── 所有包
@blksails/pi-web-server    ────依赖──→ @blksails/pi-web-protocol 只
@blksails/pi-web-agent-kit ────依赖──→ @blksails/pi-web-protocol 只
@blksails/pi-web-tool-kit  ────依赖──→ @blksails/pi-web-agent-kit
@blksails/pi-web-kit   ────依赖──→ @blksails/pi-web-protocol
@blksails/pi-web-react     ────依赖──→ @blksails/pi-web-protocol + @blksails/pi-web-kit
@blksails/pi-web-ui        ────依赖──→ @blksails/pi-web-protocol + @blksails/pi-web-react + @blksails/pi-web-kit

禁止：server ↔ react/ui（后端与前端不互相依赖）
禁止：protocol 反向依赖任何包
```

---

## 下一步 / 相关文档

- [03 · 架构总览](03-architecture.md) — 各包在运行时的拓扑与进程边界
- [05 · 配置参考](05-configuration.md) — `@blksails/pi-web-server/model-options` 与环境变量
- [07 · Agent 开发](07-agent-development.md) — `@blksails/pi-web-agent-kit` 与 `defineAgent()` 的详细用法
- [09 · 扩展与技能](09-extensions-and-skills.md) — `@blksails/pi-web-kit` 与 `defineWebExtension()`
- [11 · AIGC 工具](11-aigc-tools.md) — `@blksails/pi-web-tool-kit/runtime` 的 `buildAigcTools`
- [13 · HTTP API 参考](13-http-api-reference.md) — `@blksails/pi-web-server` HTTP 模块的路由约定
