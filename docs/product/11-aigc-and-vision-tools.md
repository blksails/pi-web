# 11 · AIGC 与视觉工具

`@blksails/pi-web-tool-kit` 提供两条同源能力线：**AIGC 图像工具**（`image_generation` 文生图、`image_edit` 图像编辑）负责「画出来」，**视觉识别工具**（`image_vision` 工具、`/img_vision` 命令）负责「看得懂」。四者都是进程内 pi extension——经 `pi.registerTool` / `pi.registerCommand` 注册，由 agent 以 `AgentDefinition.extensions: [aigcExtension, visionExtension]` 装载。产物图落入附件存储、以 `att_<id>` 引用回流对话；视觉结论以纯文本回流，可回放、可追问。

> **形态说明（detoolspec-unify-builtin-tools）**：AIGC 工具早期用声明式 `ToolSpec` + `compileTool` + `buildAigcTools`（`customTools` 装配路径）——**这套两层编译架构与 `customTools` 路径均已从 main 移除**。现在两个工具用手写 `Type.Object` parameters + `pi.registerTool` 注册，运行时编排统一走 `runImageTool`。若你在旧文档或旧示例里看到 `customTools` / `buildAigcTools` / `compileTool`，一律以本章为准。

---

## 工具一览

| 名称 | 类型 | 功能 | 必填参数 | 默认 model |
|---|---|---|---|---|
| `image_generation` | 工具 | 文生图（text-to-image） | `prompt` | `gpt-image-2` |
| `image_edit` | 工具 | 图像编辑（inpaint / 整图改写） | `image`, `prompt` | `gpt-image-2` |
| `image_vision` | 工具 | 图像理解（看图回答问题） | `question` | 读 `PI_WEB_VISION_MODEL` |
| `/img_vision` | 命令 | 对会话内「最近一张图」发起识别 | 命令参数即提问 | 同上 |

注册函数与聚合工厂：

- `packages/tool-kit/src/aigc/tools/image-generation.ts:178` 的 `registerImageGeneration(pi)`、`image-edit.ts:186` 的 `registerImageEdit(pi)`，聚合为 `aigcExtension`（`packages/tool-kit/src/aigc/extension.ts:75`）。
- `packages/tool-kit/src/vision/tools/image-vision.ts:69` 的 `registerImageVision(pi, run)`、`command.ts:37` 的 `registerImgVisionCommand(pi, run)`，聚合为 `visionExtension`（`packages/tool-kit/src/vision/extension.ts:71`）。

---

## 接入方式

> 最快路径：仓库自带 `examples/aigc-agent/`（核心是一个 `index.ts`，`@blksails/*` 依赖靠 monorepo workspace 解析），可直接跑起来看到生成 + 回看闭环（见文末「完整示例」）。

```bash
export NEWAPI_API_KEY=sk-xxxxxxxx          # 生成/编辑的默认 gpt-image-2 路由
export PI_WEB_VISION_MODEL=openai/gpt-4o   # image_vision 默认视觉模型（provider/modelId）

# source 是位置参数，不是 --agent 标志；--open 自动开浏览器
pi-web ./examples/aigc-agent --open
```

`examples/aigc-agent/index.ts:28-68` 的核心装配：

```ts
import { defineAgent } from "@blksails/pi-web-agent-kit";
import { aigcSlashCompletions } from "@blksails/pi-web-tool-kit";
// 注意：走 /runtime 子入口——含 pi SDK 值导入，仅在 runner（jiti）子进程加载
import { aigcExtension, visionExtension } from "@blksails/pi-web-tool-kit/runtime";

export default defineAgent({
  systemPrompt: "...",                     // 教 LLM 何时调 image_generation / image_edit / image_vision
  extensions: [aigcExtension, visionExtension],  // 进程内 ExtensionFactory（pi.registerTool）
  slashCompletions: aigcSlashCompletions,  // /img-gen、/img-edit 出现在输入补全（选中只填、不执行）
  noTools: "builtin",                      // 关掉内置工具，仅暴露扩展工具
  skills: ({ diagnostics }) => ({ skills: [], diagnostics }),
});
```

> **子入口纪律**：`aigcExtension` / `visionExtension` 必须从 `@blksails/pi-web-tool-kit/runtime` 导入，该入口含 pi SDK 值导入，仅在 runner 子进程加载，**不得**进前端 bundle。主入口 `@blksails/pi-web-tool-kit` 只导出前端安全的纯数据/类型（`BUILTIN_COMMANDS`、`aigcSlashCompletions`、`AIGC_MODEL_CATALOG` 等）。

新建**独立** agent 包（不在本 monorepo 内）时，需在 `package.json` 加依赖：

```jsonc
{
  "dependencies": {
    "@blksails/pi-web-tool-kit": "workspace:*",
    "@blksails/pi-web-agent-kit": "workspace:*"
  }
}
```

monorepo 内的 `examples/aigc-agent` 无此步——它的 `package.json` 只带 pi-web 展示元数据（`title` / `avatar` / `description`），不声明任何 `@blksails/*` 依赖，由工作区直接解析。

---

## 配置环境变量

图像工具启动时检查各路由声明的 `requiredVars`；缺失变量时该路由返回 `ok:false` 降级，不崩溃子进程。视觉工具默认模型读 `PI_WEB_VISION_MODEL`。

| 变量名 | 用途 | 必填条件 |
|---|---|---|
| `NEWAPI_API_KEY` | NewAPI 网关（默认 `gpt-image-2` 路由） | 用 gpt-image-2 时必填 |
| `SUFY_API_KEY` | sufy（七牛云）网关（`*-sufy` 路由） | 用 `*-sufy` 模型时必填 |
| `OPENROUTER_API_KEY` | OpenRouter 网关（gemini/gpt-5 系图像模型） | 用 OpenRouter 模型时必填 |
| `OPENROUTER_PROXY` | OpenRouter 请求代理（可选，`${VAR}` 占位；未设直连） | 需经代理访问时配置 |
| `DASHSCOPE_API_KEY` | 官方 DashScope 路由与 token plan 路由**共用同一变量名**读密钥 | 用 DashScope / token plan 模型时必填 |
| `DASHSCOPE_TOKENPLAN_BASE_URL` | token plan 端点 base（可选，缺省 `https://token-plan.cn-beijing.maas.aliyuncs.com/api/v1`） | 覆盖 token plan 域时配置 |
| `PI_WEB_VISION_MODEL` | `image_vision` 默认视觉模型，格式 `provider/modelId` | 想设默认视觉模型时配置 |

> **DashScope 双 key 陷阱**：官方 `dashscope.aliyuncs.com` 路由（`wan2.7-image-pro` / `qwen-image-edit-max`）与 token plan 路由（`*-bailian`）都从 `DASHSCOPE_API_KEY` 读密钥，但两套密钥**不通用**——token plan key 打官方端点返回 401，反之亦然。同一进程只能配一个值，故二选一。遇到 401 或「渠道不存在」，见 [23 · 故障排查 FAQ](./23-troubleshooting-faq.md#4-provider--模型问题)。

---

## 工具参数详解

### image_generation

参数手写在 `image-generation.ts:122` 的 `PARAMETER_FIELDS`，`model` 枚举由 `optionalModelEnum(routes, DEFAULT_MODEL)` 动态构造（`buildParameters`，`:159`）。

```jsonc
{
  "prompt": "极光下的雪山，胶片质感",   // 必填；保持用户原语言，不要翻译为英文
  "n": 1,                                // 图片数量 1–10，部分 model 仅支持 1
  "size": "1024x1024",                   // 或 1536x1024 / 1024x1536 / auto
  "negative_prompt": "模糊, 水印",       // DashScope/OpenRouter 有效
  "background": "transparent",           // gpt-image 专属
  "quality": "high",                     // OpenAI 专属
  "moderation": "low",                   // gpt-image 专属
  "model": "gpt-image-2"                 // 省略则用 DEFAULT_MODEL
}
```

### image_edit

```jsonc
{
  "image": "att_abc123",    // 附件 id（att_ 前缀）或 https URL；必填
  "prompt": "把背景换成夕阳下的海滩",  // 编辑指令；必填
  "mask": "att_def456",     // 可选 B/W 遮罩：白色区域重绘
  "reference_images": ["att_xyz"],  // 可选参考图
  "n": 1,
  "size": "1024x1024",
  "model": "gpt-image-2"
}
```

`image` / `mask` / `reference_images` 三个是媒体字段（`IMAGE_EDIT_MEDIA_FIELDS`，`image-edit.ts:102`），调用前由编排器解析为 data URI（经附件权限校验），LLM 只需原样传入对话中显示的 `att_` 引用。DashScope 系模型的「主图 + mask + 参考图」总数 ≤ 3（`providers/dashscope.ts:155` 的 `IMAGE_EDIT_MAX_IMAGES`，超限抛错）。

---

## 可用 model 路由

路由是模块级常量数组 `ROUTES`（`image-generation.ts:44` / `image-edit.ts` 同款），对外导出为 `IMAGE_GENERATION_ROUTES`（`:170`）/ `IMAGE_EDIT_ROUTES`。OpenRouter 系模型集中在 `providers/openrouter-models.ts`，两工具经 `openRouterImageRoutes()` / `openRouterImageEditRoutes()` 复用。

### image_generation 路由

| model id | provider | 端点形态 |
|---|---|---|
| `gpt-image-2`（默认） | NewAPI（`https://www.apiservices.top/v1`） | OpenAI `/images/generations` |
| `gpt-image-2-sufy` | sufy（`https://openai.sufy.com/v1`） | OpenAI `/images/generations`（providerModel `openai/gpt-image-2`） |
| `gemini-3.1-flash-lite-image-sufy` | sufy | OpenAI `/images`（providerModel `google/gemini-3.1-flash-lite-image`，快 & 低成本） |
| `gemini-3.1-flash-image` / `gemini-3-pro-image` / `gemini-2.5-flash-image` | OpenRouter | chat/completions + `modalities:["image","text"]` |
| `gpt-5-image` / `gpt-5-image-mini` / `gpt-5.4-image-2` | OpenRouter | 同上；`gpt-5.4-image-2` 上游 org 配额异常时暂不可用 |
| `wan2.7-image-pro` | DashScope 官方 | `multimodal-generation`（同步 input/parameters） |
| `wan2.7-image-pro-bailian` | 阿里云百炼 token plan | 同 DashScope 路径，base 切到 token plan 域 |

### image_edit 路由

| model id | provider | 特性 |
|---|---|---|
| `gpt-image-2`（默认） / `gpt-image-2-sufy` | NewAPI / sufy | 整图改写；multipart FormData |
| `gemini-3.1-flash-lite-image-sufy` | sufy | 整图改写；providerModel `google/gemini-3.1-flash-lite-image` |
| `gemini-3.1-flash-image` / `gemini-3-pro-image` / `gemini-2.5-flash-image` | OpenRouter | 整图改写（无 mask） |
| `gpt-5-image` / `gpt-5-image-mini` / `gpt-5.4-image-2` | OpenRouter | 整图改写（无 mask） |
| `qwen-image-edit-max` | DashScope 官方 | 最高保真；支持 mask 局部重绘 |
| `wan2.7-image-edit-bailian` | 阿里云百炼 token plan | DashScope 原生 messages/content；支持带图编辑 |

---

## 交互式参数补全

`model`、`size`、`prompt` 对成图质量至关重要，但不在工具 `parameters.required` 中——若 LLM 漏传，不被参数校验拦截，而是运行时经扩展上下文的 `ctx.ui` 弹窗让用户补全。

必选项声明为模块常量 `REQUIRED_PARAMS`（`image-generation.ts:99`、`image-edit.ts:108`，同款结构）；补全逻辑在 `run-image-tool.ts` 的 `resolveRequiredParams`（`:156`），由 `runImageTool` 在路由与 provider 调用之前调用：

1. 已有非空值 → 直接跳过，不弹窗（正常流不受干扰）。
2. 有交互 UI（`ctx.hasUI`）：`via:"select"` 调 `ctx.ui.select(...)`，`via:"input"` 调 `ctx.ui.input(...)`；用户取消 → `ok:false`，不发起 provider 调用。
3. 无交互 UI：有 `fallback` 用 fallback（如 `size` 兜底 `auto`）；`param === "model"` 回退到 `DEFAULT_MODEL`；`prompt` 无兜底 → `ok:false`。

`options` 中的哨兵值 `"$models"` 在运行时由 `expandOptions`（`run-image-tool.ts:141`）展开为当前活跃路由的所有 `model` 路由键（被禁模型已同源移除）。

---

## 图像规范化：iPhone 多图 JPEG 问题

**问题**：iPhone 拍摄的 JPEG 内含 `APP2/MPF`（Multi-Picture Format）索引 + 主图 `EOI` 后追加的 HDR gain map，发往 NewAPI 网关会触发误导性错误：「可用渠道不存在 / This token has no access to model（model 名为空）」。

**解决方案**：纯 JS 无损规范化，实现于 `packages/tool-kit/src/engine/normalize-image.ts`（仍在 `engine/` 下、被复用），导出 `normalizeImageDataUri(input): string`：

- 仅处理 `data:image/jpeg`（其他格式原样返回）；
- 定位并跳过 `APP2/MPF` 段（以 `4d 50 46 00` 魔数识别，区别于需保留的 ICC_PROFILE APP2）；
- 在主图首个 `EOI`（`FF D9`）处截断，丢弃追加的 gain map；
- 零重编码、零缩放，保留 EXIF 方向等元数据；解析失败或无 MPF 时原样返回，不阻断调用。

`runImageTool` 的 `resolveMediaFields`（`run-image-tool.ts:208`）对每个 `mediaFields` 字段（含数组型 `reference_images`）经 `resolveAndNormalizeImage`（`:199`）解析：`att_` 前缀 → 转 data URI → 再喂入 `normalizeImageDataUri`；非 `att_`/非 `data:` 的 https URL 原样透传。整条链在构造请求体之前完成，工具作者无需手动处理。

> 仍遇到「空 model 名 / 渠道不存在」且确认是 iPhone 多图照片？见 [23 · 故障排查 FAQ](./23-troubleshooting-faq.md#4-provider--模型问题)。

---

## 执行流程

一次成功的图像生成/编辑调用（由 `runImageTool` 统一编排）：

1. LLM 调用工具，传入 `prompt`（及可选参数）；`model` 被剥出作路由键。
2. `resolveRequiredParams` 检查必选项，对缺失项触发交互补全（用户取消 → `ok:false`）。
3. `selectRoute`（`run-image-tool.ts:118`）按 `model`（或 `DEFAULT_MODEL`）路由到对应 `ImageRoute`。
4. 检查该路由 `requiredVars` 是否可解析；缺失则 `ok:false` 降级（不崩溃）。
5. 检查 attachment ctx 是否注入（runner 装配）；未注入则 `ok:false`。
6. `resolveMediaFields` 对媒体字段：`att_id → data URI → normalizeImageDataUri`。
7. `runEndpoint`：构造请求体 → HTTP POST → 解析响应（同步 / 异步轮询）→ 乐观预览 `onUpdate`。
8. `persistPicked`：将产物写入附件存储得 `att_<id>`；**零产物**（provider 返回空 url）→ 报失败而非误导性成功（`run-image-tool.ts:437`）。
9. 组装结果：文本说明 + `![name](signedDisplayUrl)` markdown + `details.assets`，前端 renderer 据此渲染 `<img>`。

---

## 视觉识别工具

生成/编辑产物落库后，在 LLM 上下文里只剩 `[attachment id=att_… …]` 文本标记——**读得到 id，读不到像素**。`image_vision` 补上「回看」这一环：把一张会话内已有的图送进支持图像输入的模型，拿回文字结论。

### image_vision 工具（LLM 自主调用）

参数（`vision/tools/image-vision.ts:24`）：

```jsonc
{
  "image": "att_abc123",   // 可选：att_ 引用；省略则看会话内「最近一张图」
  "question": "这张图里有几个人？",  // 必填；保持用户原语言，不要翻译
  "model": "openai/gpt-4o"  // 可选：provider/modelId；省略则弹选择器或降级到默认
}
```

内核 `createVisionRunner`（`vision/run-vision-tool.ts:77`）永不抛出，一律返回判别联合 `VisionResult`（`vision/types.ts:63`），失败结果**绝不携带图像字节**。编排顺序：

1. 附件能力可用性检查（seam 未接线 → `attachment_unavailable`）；
2. 取图（`att_` 解析或取最近一张；找不到 → `no_image` / `attachment_not_found` / `not_an_image`）；
3. 选模型（`ctx.modelRegistry` + `PI_WEB_VISION_MODEL` 默认 + 交互选择器）；
4. **显式解析凭据**：`ctx.modelRegistry.getApiKeyAndHeaders(model)`——目标 provider 的 key 只存在于 `~/.pi/agent/models.json`，`completeSimple` 内部只会回落环境变量，故必须先取凭据再显式传入（`run-vision-tool.ts:116`），照抄 auto-title 会直接 401；
5. 调模型，抽取文本结论；结果 `content` 只放文本、`details` 承载完整 `VisionResult`。

> **模型格式陷阱**：`image_vision` 的 `model` 是 **`provider/modelId`**（如 `openai/gpt-4o`），与 AIGC 生成模型的**裸路由键**（如 `gpt-image-2`）格式不同，不可混用。

### /img_vision 命令（用户主动发起）

`vision/command.ts:37` 注册 `/img_vision`。命令参数（裸 string）整段作为提问，为空时用默认提问「描述这张图片的内容。」；图像固定走「最近一张图」缺省规则，**不接受 `att_` id**（避免用户手抄 nanoid，需指定图请用 `image_vision` 工具）。

命令 handler **无返回值**，结论只经 `ctx.ui.notify` 呈现（成功=info、失败=error、用户取消/中止=info）。前端对 `source === "extension"` 的命令走 **fire-and-forget**：无气泡、不进消息历史、不卡 busy（详见 [10 · 扩展 / Skills](./10-extensions-and-skills.md) 扩展命令执行语义）。

---

## Canvas 提示词栏「解读」按钮

Canvas 工作台的提示词栏内嵌一个「解读」按钮：把**当前工作图 + 问题 + 可选视觉模型**组装成一个 `tool: image_vision` 的 `SurfaceOp`，经 `bridge.submitOp → renderSurfaceOp` 渲染为**用户消息**发进对话流，LLM 据此调用 `image_vision`。结论因此天然回流对话记录——可回放、可追问、进 LLM 上下文。

载荷构造器 `buildVisionOp`（`packages/canvas-ui/src/vision-op.ts:63`）是纯函数：`params` 顺序恒为 `image → question → model?`；`model` 为空时**不产生参数行**，把「是否弹选择层」的决策权完整交回工具（工具收不到 model 即弹层）。同前节陷阱——这里的 `model` 也是 `provider/modelId`，与提示词栏「生成模型」选择器的裸 id 不可混用。

Canvas 建立在 Surface 权威表面栈之上（`domain=canvas` 的 CQRS 单写者通信）：「解读」按钮的对话回流正是走这条通道。架构总述见 [04 · Surface 权威表面栈](./04-surface-stack.md)，工作台交互见 [16 · Canvas 工作台](./16-canvas-workbench.md)。

---

## 只读模型枚举端点

供设置界面与 Canvas 选择器列举模型，**取数失败一律降级 200 + 空清单**，不把 500 透给前端：

| 端点 | 用途 | 实现 |
|---|---|---|
| `GET /api/vision/models` | 列「已配凭证且支持图像输入」的视觉模型 `{value,label,provider}`，供 Canvas「解读」选择器；`value` 是 `provider/modelId`，可原样填进 `image_vision` 的 `model` | `packages/server/src/vision-settings/vision-models-routes.ts:29` |
| `GET /api/aigc/models` | 列 AIGC 图像模型展示目录 `{model,label,provider}`，供 `/settings` 的「模型开关」widget；数据源是主入口纯常量 `AIGC_MODEL_CATALOG` | `packages/server/src/aigc-settings/aigc-models-routes.ts:14` |

两条路由经 `routes:` 注入接缝挂进 `createPiWebHandler`（`lib/app/pi-handler.ts:497,502`），宿主用一条 `app.all("/api/*")` 转发全部 API 面（Next 删除后不再需要 per-段转发器）。端点完整参考见 [24 · HTTP/SSE API 参考](./24-http-api-reference.md)。

前端可复用 `fetchVisionModels`（`vision-op.ts:92`）拉 `GET /vision/models`：任何失败（无 baseUrl / 非 2xx / 解析异常 / 形状不符）都返回空数组，解读功能仍可用。

---

## AIGC 配置域（aigc.json）

用户可控的 AIGC 设置落 `~/.pi/agent/aigc.json`，schema 在 `packages/protocol/src/config/domains/aigc.ts:18`：

| 字段 | 默认 | 说明 |
|---|---|---|
| `disabledModels` | `[]` | 被禁用的图像模型 id 列表，经自定义 widget `aigcModelToggles` 勾选。被禁模型从 LLM 可见枚举 + 下发清单**同源移除**，下次会话/重载生效 |
| `enablePromptOptimization` | `false` | 是否开启工具提示词优化（本期为无改写占位接缝） |

装配期 `aigcExtension` 读取该设置（`resolveAigcToolSettings`），喂给两个工具注册函数使清单同源过滤（`extension.ts:76-79`）。设置界面（schema 驱动 + `aigcModelToggles` widget）见 [13 · 配置 UI](./13-config-ui.md)。

### promptToolbar 快捷设置

装配期 `aigcExtension` 还把「生成∪编辑」模型并集 + label/provider 映射 + 尺寸档位 + 提示词优化开关写入会话共享状态（`aigc.models` 等键，`extension.ts:35-68`），供提示词栏工具排（`promptToolbar` 槽）的 AIGC 快捷设置选择器动态渲染——单一事实源=工具 `ROUTES`，新增 provider 自动出现。`promptToolbar` 是已声明的 web-ext SlotKey，详见 [12 · Web UI 扩展](./12-web-ui-extension.md)。

---

## Provider 端点差异速查

不同 provider 的端点与请求体形态差异（`buildBody`/`pickResult`/`detectError` 各自封装）：

- **NewAPI（`gpt-image-2`，默认）**：`POST https://www.apiservices.top/v1/images/generations` 与 `/images/edits`（multipart）；OpenAI 兼容请求体；`Authorization: Bearer ${NEWAPI_API_KEY}`。
- **sufy（`*-sufy`）**：base `https://openai.sufy.com/v1`（七牛云 AIGC 网关，**不是** `api.sufy.com`——NXDOMAIN）；与 NewAPI 同构，复用 `providers/openai-compat.ts` 的通用工厂；`response_format` 参数被 sufy 拒绝（400），故 sufy config 设 `omitResponseFormat`；真实 model id 须带 `openai/` 前缀（不带返回 502），路由用 `providerModel` 区分。
- **OpenRouter（gemini/gpt-5 系）**：`POST https://openrouter.ai/api/v1/chat/completions`（**不是** OpenAI `/images`）；请求体 `{ model, modalities:["image","text"], messages }`；响应图在 `choices[].message.images[].image_url.url`；`negative_prompt` 有效，`size`/`background`/`quality`/`moderation`/`mask` 静默忽略；可选 `${OPENROUTER_PROXY}`。
- **DashScope 官方（`wan2.7-image-pro` / `qwen-image-edit-max`）**：`POST https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation`；DashScope **原生** `input/parameters` 格式；`size` 用 `width*height`（星号，如 `1024*1024`），运行时自动转换。
- **阿里云百炼 token plan（`*-bailian`）**：同 DashScope 原生格式，base 经 `${DASHSCOPE_TOKENPLAN_BASE_URL:-…}` 占位覆盖；**不要**用 `compatible-mode/aigc` 路径（会报 URL error），正确路径为 `.../services/aigc/multimodal-generation`。

> 再接入同类 OpenAI `/images` 兼容网关最省事：照 `providers/sufy.ts` 复制一份薄封装，只改 `baseUrl` + `apiKeyVar` 两个常量即复用通用工厂；env 变量随 `runner.ts` 的 `env: process.env` 整体继承流入子进程，无需白名单注入。异构 provider（如 DashScope 原生形态）参考 `providers/dashscope.ts` 返回 `ImageRoute`。

---

## 扩展：添加新 provider

在 `image-generation.ts` 的 `ROUTES` 数组（`:44`）追加新路由项即可，不影响其他工具执行路径：

```ts
import { createNewApiImage } from "../providers/newapi.js";

// 在 ROUTES 中追加：
createNewApiImage(
  {
    model: "my-custom-model",
    label: "My Model · NewAPI",
    description: "Custom model via NewAPI. Needs NEWAPI_API_KEY.",
  },
  { pricing: { amount: 0.05, currency: "USD", unit: "image" } },
),
```

新路由的 `model` 会自动进入 `optionalModelEnum` 构造的 LLM 可见枚举，`"$models"` 哨兵展开、装配期清单下发、`GET /aigc/models` 目录均随之更新——单一事实源。

---

## 完整示例：aigc-agent

`examples/aigc-agent/index.ts` 演示从 `extensions:[aigcExtension, visionExtension]` 装载到「生成 → 回看」全链路。

**对话示例**：

```
用户：帮我生成一张极光下的雪山，胶片质感
助手：[调用 image_generation { prompt: "极光下的雪山，胶片质感", size: "1024x1024" }]
      生成成功：1 张图像已保存 (att_abc123)。
      ![image_generation_0](https://.../api/attachments/att_abc123/display?sig=...)

用户：/img_vision 这张图是白天还是夜晚？
助手：[/img_vision 命令 → image_vision 内核对最近一张图识别]
      → ctx.ui.notify：这是一张夜景图，天空可见极光……（不进消息历史，无气泡）
```

**热重载**：改 `examples/aigc-agent/index.ts` 后加 `--watch` 自动重载会话。

---

## 相关链接

- [04 · Surface 权威表面栈](./04-surface-stack.md) — Canvas「解读」按钮回流对话的通信平面
- [06 · 配置参考](./06-configuration.md) — 环境变量与配置目录（含 AIGC provider key、`PI_WEB_VISION_MODEL`）
- [07 · Provider 与模型](./07-providers-and-models.md) — 文本对话模型接入（图像/视觉模型走各自路由表，不经 ModelRegistry）
- [08 · 自定义 Agent 开发](./08-agent-development.md) — `defineAgent` 与 `extensions` 装载
- [09 · 附件系统](./09-attachment-system.md) — 工具产物落库与 `att_<id>` 引用机制
- [10 · 扩展 / Skills](./10-extensions-and-skills.md) — 扩展装载与扩展命令 fire-and-forget 语义
- [12 · Web UI 扩展](./12-web-ui-extension.md) — `promptToolbar` 槽与 AIGC 快捷设置
- [13 · 配置 UI](./13-config-ui.md) — `aigc.json` 的 `aigcModelToggles` widget
- [16 · Canvas 工作台](./16-canvas-workbench.md) — 二创画布编辑器与「解读」按钮的完整交互
- [24 · HTTP/SSE API 参考](./24-http-api-reference.md) — `GET /vision/models`、`GET /aigc/models` 端点
- [23 · 故障排查 FAQ](./23-troubleshooting-faq.md#4-provider--模型问题) — 401／「渠道不存在」、iPhone 多图 JPEG 报错
