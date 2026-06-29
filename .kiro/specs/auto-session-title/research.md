# 研究与发现日志：auto-session-title

## 发现范围

Extension 类特性（在既有 pi-web 系统上集成一个强制注入扩展）。发现聚焦集成点、既有模板、pi SDK 0.79.6 契约与离线 e2e 可行性。代码已逐一核实（非记忆）。

## 关键发现

### 1. 标题展示链路端到端预埋（零协议 / 零前端改动）

| 环节 | 位置 | 现状 |
|---|---|---|
| 协议帧 `setTitle` | `packages/protocol/src/rpc/extension-ui.ts:72` | 已定义 `extension_ui_request{method:"setTitle", title}` |
| react 分流到 ambient | `packages/react/src/sse/control-store.ts:227` | 推送类方法写入 `ambient.title` |
| UI 渲染 | `packages/ui/src/chat/pi-chat.tsx:413,1015-1020` | `ambientTitle = extensionUI?.title` 已消费渲染 |

**结论**：扩展只需调 `ctx.ui.setTitle(t)`，标题即沿现有链路展示，无需任何协议/前端改动。

### 2. 注入机制：复用「扩展管理扩展」模板（spec extension-install-agent-tools）

| 环节 | 模板（已存在） | auto-title 对应 |
|---|---|---|
| 路径解析器（不 import pi SDK，可进 Next bundle） | `extension-tools/entry-path.ts` → 导出 `extensionManagerEntryPath()` | ✅ `auto-title/entry-path.ts` 已写，导出 `autoTitleEntryPath()` |
| package 子入口 | `package.json` exports `"./extension-entry"` | ❌ 待加 `"./auto-title-entry"` |
| 主进程下发 env | `lib/app/pi-handler.ts:272,322` 设 `PI_WEB_EXT_TOOLS_ENTRY` | ❌ 待加 `PI_WEB_AUTO_TITLE_ENTRY`（受总开关门控） |
| runner 读 env → forcedExtensionPaths | `packages/server/src/runner/option-mapper.ts:244-253` `buildRuntimeFactory` | ❌ 待加一项 |
| 扩展本体 default export | `extension-tools/extension-manager.ts` | ❌ 待写 `auto-title-extension.ts` |

`forcedExtensionPaths` 经 `mapResourceLoaderOptions` 置前追加到 `additionalExtensionPaths`，并豁免 `allowExtensions` 白名单（见 `option-mapper-forced-inject.test.ts`）——即对每个会话强制注入，无需用户 agent 声明。

### 3. pi SDK 0.79.6 契约（已核实 d.ts）

- **触发**：`pi.on("agent_end", handler)`，`AgentEndEvent = { type:"agent_end"; messages: AgentMessage[] }`（`core/extensions/types.d.ts:507,824`）。每轮 agent loop 结束触发。
- **写标题**：`ctx.ui.setTitle(title: string): void`（`types.d.ts:114`）。
- **当前模型**：`ctx.model: Model<any> | undefined`（`types.d.ts:222`）。
- **一次性 LLM 调用**：pi-ai `completeSimple(model, context, options?): Promise<AssistantMessage>`（`stream.d.ts:7`）。`Context = { systemPrompt?: string; messages: Message[]; tools? }`（`types.d.ts:254`）。
- **消息桥接**：pi-agent-core `convertToLlm(messages: AgentMessage[]): Message[]`（`harness/messages.d.ts`）将 `agent_end` 的 `AgentMessage[]` 转 pi-ai `Message[]` 供 Context。
- **取标题文本**：`AssistantMessage.content` 过滤 `type === "text"` 取 `text` 字段（`types.d.ts:207`）。
- `ctx.model` 的 `Model` 即 pi-ai `Model`（pi-coding-agent 复用 pi-ai 类型），故可直接传入 `completeSimple`。

### 4. 离线确定性 e2e 可行

`e2e/cli/cli-real.mjs` 已有「真实 runner 子进程 + 本地 mock OpenAI Chat Completions SSE provider（models.json 指向）」模式：

- agent loop 在 mock provider 下离线完成 → `agent_end` 触发（无需真实 API key）。
- 配 `PI_WEB_AUTO_TITLE_STRATEGY=heuristic` → 标题确定性来自首条用户消息，完全不依赖 LLM 输出内容。
- runner 子进程 stdout 帧里可断言出现 `extension_ui_request{method:"setTitle"}`。

参考 `packages/server/test/runner/runner.e2e.test.ts`（spawn 真实 runner + 等帧）的 harness。

## 设计决策

| 决策 | 选择 | 理由 |
|---|---|---|
| 纯逻辑 / 扩展壳分层 | config 解析 + 标题生成纯函数（无 pi import）与 `on("agent_end")` 壳分离 | 纯函数可单测；壳薄、只做事件接线与 try/catch 兜底 |
| LLM 调用可注入 | 生成器接收「调用模型」函数作为依赖，扩展壳注入 `completeSimple` | 单测无需真实模型即可覆盖 once/refresh/兜底状态机 |
| once 状态 | 扩展闭包内 `hasSetTitle` 标志，仅成功设置后置真 | 失败可在后续 agent_end 重试（Req 2.2） |
| 总开关门控位置 | `PI_WEB_AUTO_TITLE` 在 **pi-handler**（是否下发 entry），非扩展内 | 与 logging 默认门控一致：服务端权威，关时连扩展都不注入，零开销 |
| 默认值 | 开 + once + llm（兜底 heuristic）+ maxLen≈24 | 用户决策：默认开 + once |
| 失败语义 | 全程 try/catch 吞错，跳过设置不报错不阻塞 | Req 7 |

## 风险与缓解

- **`convertToLlm` / `completeSimple` 跨版本签名漂移**：peerDependency 锁 `^0.79.6`；扩展壳对模型调用 try/catch 兜底到 heuristic，签名变动最多退化为启发式标题，不崩会话。
- **stub 模式不走 forcedExtensionPaths**：stub channel 用独立 spawn spec，不经 option-mapper 注入——故 e2e 必须用真实 custom-mode runner + mock provider，而非 `PI_WEB_STUB_AGENT`。已在 e2e 策略中规避。
- **refresh 模式标题跳动 / 多花 token**：默认 once 规避；refresh 为显式选择项。
