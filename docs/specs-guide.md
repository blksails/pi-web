# pi-web Spec 导览指南

> 本文档导览 `.kiro/specs/` 下全部 **37 个 spec**，按架构层 + 功能域分 11 章。
> 每条为一句话摘要，便于快速定位「某能力归属哪个 spec」。详情见各 spec 目录的
> `requirements.md` / `design.md` / `tasks.md`。
>
> 状态图例：✅ `implemented`（已实现）· 🟡 `tasks-generated`（已出任务、未完整实现）
> 生成日期：2026-06-24

## 0. 总览

### 分层架构与依赖流向

pi-web 自底向上分层装配，下层为上层提供契约与能力：

```
契约根         protocol-contract · rpc-channel
   ↓
后端引擎       agent-source-resolver → agent-runner → session-engine
              ├ session-store-adapters / session-persistence-url-resume
              └ http-api(对外开放面)
   ↓
整站装配       app-shell
   ↓
React 层       react-client(headless) → ui-components(有样式) → rich-chat-ui → pi-chat-customization
   ↓
交互富化       工具卡 / 命令面板 / 错误显示 / 用量面板 / 自定义渲染 / 空状态
   ↓
扩展体系       agent-web-extension(5 Tier UI 控制层) + 扩展管理 / UI surfaces / 内联交互
   ↘
横切能力       配置 UI · 补全框架 · 附件系统 · AIGC 工具 · agent 预设
```

### 状态总表

| 状态 | 数量 | spec |
|---|---|---|
| ✅ 已实现 | 30 | protocol-contract, rpc-channel, agent-source-resolver, agent-runner, session-engine, session-persistence-url-resume, http-api, app-shell, react-client, ui-components, rich-chat-ui, pi-chat-customization, tool-call-ui-redesign, slash-command-palette, stream-error-surfacing, session-usage-panel, new-by-agent-source, webext-empty-state-config, extension-management, extension-ui-surfaces, extension-ui-inline-interaction, config-ui-sandbox-extensions, schema-config-ui, system-resource-toggle-fix, completion-provider-framework, attachment-store, attachment-tool-bridge, agent-minimal-preset |
| 🟡 已出任务 | 7 | session-store-adapters, web-ui-custom-rendering, agent-web-extension, agent-web-extension-visual-acceptance, json-schema-config-form, attachment-mention-completion, aigc-generation-tools, aigc-tools-refactor, aigc-tools-interactive-params |

> 用 `/kiro-spec-status {feature}` 查看单个 spec 的实时进度。

---

## 1. 协议与契约根

全项目的同构契约根，零运行时依赖，被所有上层共享。

| spec | 状态 | 摘要 |
|---|---|---|
| `protocol-contract` | ✅ | `@blksails/pi-web-protocol`——全项目唯一契约根：零运行时依赖、Node + 浏览器同构、纯 TypeScript，集中定义类型与协议常量。 |
| `rpc-channel` | ✅ | 后端传输无关的 RPC 通道 `PiRpcChannel`(`send` / `onLine` / `close` / `health`)，让上层不绑定具体传输实现。 |

## 2. 后端会话引擎与运行时

从「解析 agent 源」到「spawn runner」再到「会话中枢」的后端主链路，以及存储与对外 API。

| spec | 状态 | 摘要 |
|---|---|---|
| `agent-source-resolver` | ✅ | agent 源解析器：给定 `source`(本地目录或 git 仓库)产出 `ResolvedSource`，供会话创建流程使用。 |
| `agent-runner` | ✅ | 自定义 agent 模式下，pi-web 为每个会话 spawn 的 bootstrap runner 子进程；用户用 pi SDK 编写 agent。 |
| `session-engine` | ✅ | 后端会话中枢：把 `ResolvedSource` 与 rpc 通道接成 `SessionManager` / `SessionStore`。 |
| `session-store-adapters` | 🟡 | 为 `@blksails/pi-web-server` 引入可插拔会话事件存储抽象 `SessionEntryStore`(支持多种后端适配器)。 |
| `session-persistence-url-resume` | ✅ | 会话恢复能力：`create({id})` / `open(path)` / `continueRecent`，并支持从 URL 恢复会话。 |
| `http-api` | ✅ | `http-api`——后端对外开放面，把进程内会话抽象经 `createPiHandler` 暴露为 HTTP 接口。 |

## 3. 整站装配层

| spec | 状态 | 摘要 |
|---|---|---|
| `app-shell` | ✅ | pi-web 整站闭环装配层：把协议、后端引擎、`http-api`、UI 各层组装成可运行的完整应用。 |

## 4. React / UI 组件层

从无样式 headless 到有样式富聊天，再到面向集成方的可定制契约。

| spec | 状态 | 摘要 |
|---|---|---|
| `react-client` | ✅ | `@blksails/pi-web-react`——无样式 headless React 层，面向 `ui-components` 与自定义 UI 两类消费方。 |
| `ui-components` | ✅ | `@blksails/pi-web-ui`——有样式、可主题化、可扩展的浏览器组件层，提供成品聊天 UI。 |
| `rich-chat-ui` | ✅ | 把 `@blksails/pi-web-ui` 聊天界面升级为对标 AI Elements 的富聊天界面，不破坏最小 `<PiChat>`。 |
| `pi-chat-customization` | ✅ | 为 `PiChat` 建立面向集成方的「四维可定制契约」，不改源码即可定制外观与装配。 |

## 5. 聊天交互富化

在富聊天界面之上补齐工具渲染、命令、错误、用量、新建与自定义渲染等交互细节。

| spec | 状态 | 摘要 |
|---|---|---|
| `tool-call-ui-redesign` | ✅ | 重构 `PiToolPart` 工具调用渲染层，参考 AI SDK Elements `Tool`，由单体卡片改为可装配复合组件。 |
| `slash-command-palette` | ✅ | 把已实现未接线的 `PiCommandPalette`("/" 斜杠命令浮层)接入富聊天界面。 |
| `stream-error-surfacing` | ✅ | provider/流式错误失败时在 Web UI 可见化呈现(此前用户看不到任何错误提示)。 |
| `session-usage-panel` | ✅ | 把现成的 `PiSessionStats` 用量面板接入产品实际使用的富版 `PiChat`。 |
| `new-by-agent-source` | ✅ | 改进顶栏新建会话体验：由「New session」按钮改为按 agent source 新建。 |
| `web-ui-custom-rendering` | 🟡 | server-driven UI：让 agent 作者从后端声明富 UI(指标卡、表格、键值、告示、进度等)。 |
| `webext-empty-state-config` | ✅ | 让聊天空状态(EmptyState)的标题、副标题、建议按钮可由配置/agent 声明，而非写死。 |

## 6. 扩展 / WebExtension 体系

agent source 自带的「UI 控制层」，及扩展的管理、推送 UI、内联交互与配置。

| spec | 状态 | 摘要 |
|---|---|---|
| `agent-web-extension` | 🟡 | 为每个 agent source 引入 `.pi/web` 下声明的前端扩展(WebExtension)「UI 控制层」，5 Tier 模型。 |
| `agent-web-extension-visual-acceptance` | 🟡 | 对 `agent-web-extension` 全量补齐 + 视觉验收：覆盖 Tier 1~5 全部插槽/渲染器/贡献点/环境 UI/交互。 |
| `extension-management` | ✅ | 受控的扩展管理 API，为命令面板提供数据源；依赖图最外围特性之一。 |
| `extension-ui-surfaces` | ✅ | 为扩展经 RPC/SSE 发出的 5 个单向推送 UI 方法(`notify`/`setStatus`/`set…` 等)补齐 web 端渲染。 |
| `extension-ui-inline-interaction` | ✅ | 把扩展 UI 四类交互(confirm/select/input/editor)由模态弹窗改为内联呈现，不强制打断。 |
| `config-ui-sandbox-extensions` | ✅ | 设置中心 schema 驱动的「沙箱」与「扩展」配置，覆盖全局 `~/.pi/agent/*.json` 与会话级。 |

## 7. 配置 UI / Schema 表单

由 schema 单一事实源生成配置表单，及系统资源开关修复。

| spec | 状态 | 摘要 |
|---|---|---|
| `schema-config-ui` | ✅ | 由 object schema 生成可校验、可读写的配置 UI，首批应用于 `~/.pi/agent` 配置。 |
| `json-schema-config-form` | 🟡 | 为带 `$schema`(JSON Schema URL)的独立配置文件(如 `proxy.json`)生成结构化设置表单。 |
| `system-resource-toggle-fix` | ✅ | 修复「设置→扩展→系统资源」的「载入系统 skills/extensions」两开关：关闭时新建会话确实不载入。 |

## 8. 补全框架

LSP 式触发符补全框架及其附件 mention 应用。

| spec | 状态 | 摘要 |
|---|---|---|
| `completion-provider-framework` | ✅ | LSP 式「触发符补全」框架：输入 `@`/`/`/`$` 等触发符弹候选，候选由可插拔服务端 `CompletionProvider` 提供。 |
| `attachment-mention-completion` | 🟡 | 基于触发符为「已上传/已有附件」提供 mention 补全，复用补全框架。 |

## 9. 附件系统

分层附件存储与 server-tool 桥接两切片。

| spec | 状态 | 摘要 |
|---|---|---|
| `attachment-store` | ✅ | 附件系统切片之一：基础层 L0(对象存储) + L1。 |
| `attachment-tool-bridge` | ✅ | 附件系统切片之二：文件给 server 端 tool 用 + 产出物回流 + context 闸门；依赖 `attachment-store`。 |

## 10. AIGC 工具

AIGC 生成工具引擎的移植、重构与交互参数补全。

| spec | 状态 | 摘要 |
|---|---|---|
| `aigc-generation-tools` | 🟡 | 在 pi-web 移植/落地 AIGC 生成工具引擎(参考 pi-labs 的 aigc categories 体系)。 |
| `aigc-tools-refactor` | 🟡 | 重构 `@blksails/pi-web-tool-kit` 既有 AIGC 工具，替换原 `Category` + 注册架构。 |
| `aigc-tools-interactive-params` | 🟡 | 在重构产物上为 `image_generation` / `image_edit` 引入「业务必选项 + 交互补全」。 |

## 11. Agent 预设

| spec | 状态 | 摘要 |
|---|---|---|
| `agent-minimal-preset` | ✅ | 为 `@blksails/pi-web-agent-kit` 提供 minimal「关闭」预设：免去逐字段手写 `noTools` / `skills` 覆盖等关闭配置。 |
