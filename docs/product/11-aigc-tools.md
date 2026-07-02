# 11 · AIGC 图像工具

`@blksails/pi-web-tool-kit` 提供两个内置 AIGC 图像工具：`image_generation`（文生图）与 `image_edit`（图像编辑），由 agent 以 `customTools` 形式挂载，LLM 通过工具参数驱动，产出自动落入附件存储并以签名 URL 回流对话。

---

## 工具一览

| 工具名 | 功能 | 必填参数 | 默认 model |
|---|---|---|---|
| `image_generation` | 文生图（text-to-image） | `prompt` | `gpt-image-2` |
| `image_edit` | 图像编辑（inpaint / 整图改写） | `image`, `prompt` | `gpt-image-2` |

两个工具的注册函数在 `packages/tool-kit/src/aigc/tools/`（`image-generation.ts` 的 `registerImageGeneration(pi)`、`image-edit.ts` 的 `registerImageEdit(pi)`,各以 `pi.registerTool` 注册,工具 `name` 分别为 `image_generation` / `image_edit`),聚合为进程内 `ExtensionFactory`:`packages/tool-kit/src/aigc/extension.ts` 的 `aigcExtension`。

---

## 接入方式

> 跟着做最快的路径：仓库自带 `examples/aigc-agent/`（仅一个 `index.ts`，靠 monorepo workspace 解析依赖），可直接 `pi-web ./examples/aigc-agent --open` 跑起来（见文末「完整示例」一节）。下面三步是从零接入到**自己的** agent 包时的做法。

### 1. 安装依赖

仅当你新建独立 agent 包（不在本 monorepo 内）时需要——在该包 `package.json` 的 `dependencies` 中加入：

```jsonc
{
  "dependencies": {
    "@blksails/pi-web-tool-kit": "workspace:*",
    "@blksails/pi-web-agent-kit": "workspace:*"
  }
}
```

> monorepo 内的 `examples/aigc-agent` 无需此步：它没有 `package.json`，`@blksails/*` 由工作区直接解析。

### 2. 在 agent 中挂载工具

```ts
// examples/aigc-agent/index.ts
import { defineAgent } from "@blksails/pi-web-agent-kit";
import { aigcExtension } from "@blksails/pi-web-tool-kit/runtime";  // 注意：走 /runtime 子入口

export default defineAgent({
  systemPrompt: [
    "You are aigc-agent, a pi-web example exposing AIGC generation tools.",
    "- Use `image_generation` to generate one or more images from a text prompt.",
    "- Use `image_edit` to edit an uploaded image: copy the public id from the",
    "  [attachment id=att_… …] marker verbatim into the tool's `image` parameter.",
    "Each tool persists its output as an attachment and returns a reference; report the",
    "produced attachment id back to the user. Keep replies concise.",
  ].join("\n"),
  extensions: [aigcExtension],   // AIGC 以进程内 ExtensionFactory 装载（pi.registerTool）
  noTools: "builtin",            // 关掉默认内置工具，仅暴露 AIGC 扩展工具
  skills: ({ diagnostics }) => ({ skills: [], diagnostics }),
});
```

> **重要**：`aigcExtension` 必须从 `@blksails/pi-web-tool-kit/runtime` 子入口导入，该入口含 pi SDK 值导入，仅在 runner（jiti）子进程加载，**不得**进 Next.js webpack 前端 bundle。主入口 `@blksails/pi-web-tool-kit` 只导出前端安全的内置命令声明（`BUILTIN_COMMANDS`），不顶层 import pi SDK / undici。
>
> **形态说明（detoolspec-unify-builtin-tools）**：AIGC 工具已统一为普通 pi extension 形态——`aigcExtension` 是进程内 `ExtensionFactory`，内部用 `pi.registerTool` 注册 `image_generation` / `image_edit`，与 `extension-manager` / `auto-title` 一致。旧的声明式 `ToolSpec` + `compileTool` + `buildAigcTools`（`customTools` 装配）已移除;运行时编排由 `runImageTool` 承担（同样从 `/runtime` 导出，供自定义图像工具复用）。

### 3. 配置环境变量

工具启动时检查 `requiredVars`；缺失变量时返回 `ok:false` 降级，不崩溃子进程。

| 变量名 | 用途 | 必填条件 |
|---|---|---|
| `NEWAPI_API_KEY` | NewAPI 网关（默认 `gpt-image-2` 路由） | 使用 gpt-image-2 时必填 |
| `SUFY_API_KEY` | sufy（七牛云）网关（`gpt-image-2-sufy` 路由） | 使用 gpt-image-2-sufy 时必填 |
| `DASHSCOPE_API_KEY` | 官方 DashScope 路由与 token plan 路由**共用同一个变量名**读取密钥 | 使用 DashScope / token plan 模型时必填 |
| `DASHSCOPE_TOKENPLAN_BASE_URL` | token plan 端点 base（可选，缺省 `https://token-plan.cn-beijing.maas.aliyuncs.com/api/v1`） | 覆盖 token plan 域时配置 |

> **注意**：官方 `dashscope.aliyuncs.com` 路由（`wan2.7-image-pro` / `qwen-image-edit-max`）与 token plan 路由（`*-bailian`）都从同一个 `DASHSCOPE_API_KEY` 读取密钥，但两套密钥**不通用**——token plan key 打官方端点返回 401，反之亦然。同一进程内 `DASHSCOPE_API_KEY` 只能配一个值，故二选一：要么走官方路由用官方 key，要么走 `*-bailian` 路由用 token plan key。遇到 401 或"渠道不存在"先按此排查，详细对策见 [18 · 故障排查 FAQ §2.1](18-troubleshooting-faq.md#21-自定义-provider-鉴权-401)。

```bash
# .env.local 示例
NEWAPI_API_KEY=sk-xxxxxxxx
SUFY_API_KEY=sk-xxxxxxxx
DASHSCOPE_API_KEY=sk-xxxxxxxx
# token plan 端点（默认已内置，通常无需配置）
# DASHSCOPE_TOKENPLAN_BASE_URL=https://token-plan.cn-beijing.maas.aliyuncs.com/api/v1
```

---

## 工具参数详解

### image_generation

```jsonc
{
  "prompt": "极光下的雪山，胶片质感",   // 必填；不要翻译为英文
  "n": 1,                                // 图片数量 1–10，部分 model 仅支持 1
  "size": "1024x1024",                   // 或 1536x1024 / 1024x1536 / auto
  "negative_prompt": "模糊, 水印",       // DashScope/OpenRouter 有效
  "background": "transparent",           // gpt-image 专属
  "quality": "high",                     // OpenAI 专属
  "moderation": "low",                   // gpt-image 专属
  "model": "gpt-image-2"                 // 省略则用 defaultModel
}
```

### image_edit

```jsonc
{
  "image": "att_abc123",    // 附件 id（att_前缀）或 https URL；必填
  "prompt": "把背景换成夕阳下的海滩",  // 编辑指令；必填
  "mask": "att_def456",     // 可选 B/W 遮罩：白色区域重绘
  "reference_images": ["att_xyz"],  // 可选参考图；主图+mask+参考图总数 ≤ 3（dashscope.ts:155 IMAGE_EDIT_MAX_IMAGES，超限抛错）
  "n": 1,
  "size": "1024x1024",
  "model": "gpt-image-2"
}
```

`att_` 前缀 id 由编译器在调用前自动解析为 data URI（经附件存储权限校验），LLM 只需原样传入对话中显示的附件引用。

---

## 可用 model 路由

### image_generation 可用模型

| model id | 标签 | provider | 端点 | 价格参考 |
|---|---|---|---|---|
| `gpt-image-2`（默认） | GPT Image 2 · NewAPI | NewAPI 网关 | `POST /v1/images/generations` | $0.04/张 |
| `gpt-image-2-sufy` | GPT Image 2 · sufy | sufy（七牛云）网关 | `POST https://openai.sufy.com/v1/images/generations`（providerModel `openai/gpt-image-2`） | $0.04/张 |
| `wan2.7-image-pro` | Wan 2.7 Image Pro | DashScope 官方 | `POST /api/v1/services/aigc/multimodal-generation/generation`（同步） | ¥0.5/张 |
| `wan2.7-image-pro-bailian` | Wan 2.7 Image Pro · token plan | 阿里云百炼 token plan | 同 DashScope 路径，base 切换到 token plan 域 | ¥0.2/张 |

### image_edit 可用模型

| model id | 标签 | provider | 特性 |
|---|---|---|---|
| `gpt-image-2`（默认） | GPT Image 2 · NewAPI | NewAPI 网关 | 整图改写；multipart FormData |
| `gpt-image-2-sufy` | GPT Image 2 · sufy | sufy（七牛云）网关 | 整图改写；multipart FormData；providerModel `openai/gpt-image-2` |
| `qwen-image-edit-max` | Qwen Image Edit Max · sync | DashScope 官方 | 最高保真；支持 mask 局部重绘 |
| `wan2.7-image-edit-bailian` | Wan 2.7 Image Edit · token plan | 阿里云百炼 token plan | DashScope 原生 messages/content；支持带图编辑 |

---

## 交互式参数补全（aigc-tools-interactive-params）

`model`、`size`、`prompt` 三个参数对成图质量至关重要，但不在 `inputSchema.required` 中声明——若 LLM 漏传，不会被参数校验拦截，而是由工具执行层经扩展上下文的 `ext.ui`（`ExtensionContext.ui`，区别于负责附件落库的 attachment `ctx`）弹窗让用户补全。

**补全逻辑**（声明在 `ToolSpec.requiredParams`，见 `image-generation.ts:92` / `image-edit.ts:98`；实现在 `packages/tool-kit/src/engine/compile-tool.ts:288` 的 `resolveRequiredParams`，由 `runExecute` 在路由与 provider 调用之前调用于 `compile-tool.ts:342`）：

1. 已有非空值（`cur !== undefined && cur !== null && cur !== ""`）→ 直接跳过，不弹窗（正常流不受干扰）
2. 有交互 UI（`ext?.hasUI === true && ext.ui != null`）：
   - `via: "select"` → 调用 `ext.ui.select(title, options)` 弹选择器
   - `via: "input"` → 调用 `ext.ui.input(title, placeholder)` 弹文本框
   - 用户取消（返回 `undefined` 或空字符串）→ 返回 `ok:false`，不发起 provider 调用
3. 无交互 UI 时：
   - 有 `fallback` 声明 → 使用 fallback 值继续
   - `param === "model"` → 回退到 `defaultModel`
   - `prompt` 无兜底 → 返回 `ok:false`

`options` 中的哨兵值 `"$models"` 在运行时由 `expandOptions`（`compile-tool.ts:275`）自动展开为该工具 `models[]` 的所有 `model` 路由键。

---

## 图像规范化：iPhone 多图 JPEG 问题

**问题**：iPhone 拍摄的 JPEG 内含 `APP2/MPF`（Multi-Picture Format）索引 + 主图 `EOI` 后追加的 HDR gain map，发往 NewAPI 网关会触发误导性错误："可用渠道不存在 / This token has no access to model（model 名为空）"。

**解决方案**：纯 JS 无损规范化，实现于 `packages/tool-kit/src/engine/normalize-image.ts`，导出 `normalizeImageDataUri(input: string): string`。

**处理策略**：
- 仅处理 `data:image/jpeg` 格式（其他格式原样返回）
- 定位并跳过 `APP2/MPF` 段（以 `4d 50 46 00` 魔数识别，区别于需保留的 ICC_PROFILE APP2）
- 在主图首个 `EOI`（`FF D9`）处截断，丢弃追加的 gain map
- 零重编码、零缩放，保留 EXIF 方向等其他元数据
- 解析失败或无 MPF 内容时原样返回，不阻断工具调用

编译器 `resolveMediaFields`（`compile-tool.ts:217`）遍历 `inputSchema.properties`，对所有 `mediaKind: "image"` 字段（含数组型如 `reference_images`）经 `resolveAndNormalizeImage`（`compile-tool.ts:256`）解析：`att_` 前缀 → `resolveInputToDataUri` 转 data URI → 再喂入 `normalizeImageDataUri`；非 `att_`/非 `data:` 的 https URL 原样透传。整条链在 `buildBody` 之前完成，工具作者无需手动处理。

> 仍遇到"空 model 名 / 渠道不存在"且确认是 iPhone 多图照片？见 [18 · 故障排查 FAQ §2.2](18-troubleshooting-faq.md#22-iphone-多图-jpeg-上传致网关报错空-model-名或渠道不存在)，含 ImageMagick 手动取主图的临时绕过命令。

---

## Provider 端点差异速查

使用不同 provider 时需注意以下端点与参数形态差异：

### NewAPI（gpt-image-2，默认）

- 文生图端点：`POST https://www.apiservices.top/v1/images/generations`
- 图像编辑端点：`POST https://www.apiservices.top/v1/images/edits`（multipart FormData）
- 请求体：OpenAI 兼容格式（`{ model, prompt, n, size, ... }`）
- 密钥：`Authorization: Bearer ${NEWAPI_API_KEY}`

### sufy（七牛云，gpt-image-2-sufy）

- 文生图端点：`POST https://openai.sufy.com/v1/images/generations`
- 图像编辑端点：`POST https://openai.sufy.com/v1/images/edits`（multipart FormData）
- base host 为 `openai.sufy.com`（与 `api.qnaigc.com` 同源的七牛 AIGC 网关）；**注意不是** `api.sufy.com`（该域名不存在，NXDOMAIN）
- 请求体：与 NewAPI 完全同构（OpenAI 兼容），复用通用工厂 `createOpenAiCompatImage` / `createOpenAiCompatImageEdit`（`providers/openai-compat.ts`）；edits 端点经 curl 实测接受 `image[]` 多图字段
- **`response_format` 差异**：sufy **拒绝** `response_format` 参数（`[BadRequestError] Unknown parameter: 'response_format'` → 400），故 sufy config 设 `omitResponseFormat: true`，文生图不发该字段；gpt-image 系列**默认已返回 b64_json**（curl 实测 200 仍拿到 b64_json），`persistPicked` 的 b64 内联优化不受损。NewAPI 保持显式发送（向后兼容）
- **model 名差异**：sufy 上 gpt-image-2 的真实 id **必须带 `openai/` 前缀**（`openai/gpt-image-2`），不带前缀返回 `502 upstream_error`；故路由声明用 `providerModel: "openai/gpt-image-2"`（LLM 可见路由键仍为 `gpt-image-2-sufy`）。该 model 未出现在 `/v1/models` 列表中，但 `/v1/images/generations` 可直接调用
- 密钥：`Authorization: Bearer ${SUFY_API_KEY}`

> **同构说明**：NewAPI 与 sufy 都是 OpenAI `/images` 协议兼容网关，二者的 `buildBody`/`pickResult`/`detectError` 完全一致，统一抽到 `providers/openai-compat.ts` 的通用工厂；`newapi.ts` / `sufy.ts` 只是绑定各自 `baseUrl` + `apiKeyVar` 的薄封装。再接入同类网关只需照 `sufy.ts` 复制一份薄封装即可。

### DashScope 官方（wan2.7-image-pro / qwen-image-edit-max）

- 端点：`POST https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation`
- 请求体：DashScope **原生** `input/parameters` 格式（非 OpenAI `/images` 格式）
  ```json
  {
    "model": "wan2.7-image-pro",
    "input": { "messages": [{ "role": "user", "content": [{ "text": "..." }] }] },
    "parameters": { "size": "1024*1024", "n": 1 }
  }
  ```
- `size` 格式：`width*height`（星号分隔，如 `1024*1024`），而非 OpenAI 的 `1024x1024`；实现中自动转换
- 密钥：`Authorization: Bearer ${DASHSCOPE_API_KEY}`
- **注意**：`DASHSCOPE_API_KEY`（token plan key）对官方 `dashscope.aliyuncs.com` 端点无效（返回 401），两套 key 不通用

### 阿里云百炼 token plan（wan2.7-image-pro-bailian / wan2.7-image-edit-bailian）

- 端点：`https://token-plan.cn-beijing.maas.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation`。URL 在工具声明里以占位常量 `${DASHSCOPE_TOKENPLAN_BASE_URL:-https://token-plan.cn-beijing.maas.aliyuncs.com/api/v1}/services/aigc/multimodal-generation/generation` 写死（`image-generation.ts:28` / `image-edit.ts:25`），`${VAR:-default}` 缺省语法由 `var-resolver.ts:20` 在 `runEndpoint` 时展开——设了 `DASHSCOPE_TOKENPLAN_BASE_URL` 即覆盖 base，否则回落到 token plan 默认域
- 请求体格式与 DashScope 原生相同（复用 `createDashscopeSyncT2I` / `createDashscopeImageEdit` 工厂，仅经 `extras.url` 覆盖 base URL）
- **坑**：不要使用 `compatible-mode/aigc` 路径，会报 URL error；正确路径为 `maas/**api/v1/services/aigc/multimodal-generation**`
- token plan 路由用 `*-bailian` 后缀的 model id 区分（`wan2.7-image-pro-bailian` 走 image_generation、`wan2.7-image-edit-bailian` 走 image_edit），二者底层 `providerModel` 同为 `DASHSCOPE_MODELS.wan27ImagePro`——token plan 实际仅开通 Wan 2.7 Image Pro 一个模型（文生图 + 带图编辑统一），文生图/编辑只是拆成两个独立路由键。`*-bailian` 才是 token plan 专用路由；不带后缀的 `wan2.7-image-pro` / `qwen-image-edit-max` 为 DashScope 官方路由

---

## 声明式引擎结构

工具采用两层声明式设计，便于低成本扩展新工具或新 provider：

```
ToolSpec（tools/image-generation.ts）
  ├── inputSchema          — LLM 可见参数 schema（不含 model）
  ├── defaultModel         — 省略 model 时的回退
  ├── requiredParams[]     — 业务必选项交互补全声明
  └── models[]             — ModelRoute 路由表
        ├── model          — LLM 可见路由键（同时是枚举值）
        ├── url            — 端点 URL（支持 ${VAR} 占位）
        ├── headers        — 请求头（支持 ${VAR} 占位，运行时展开）
        ├── buildBody      — 请求体构造函数
        ├── pickResult     — 响应解析函数
        ├── detectError    — 业务错误检测函数
        ├── async?         — 异步轮询声明（省略为同步）
        └── requiredVars[] — 所需环境变量（缺失则降级）
```

`compileTool`（`packages/tool-kit/src/engine/compile-tool.ts`）在运行时将 `ToolSpec` 编译为 pi `ToolDefinition`，自动注入 `model` 枚举参数。

---

## 执行流程

一次成功的图像生成调用经历以下步骤：

1. LLM 调用工具，传入 `prompt`（及可选参数）；`model` 被剥出作路由键，不进 `buildBody`
2. `resolveRequiredParams` 检查 `requiredParams`，对缺失项触发交互补全（用户取消 → `ok:false`）
3. `selectModelRoute` 按 `model` 参数（或 `defaultModel`，再兜底 `models[0]`）路由到对应 `ModelRoute`
4. `checkRequiredVars` 检查 `requiredVars` 是否可解析；缺失则返回 `ok:false` 降级（不崩溃）
5. 检查 attachment ctx 是否注入（`ctx.available`，runner 装配）；未注入则 `ok:false` 降级
6. `resolveMediaFields` 对 `mediaKind: "image"` 字段：`att_id → data URI → normalizeImageDataUri`
7. 调用 `runEndpoint`：构造请求体 → HTTP POST → 解析响应（同步 / 异步轮询）
8. `persistPicked`：将图像产物写入附件存储，获得 `att_<id>` 引用；**零产物**（provider 返回 raw/空 url）→ 报 `ok:false` 失败而非误导性成功（`compile-tool.ts:394`）
9. 组装工具结果：文本说明 + `![name](signedDisplayUrl)` markdown（displayUrl 随 content 走，前端 renderer 据此渲染 `<img>`）+ `details.assets`

---

## 完整示例：aigc-agent

`examples/aigc-agent/index.ts` 提供完整可运行示例，演示从 `extensions: [aigcExtension]` 装载到生成全链路。

**启动方式**：

```bash
# 配置密钥
export NEWAPI_API_KEY=sk-xxxxxxxx

# 以 aigc-agent 为 agent 源启动 pi-web（source 是位置参数，不是 --agent 标志）
pi-web ./examples/aigc-agent --open

# 改 examples/aigc-agent/index.ts 后自动重载会话
pi-web ./examples/aigc-agent --watch
```

**对话示例**：

```
用户：帮我生成一张极光下的雪山，胶片质感
助手：[调用 image_generation { prompt: "极光下的雪山，胶片质感", model: "gpt-image-2", size: "1024x1024" }]
      生成成功：1 张图像已保存 (att_abc123)。
      ![image_generation_0](https://pi-web.local/api/attachments/att_abc123/display?sig=...)

用户：[上传图片，对话中显示 [attachment id=att_def456 ...]]
用户：把这张图的背景换成夕阳下的海滩
助手：[调用 image_edit { image: "att_def456", prompt: "把背景换成夕阳下的海滩" }]
      生成成功：1 张图像已保存 (att_ghi789)。
```

---

## 扩展：添加新 provider

在 `packages/tool-kit/src/aigc/tools/image-generation.ts` 的 `models` 数组追加新路由项即可，不影响其他工具执行路径：

```ts
import { createNewApiImage } from "../providers/newapi.js";

// 在 imageGeneration.models 中追加：
createNewApiImage(
  {
    model: "my-custom-model",
    label: "My Model · NewAPI",
    description: "Custom model via NewAPI. Needs NEWAPI_API_KEY.",
  },
  { pricing: { amount: 0.05, currency: "USD", unit: "image" } },
),
```

**新增 OpenAI `/images` 兼容网关（最常见）**：无需写任何 buildBody/pickResult——照 `providers/sufy.ts` 复制一份薄封装，只改 `baseUrl` + `apiKeyVar` 两个常量，即复用 `providers/openai-compat.ts` 的通用工厂 `createOpenAiCompatImage` / `createOpenAiCompatImageEdit`；若网关 model 名与路由键不同（如 sufy 的 `openai/gpt-image-2`）用 `providerModel` 区分。env 变量（如 `SUFY_API_KEY`）会随 `runner.ts` 的 `env: process.env` 整体继承自动流入 runner 子进程，**无需白名单注入**。

如需**异构** provider 类型（非 OpenAI 形态，如 DashScope 原生 input/parameters），参考 `providers/dashscope.ts` 实现工厂函数，返回 `ImageRoute`。

---

## 下一步 / 相关

- [08 · 附件系统](08-attachment-system.md) — 工具产物落库与 `att_<id>` 引用机制
- [09 · 扩展与 Skills](09-extensions-and-skills.md) — 如何在 agent 中装配工具与扩展
- [05 · 配置](05-configuration.md) — 环境变量配置说明
- [06 · Providers 与 Models](06-providers-and-models.md) — NewAPI / DashScope provider 接入
- [07 · Agent 开发](07-agent-development.md) — `defineAgent` 与 `customTools` 用法
- [18 · 故障排查 FAQ](18-troubleshooting-faq.md#2-provider--模型问题) — 401／"渠道不存在"（[§2.1](18-troubleshooting-faq.md#21-自定义-provider-鉴权-401)）、iPhone 多图 JPEG 报错（[§2.2](18-troubleshooting-faq.md#22-iphone-多图-jpeg-上传致网关报错空-model-名或渠道不存在)）
