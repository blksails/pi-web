# pi-web 示例总索引

本目录收录 18 个**可直接运行**的 pi-web 示例 agent，从「零能力基线」一路覆盖到内置工具、文件会话、可观测性（日志）、server-driven UI、附件 / AIGC，直至 WebExtension 的 5 个 Tier。每个示例都是一个最小、自包含、能跑起来看到效果的 `AgentDefinition`，是学习对应能力最快的入口。

## 怎么跑

前端的 agent **source 指向某个示例目录**（绝对或相对路径）即进入会话；CLI 形态：

```bash
pi-web ./examples/hello-agent
```

- **model 省略即继承默认**：几乎所有示例都**故意不写 `model`**，运行时继承 `~/.pi/agent/settings.json` 的 `defaultProvider` / `defaultModel`，并从 `~/.pi/agent/auth.json` 解析凭证——因此换任意 pi 登录（anthropic / openrouter / openai…）都开箱即用。要钉死某个模型，给 `defineAgent` 加 `model: { provider, modelId }`，但该 provider 必须有有效 auth。
- **WebExtension 示例**额外携带 `.pi/web`（区域插槽 / 渲染器 / 贡献点 / artifact / 声明式 manifest），UI 定制随 source 一并加载。
- **AIGC 示例**需要 provider 密钥经环境变量提供（如 `DASHSCOPE_API_KEY` / `OPENROUTER_API_KEY` / `NEWAPI_API_KEY`）；缺失时工具仍加载并返回「能力不可用」降级，不崩溃。

各示例若带独立 `README.md`，里面有更详细的运行指引与前端接线说明。

## 按能力分组

### 入门基线

| 示例 | 一句话 | 关键 API / 能力 | 推荐顺序 |
|---|---|---|---|
| [minimal-agent](./minimal-agent/) | 最彻底的零能力基线：关掉所有内置 / 扩展工具、skills、扩展 | `defineMinimalAgent`（`noTools: "all"`） | 1️⃣ |
| [hello-agent](./hello-agent/) | 最小自定义 agent：一个 `echo` 自定义工具 + system prompt | `defineAgent` / `defineTool` / `customTools` | 2️⃣ |

### 内置工具 / 会话

| 示例 | 一句话 | 关键 API / 能力 | 难度 |
|---|---|---|---|
| [builtin-tools-agent](./builtin-tools-agent/) | 显式启用 pi 内置文件 / shell 工具集 | `tools` allowlist（read/ls/grep/glob/bash/edit/write/patch/fetch）、`excludeTools` denylist | ★☆☆ |
| [file-session-agent](./file-session-agent/) | 演示「文件存储会话」：会话落 JSONL，可被 `FsSessionEntryStore` 回读 | 运行时 `SessionManager`（`--agent-dir`）、`FsSessionEntryStore` | ★★☆ |
| [pi-probe-agent](./pi-probe-agent/) | 探针：验证项目级 `.pi/` 资源（extensions/agents/skills）是否被加载 | `.pi/` 发现、project trust 门控 | ★★☆ |
| [logging-demo-agent](./logging-demo-agent/) | 端到端演示日志系统：工厂期 `ctx.logger` 四级日志 + pi extension + webext 三源汇入日志面板 | `ctx.logger`（注入）、`logger.child()`、`createLogger`（`@blksails/pi-web-logger`）、`PI_WEB_LOG_*` env | ★★☆ |

### server-driven UI 与交互

| 示例 | 一句话 | 关键 API / 能力 | 难度 |
|---|---|---|---|
| [server-driven-ui-agent](./server-driven-ui-agent/) | 后端声明富 UI，前端零配置渲染（`data-pi-ui`） | `emitUi(onUpdate, spec)`、`kind: "builtin"`（白名单组件）/ `"sandbox"`（受限节点树） | ★★☆ |
| [ui-demo-agent](./ui-demo-agent/) | extension UI 全部常用交互：弹窗 / 表单 / 状态条 / 通知 | `ctx.ui.select` / `confirm` / `input`（阻塞）、`setStatus` / `notify`（ambient） | ★★☆ |
| [system-status-agent](./system-status-agent/) | 在一个「健康检查」工具里把 server-driven UI + ambient 状态 / 通知组合起来 | `emitUi` + `ctx.ui.setStatus` / `notify` 组合 | ★★★ |

### 附件 / AIGC

| 示例 | 一句话 | 关键 API / 能力 | 难度 |
|---|---|---|---|
| [attachment-tool-agent](./attachment-tool-agent/) | 附件工具桥端到端：上传图 → `att_id` → 工具处理 → 落库回引用 | `AttachmentToolContext`（`resolve` / `putOutput`）、`afterToolCall` 闸门、`/raw` 分发 | ★★★ |
| [aigc-agent](./aigc-agent/) | AIGC 生成工具端到端：文生图 / 图编辑，产物经 attachment store 落库 | `buildAigcTools()`（`image_generation` / `image_edit`）、`@blksails/pi-web-tool-kit/runtime` | ★★★ |

### WebExtension（按 Tier 1–5）

每个示例随目录携带 `.pi/web`，演示 Web UI 扩展协议的某一层。建议按 Tier 顺序逐层理解。

| 示例 | Tier | 一句话 | 关键能力 | 顺序 |
|---|---|---|---|---|
| [webext-layout-agent](./webext-layout-agent/) | 1 | 填充 `panelRight` / `headerCenter` 区域插槽 | 区域插槽 SlotHost | 1️⃣ |
| [webext-background-agent](./webext-background-agent/) | 1 | 自定义动画极光背景（`background` 插槽，渲染于消息层之下） | `background` 区域插槽、scoped CSS | 1️⃣ |
| [webext-slots-agent](./webext-slots-agent/) | 1+5 | 协议保留插槽全集（18 个区域插槽）补齐验收 fixture | 18 个区域插槽接线（协议 SlotKeySchema 共 19 槽，fixture 未含 logs） | 1️⃣ |
| [webext-renderer-agent](./webext-renderer-agent/) | 2 | 注册自定义渲染器：`data-metric` data-part + `echo` 工具卡 | `renderers.tools` / data-part 渲染器、`web.config.tsx` | 2️⃣ |
| [webext-contrib-agent](./webext-contrib-agent/) | 3 | 贡献点（slash / @mention），经 ui-rpc 回 agent 取候选 | 贡献点 provider、`UiRpcClient` | 3️⃣ |
| [webext-artifact-agent](./webext-artifact-agent/) | 4 | LLM 输出在独立 origin sandbox iframe 中渲染 | artifact 隔离表面、`NEXT_PUBLIC_PI_EXTENSION_BASE_URL` 门控 | 4️⃣ |
| [webext-declarative-agent](./webext-declarative-agent/) | 5 | 纯声明零代码 UI 扩展（theme token + layout，无 bundle） | `.pi/web/manifest.json` 内联声明式 config、零加载路径 | 5️⃣ |
| [plugin-code-review-agent](./plugin-code-review-agent/) | 2+3 | 双角色:自运行 agent + 可发布插件包（统一清单 pi-plugin.json、code_review 工具富卡 + slash 贡献点） | `pi-plugin.json` 统一清单、`bindings.tools`、Tier2 渲染器、Tier3 贡献点、双角色（自运行/可安装） | ⭐ |
| [plugin-consumer-agent](./plugin-consumer-agent/) | — | 消费方:安装 @acme/code-review 插件后零改动获得 code_review 工具 + 富卡渲染 | `extensions: ["local:..."]`、零本地工具代码、插件复用 | ⭐ |

## 推荐学习路径

1. **基线**：[minimal-agent](./minimal-agent/) → [hello-agent](./hello-agent/)，理解 `defineAgent` / `defineTool` 与 `noTools` 的语义梯度。
2. **工具与会话**：[builtin-tools-agent](./builtin-tools-agent/)（启用内置工具）→ [file-session-agent](./file-session-agent/)（会话持久化）→ [logging-demo-agent](./logging-demo-agent/)（日志系统三源汇入面板）。
3. **server-driven UI**：[server-driven-ui-agent](./server-driven-ui-agent/)（后端发 UI）→ [ui-demo-agent](./ui-demo-agent/)（交互 / ambient）→ [system-status-agent](./system-status-agent/)（两者组合）。
4. **附件 / AIGC**：[attachment-tool-agent](./attachment-tool-agent/)（附件工具桥）→ [aigc-agent](./aigc-agent/)（文生图 / 图编辑）。
5. **WebExtension 五层**：[webext-layout-agent](./webext-layout-agent/) / [webext-background-agent](./webext-background-agent/) / [webext-slots-agent](./webext-slots-agent/)（Tier 1 插槽）→ [webext-renderer-agent](./webext-renderer-agent/)（Tier 2 渲染器）→ [webext-contrib-agent](./webext-contrib-agent/)（Tier 3 贡献点）→ [webext-artifact-agent](./webext-artifact-agent/)（Tier 4 artifact）→ [webext-declarative-agent](./webext-declarative-agent/)（Tier 5 声明式）。

## 延伸阅读（产品文档）

- [07 自定义 Agent 开发](../docs/product/07-agent-development.md) —— `defineAgent` / 工具 / 工具姿态（`noTools` / `tools` / `excludeTools`）。
- [10 Web UI 扩展](../docs/product/10-web-ui-extension.md) —— `.pi/web` 协议与 WebExtension 五个 Tier。
- [11 AIGC 工具](../docs/product/11-aigc-tools.md) —— `buildAigcTools()`、provider 密钥与产物落库。
- [08 附件系统](../docs/product/08-attachment-system.md) —— attachment store、工具桥、`/raw` 分发。
