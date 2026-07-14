# 视觉识别工具（image_vision）· 调研与设计稿

> 状态：pre-spec 调研稿，未立 kiro spec。
> 日期：2026-07-09。
> 结论先行：**接缝已全部存在。不改 protocol、不加 provider、不做 /settings 表单。**

---

## 1. 定位纠正：主模型已经能看图

调研的第一个发现推翻了这个特性的朴素定位。

用户在聊天框上传的图片，**当前已经作为真正的多模态 image part（裸 base64）传给主 LLM**：

```
attachments.toImageContents()      packages/react/src/hooks/use-attachments.ts:276
  → body.images                    packages/ui/src/chat/pi-chat.tsx:820
  → PromptRequest.images           packages/protocol/src/transport/rest-dto.ts
  → session.prompt(msg,{images})   packages/server/src/http/routes/command-routes.ts:123
  → RPC 帧 {type:"prompt", message, images}   packages/server/src/rpc-channel/pi-rpc-process.ts:593
  → pi SDK 物化为 LLM 多模态消息
```

pi RPC 的 `prompt` 入参里 `message` 是 **string**，`images` 是**平级的独立字段**
（`pi-coding-agent/dist/modes/rpc/rpc-types.d.ts:16-19`）。

与之并存的是 `attachmentIds` → `[attachment id=att_… type=… name=…]` **纯文本标记**
（`attachment-bridge/reference-injection.ts:29-58`，注释明确「绝不内联字节」）。

**两条链并存、互不替代。** 所以「让模型能看图」不是本工具的价值。真实缺口有四个：

| 缺口 | 说明 |
| --- | --- |
| **回看** | 落库的附件、AIGC 生成图、Canvas 图、工具产出图，模型只看得到 `att_xxx` 文本标记，看不到像素。要复看只能让用户重新上传。 |
| **纯文本主模型** | 主模型若是纯文本 coding 模型（如已配的 `gpt-5.2-codex`、全部 dashscope 模型），vision 链路整条失效。 |
| **省 context** | 图 token 昂贵。一张图进主上下文后**永久占据历史**；委派 VLM 只回一段文字结论。 |
| **专用能力** | OCR、结构化抽取、目标检测坐标框，可定制 prompt / 强制 JSON 输出。 |

---

## 2. 「用不同模型看图」——清单来源已经现成

pi 的模型体系自带 vision 能力标记：

```ts
// @earendil-works/pi-ai/dist/types.d.ts §Model
input: ("text" | "image")[];
```

而 `ModelRegistry` 可枚举（`pi-coding-agent/dist/core/model-registry.d.ts`）：

```ts
getAll(): Model<Api>[];        // :52
getAvailable(): Model<Api>[];  // :57  —— 仅含已解析出 apiKey 的
find(provider, modelId): Model<Api> | undefined;  // :61
```

于是 vision 模型清单就是一行，**不需要新建任何 catalog**：

```ts
const visionModels = ctx.modelRegistry
  .getAvailable()
  .filter((m) => m.input.includes("image"));
```

`ExtensionContext` 确实带 `modelRegistry` 与 `model`
（`pi-coding-agent/dist/core/extensions/types.d.ts` §ExtensionContext），
而工具 `execute` 的第 5 参正是它（见 `aigc/tools/image-edit.ts:190`）。

### 当前环境命中情况（`~/.pi/agent/models.json` 实测）

| provider | model | input | 可看图 |
| --- | --- | --- | --- |
| apiservices (NewAPI) | `gpt-5.4` | `text, image` | ✅ **目标模型** |
| apiservices | `gpt-5.4-mini` | `text, image` | ✅ |
| apiservices | `gpt-5.2-codex` | `text` | ❌ |
| dashscope | qwen / deepseek / glm / kimi / MiniMax（14 个） | `text` | ❌ |

> **命名歧义留档**：`gpt-5.4`（models.json，vision 理解）与 `gpt-5.4-image-2`
> （`aigc/model-catalog.ts:32`，OpenRouter **图像生成**模型）是两个不同的东西。
> 本工具的目标是前者。后者若将来也想用来看图，只需把它作为 openrouter provider
> 加进 `models.json` 并标 `input: ["text","image"]` —— 无需改本工具一行代码。

**扩展方式即配置**：任何模型只要配进 `models.json` 且 `input` 含 `"image"`，
就自动出现在可选清单里。零代码增量。

---

## 3. 两条执行路径（互补）

### 路径 A · inline「回看」——零外部调用

工具把 `att_id` 解析成 `ImageContent` 塞进 tool result 的 `content`，让**主模型自己看**。

base64 剥离闸门**已经预留了豁免标记**：

```ts
// packages/server/src/attachment-bridge/base64-gate.ts:74
export const KEEP_INLINE_FLAG = "keepInlineImages";
// :127-128 —— details[KEEP_INLINE_FLAG] === true → 保留内联图像，原样透传
```

默认工具结果里的 `ImageContent` 会被剥离成文本引用；打上 `details.keepInlineImages = true`，
图像 base64 就作为「需复看」具名出口物化，直达主模型。

取图复用现成路径：`ctx.resolve(att_id)` → `handle.bytes()`
（`packages/tool-kit/src/attachment/persist.ts:136-145`）。

适用：主模型多模态（如 `gpt-5.4` 本身就是主模型时）。**代价**：烧主模型 context。

### 路径 B · delegate「委派」——调指定 VLM

```ts
// 先例：packages/tool-kit/src/auto-title/auto-title-extension.ts:19,135
import { completeSimple } from "@earendil-works/pi-ai/compat";
completeSimple(model, { messages: [{ role: "user", content: [
  { type: "text", text: question },
  { type: "image", data: base64, mimeType },   // data 为裸 base64，无 data: 前缀
]}]});
```

多模态入参在 SDK 层是真实的（`pi-ai/dist/types.d.ts:236,271`）。

适用：主模型纯文本；或想省 context / 用便宜模型做 OCR。

---

## 4. 模型选择：调用时弹 UI 让用户选（已定）

复用 AIGC 的必选项交互补全形态（`run-image-tool.ts:156-194`）：

```ts
if (ctx.hasUI && ctx.ui != null) {
  const picked = await ctx.ui.select("用哪个模型看这张图？", visionModels.map(fmt));
}
```

`ctx.ui.select` 在 RPC 模式下走 `extension_ui_request` 帧，前端**已支持**（AIGC 在用）。
→ **前端零改动，且 `/settings` 的模型下拉 widget + 数据端点 + 自定义 renderer 整块不需要了。**
这是相较初版方案最大的一处简化。

### 必须的降级路径（无 UI / 自动化场景）

`ctx.hasUI === false`（headless、cron、自动化 agent 循环）时不能阻塞，按序回退：

1. LLM 显式传入的 `model` 参数（若提供）
2. `vision.json` 里的 `defaultModel`
3. `visionModels[0]`
4. 一个都没有 → `{ ok: false, reason: "no_vision_model" }`，**fail-soft 不抛**
   （与 `run-image-tool` 的失败约定一致）

> 开放问题：同一轮对话里连续看多张图会连弹多次 select。建议 M2 加
> `rememberChoice`（本会话内记住），落在会话共享状态而非配置文件。

---

## 5. 重要裁定：不复用 AIGC 的 provider 层

现有 AIGC 调用层是自建的：provider 工厂 + `${VAR}` 占位 env + `fetch`
（`engine/endpoint-adapter.ts`、`engine/var-resolver.ts`、`providers/dashscope.ts`），
为**图像生成 API**（dashscope 原生 `input/parameters` 格式）设计。

VLM 走 chat/completions，与 pi 的 `modelRegistry` 天然吻合。因此：

> **走 pi 的模型体系（`modelRegistry` + `completeSimple`），不新增 provider 代码、
> 不新增 API key、不新增 env 占位。**

`gpt-5.4` 已在 `models.json` 配好（`api: openai-completions`，apiservices 网关），
`completeSimple` 直接可用。

---

## 6. 落点与改动面

| 层 | 改动 |
| --- | --- |
| `tool-kit/src/vision/` | 新目录：`extension.ts`（`visionExtension`，同时 `registerTool` + `registerCommand`）、`tools/image-vision.ts`、`run-vision-tool.ts`、`select-model.ts` |
| 装配 | `AgentDefinition.extensions` 透传 / `forcedExtensionPaths` 注入，与 `aigcExtension` 同形（`aigc/extension.ts:75`） |
| protocol SSE 帧 | **零改动** |
| 前端 | **零改动**（`ctx.ui.select` 走已有的 `extension_ui_request`） |
| config 域 `vision` | **M2 再做**。M1 靠 `ui.select` + env，不必立刻改 protocol/server 三处 |

### 6.1 工具签名（LLM 可见）

```ts
image_vision({
  image?: string,     // att_id | URL；缺省 → ctx.listBySession() 取最近一张
  question: string,   // 要问图什么
  model?: string,     // 可选；缺省则弹 ui.select
})
```

`listBySession()`（`server/src/attachment-bridge/tool-context.ts:126`）原为 Canvas hydrate 而建，此处直接复用。

### 6.2 命令入口 `/img_vision`（用户可见）

pi 原生支持扩展命令（`pi-coding-agent/dist/core/extensions/types.d.ts:857`）：

```ts
registerCommand(name: string, options: Omit<RegisteredCommand, "name" | "sourceInfo">): void;
```

`ExtensionCommandContext extends ExtensionContext`，因此命令 handler 里同样拿得到
`modelRegistry` / `ui` / `model`，可与工具 `execute` 共用同一个 `runVisionTool()` 内核：

```
pi.registerTool({ name: "image_vision", … })   ← LLM 调
pi.registerCommand("img_vision", { … })        ← 用户敲 /img_vision
        ↘ 共用 runVisionTool(params, ctx, signal) ↙
```

> ⚠ **web 端已知坑（已有修复，勿重踩）**：pi 扩展命令本地执行**不发 `agent_end`**，
> 若经 `useChat` 常规路径发送会永久卡在 busy。修复已落地——`PiChat` 的 `onSubmit`
> 识别 `source === "extension"` → 走 `client.prompt` fire-and-forget，反馈靠 `ctx.ui`。
> 这意味着 `/img_vision` 的结果**必须经 `ctx.ui` 呈现**，不能指望它作为助手消息流回。

命令与工具的分工：命令面向「用户主动想看某张图」，工具面向「LLM 自己决定要看图」。
两者都汇入同一内核，模型选择、降级链、fail-soft 行为完全一致。

---

## 7. 坑清单（会咬人的）

1. **runtime 子入口约定**：`completeSimple` 是 pi SDK 的**值导入**，含它的模块只能经
   `@blksails/pi-web-tool-kit/runtime` 加载，否则进前端 bundle 就炸（见 `aigc/extension.ts:6-8`）。
2. **`ImageContent.data` 是裸 base64**，不带 `data:` 前缀。现成的 `resolveInputToDataUri`
   返回的是 **data URI**，需剥前缀（`base64FromDataUrl` 已有此逻辑，`use-attachments.ts:126`）。
3. **inline 模式忘打 `keepInlineImages` → 图被静默剥离**，表现为「模型说它看不到图」。
4. **`ctx.hasUI === false` 时 `ui.select` 会挂** —— 必须走 §4 的降级链。
5. **`completeSimple` 的 `Model<never>` 泛型**需 cast，auto-title 有先例（`:116,124,127`）。
6. **新增 tool-kit 子入口须同步 root `tsconfig.json` paths**，否则 handler 集成测试全崩。
7. **`getAvailable()` vs `getAll()`**：前者只含已解析出 apiKey 的模型。用 `getAvailable()`，
   否则会把用户选不了的模型列进弹层。
8. **改配置域 / 注入路由后必须重启 dev** —— handler 是 `globalThis` 单例，热重载不刷新。
   （M1 不碰配置域则不受影响。）

---

## 8. 建议里程碑

- **M1**：`image_vision` 工具 + `/img_vision` 命令 + delegate 路径 + `ui.select` 选模型 + 降级链 + 单测。
  完成后即可端到端跑通「AIGC 用 `gpt-5.4-image-2` 生成一张图 →
  让 agent 用 `gpt-5.4` 描述它画了什么」——这个闭环**当前做不到**。
- **M2**：inline 路径 + `vision` config 域（strategy / defaultModel / rememberChoice）+ 会话内记住选择。
- **M3**：结构化输出（JSON schema 约束）、OCR / 目标检测预设 prompt。

---

## 附：关键文件索引

- 附件 seam：`tool-kit/src/attachment/seam.ts:15`；注入点 `server/src/runner/attachment-wiring.ts:151`
- 附件契约：`agent-kit/src/attachment.ts:86-111`；实现 `server/src/attachment-bridge/tool-context.ts:100-145`
- 取图：`tool-kit/src/attachment/persist.ts:136-145`
- base64 闸门：`server/src/attachment-bridge/base64-gate.ts:74,127`
- LLM 子调用先例：`tool-kit/src/auto-title/auto-title-extension.ts:19,113-128,135`
- 交互补全先例：`tool-kit/src/aigc/run-image-tool.ts:156-194`
- 工具注册形态：`tool-kit/src/aigc/tools/image-edit.ts:186-213`
- pi SDK 真实类型：
  - `@earendil-works/pi-ai/dist/types.d.ts:236`（ImageContent）、`:271`（UserMessage.content）、§Model（`input`）
  - `@earendil-works/pi-coding-agent/dist/core/model-registry.d.ts:52,57,61`
  - `.../dist/core/extensions/types.d.ts` §ExtensionContext
  - `.../dist/modes/rpc/rpc-types.d.ts:16-19`（prompt 帧）
