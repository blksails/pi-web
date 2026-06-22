# 内置 Web 工具(Tier 1:附件/媒体)设计文档

> 状态:草案(供评审)
> 范围:Tier 1 —— 利用 pi-web 附件存储接缝的内置媒体工具
> 关联:`attachment-store` / `attachment-tool-bridge` 两个 spec;`@pi-web/server` runner 子进程

---

## 1. 背景与动机

### 1.1 现状

pi-web **目前没有"内置工具集"概念**。系统里"工具"有三个来源:

1. **pi SDK 原生内置**:`bash` / `read` / `write` / `edit` / `grep` / `glob` / `fetch` …,由 SDK 自动发现装配,agent 在 `index.ts` 用 `tools: [...]` allowlist 启用。
2. **agent 作者自定义** `customTools: ToolDefinition[]`:作者在自己的 `index.ts` 里声明。
3. **WebExtension 贡献点**(slash / mention / autocomplete):前端输入触发,与"工具"是不同机制,不在本文范围。

pi-web 自己**只做装配与渲染**,不提供任何工具。

### 1.2 第一原则

> 只内置那些**利用 pi-web 独有接缝**、而 pi SDK 给不了的工具。凡 SDK 已有的(shell、文件读写、通用 fetch、grep、glob),一律不重复造 —— 否则只是冗余,且要承担维护与 allowlist 混乱。

pi-web 的独有接缝有三处:**附件存储(BlobStore / L0–L3)**、**Web UI(artifact surface / 富渲染)**、**主进程↔runner 子进程桥**。内置工具的价值应全部压在这三处。

### 1.3 本文范围:Tier 1

Tier 1 押**附件/媒体工具** —— 唯一性最强(SDK 没有附件存储),接缝现成(`attachment-tool-bridge` 已落地并端到端验证),适合用来**先立住"内置工具"的注册/装配/开关范式**。范式立住后,Tier 2(Artifact/UI)、Tier 3(Web-into-store)才有统一接入点。

Tier 1 候选工具:

| 工具 | 作用 | 依赖 |
|---|---|---|
| `image_transform` | resize / crop / convert / compress(输入输出都走 attachment store) | 图像库(见 §8 待决策) |
| `pdf_extract_text` | PDF 附件 → 纯文本 | PDF 解析库 |
| `pdf_to_images` | PDF 附件 → 每页 PNG 附件 | PDF 渲染库 |
| `image_thumbnail` | 生成缩略图附件 | 图像库(同 `image_transform`) |
| `ocr`(可选,后置) | 图片 → 文字 | OCR 后端(本地 wasm 或云,见 §8) |

---

## 2. 核心设计决策

### 2.1 注册机制:延迟取 ctx,沿用 globalThis seam(关键时序约束)

现有示例工具 `createEditImageTool(ctx)` 在装配时**闭包注入** ctx。但内置工具不能照搬,原因是**时序**:

```
buildRuntimeFactory(def) ── 返回 factory
  └─ createAgentSessionRuntime(factory)
       └─ factory() 内调用 createAgentSessionFromServices({ customTools })   ← ① customTools 在此装配
            （此时 session 还在创建中,sessionId 尚不可得）
  ── runtime 创建完成 ──
wireAttachmentBridge(runtime, { env, sessionId })                            ← ② ctx 在此才构造
  └─ ctx = createAttachmentToolContext(store, runtime.session.sessionId)
     globalThis[ATTACHMENT_TOOL_CONTEXT_KEY] = ctx
```

`customTools` 装配(①)发生在 ctx 构造(②)**之前**,且 `sessionId` 直到 runtime 创建后才可得(`runner.ts:225`)。这正是现有架构用 **globalThis seam** 解耦的原因:工具在**装配时**构造、在 **execute() 时**才从 `globalThis[ATTACHMENT_TOOL_CONTEXT_KEY]` 读 ctx —— 而 execute 一定发生在 ② 之后,故 ctx 必然已就绪。

**决策:内置工具同样在 execute 内延迟读取 ctx**,不在装配时接收 ctx。每个内置工具构造时只接收一个 `getCtx: () => AttachmentToolContext | undefined`(读 seam),不持有 ctx 本身。

> 内置工具是 `@pi-web/server` 自带代码(不经 jiti 装载),理论上也可走"可变 ctx holder + 装配后回填"的方案绕开 seam。但**复用现有 seam 约定**(`ATTACHMENT_TOOL_CONTEXT_KEY`)更简单、与示例工具单一约定一致,不引入第二套时序机制。

### 2.2 装配点:runner 直接合并进 customTools

内置工具住在 `@pi-web/server`,runner 子进程**直接 import** 并合并进 `customTools`,无需作者在 `index.ts` 写一行。合并发生在工厂内(`option-mapper.ts` 的 `buildRuntimeFactory`):

```ts
// option-mapper.ts buildRuntimeFactory 内,装配 fromServices 时:
const builtin = buildBuiltinWebTools(webToolsConfig, getCtxFromSeam);   // 开关过滤后的内置工具
const authored = session.customTools ?? [];
if (builtin.length > 0 || authored.length > 0) {
  fromServices.customTools = [...builtin, ...authored];   // 内置在前,作者可同名覆盖在后(见 §6.3)
}
```

`buildBuiltinWebTools` 与各工具实现都在新目录 `packages/server/src/builtin-tools/`(子进程专用)。

### 2.3 webpack external 边界(硬约束)

内置工具 `import { defineTool } from "@earendil-works/pi-coding-agent"` + `Type` from `@earendil-works/pi-ai`。与 `example-tool.ts` 头注释相同的约束:

> **绝不能**经 `attachment-bridge/index.ts` 或 server 主 barrel(`index.ts`)`export *` 重导出 —— 否则会把整套 pi SDK 拉进 Next 服务端 bundle、破坏 webpack external 边界(参见 memory `pi-web-pi-sdk-dev-external`)。

落地:`packages/server/src/builtin-tools/` **不挂到任何 barrel**,仅由 runner(`option-mapper.ts` / `runner.ts`,本就已是子进程侧、已 import pi SDK)与单测**相对路径直接导入**。

### 2.4 开关机制:opt-in,默认关

新增 `AgentDefinition.webTools` 字段(紧邻 `agent-definition.ts:57` 的 `customTools`):

```ts
/**
 * pi-web 内置 Web 工具开关(opt-in)。
 * - 省略 / undefined:不装配任何内置工具(保持现状,零意外)。
 * - true | "all":装配全部内置工具。
 * - string[]:按名 allowlist 装配(如 ["image_transform", "pdf_extract_text"])。
 */
webTools?: boolean | "all" | string[];
```

语义:

- **默认关**(省略即不装配)—— 不改变任何现有 agent 行为,无回归面。
- allowlist 与 SDK 的 `tools`/`excludeTools`(那是 SDK 内置命名空间)**正交**,内置 Web 工具是独立命名空间,故用独立字段而非复用。
- 另保留一个**全局熔断**:runner 读 env `PI_WEB_DISABLE_BUILTIN_TOOLS=1` 时无条件不装配(运维/排障开关,优先于 `webTools`)。

### 2.5 能力降级:注册但降级,而非不注册

附件存储不可用时(env 缺失,`ctx.available === false`),需要存储的内置工具**仍然注册**,但 execute 内**早返回**结构化的"附件能力不可用",与 `example-tool.ts:124-132` 一致:

```ts
if (!ctx?.available) {
  return {
    content: [{ type: "text", text: "Attachment capability is not available." }],
    details: { ok: false, error: "attachment capability unavailable" },
  };
}
```

选"注册但降级"而非"不注册"的理由:模型拿到明确的"工具存在但能力不可用",优于工具凭空消失导致的幻觉/反复试错。与示例工具行为一致,降低认知成本。

---

## 3. 包 / 目录结构

```
packages/server/src/builtin-tools/          # 子进程专用,不经任何 barrel 重导出(§2.3)
  index.ts            # buildBuiltinWebTools(config, getCtx) → ToolDefinition[]：开关过滤 + 聚合
  seam.ts             # getCtxFromSeam()：读 globalThis[ATTACHMENT_TOOL_CONTEXT_KEY](复用 attachment-wiring 约定 key)
  shared.ts           # 共用 helper：mime 守卫、字节大小上限、base64 编码(与 example-tool toBareBase64 对齐)
  image-transform.ts  # createImageTransformTool(getCtx)
  image-thumbnail.ts  # createImageThumbnailTool(getCtx)
  pdf-extract.ts      # createPdfExtractTextTool(getCtx)
  pdf-to-images.ts    # createPdfToImagesTool(getCtx)
  ocr.ts              # createOcrTool(getCtx)（后置,见 §8）
```

`seam.ts` 复用 `attachment-wiring.ts` 已导出的 `ATTACHMENT_TOOL_CONTEXT_KEY`,避免出现第二个 seam key 约定。

---

## 4. 内置工具规格(Tier 1)

所有工具:输入引用统一用显式 `attachmentId` 参数(pi 协议无文件引用原语,只能走 tool JSON 参数,见 `example-tool.ts:57-71`);产出统一**先 `ctx.putOutput` 落库后回引用**;`details` 必填、结构化、带 `ok` 判别;失败不回半引用(对齐 Req 7.4)。

### 4.1 `image_transform`

| 项 | 内容 |
|---|---|
| 参数 | `attachmentId: string`、`op: "resize"\|"crop"\|"convert"\|"compress"`、可选 `width`/`height`/`format`/`quality`/`crop{x,y,w,h}` |
| 行为 | resolve 输入 → 按 op 变换字节 → putOutput 落新附件 |
| 产出 | `details.outputAttachmentId` + `displayUrl`;`returnImage` 时附 inline base64(已 await 求值,守 Req 4.3) |
| 降级 | `ctx.available===false` → 早返回 |

### 4.2 `image_thumbnail`

`image_transform` 的便捷特例:固定生成等比缩略图(默认最长边 256px,可配),输出新附件。可作为 `image_transform` 的薄封装。

### 4.3 `pdf_extract_text`

| 项 | 内容 |
|---|---|
| 参数 | `attachmentId: string`、可选 `pages`(页范围,如 `"1-5"`) |
| 行为 | resolve PDF 字节 → 抽文本 |
| 产出 | `details.text`(短文)或在过长时 putOutput 成 `.txt` 附件回引用 + `details.outputAttachmentId`(避免撑爆 tool result) |

### 4.4 `pdf_to_images`

| 项 | 内容 |
|---|---|
| 参数 | `attachmentId: string`、可选 `pages`、可选 `dpi` |
| 行为 | 逐页渲染为 PNG → 每页 putOutput |
| 产出 | `details.pages: { page:number; attachmentId:string; displayUrl:string }[]` |

### 4.5 `ocr`(后置)

依赖 OCR 后端,决策见 §8;可在 Tier 1 范式立住后单独追加,不阻塞前四个工具。

---

## 5. 装配 / 执行时序

```
作者 index.ts: defineAgent({ webTools: ["image_transform", "pdf_extract_text"] })
        │
        ▼  runner 子进程
buildRuntimeFactory(def, ..., webToolsConfig)
        │  factory():
        │    builtin = buildBuiltinWebTools(webToolsConfig, getCtxFromSeam)   ← 装配时构造,持 getCtx(延迟)
        │    fromServices.customTools = [...builtin, ...(def.customTools ?? [])]
        │    createAgentSessionFromServices(fromServices)                      ← ① 工具进会话
        ▼
createAgentSessionRuntime 返回 runtime
        │
        ▼
wireAttachmentBridge(runtime, {env, sessionId})
        │    globalThis[ATTACHMENT_TOOL_CONTEXT_KEY] = ctx                     ← ② ctx 就绪
        │    （同时:beforeToolCall 属主闸门 / afterToolCall base64 剥离已接好）
        ▼
模型调用 image_transform(attachmentId)
        │    beforeToolCall: 属主校验 attachmentId（越权 → block）             ← 复用现有闸门,内置工具白嫖
        │    execute(): ctx = getCtxFromSeam() → resolve → 变换 → putOutput    ← 此刻 ② 已完成,ctx 必就绪
        │    afterToolCall: 若回图,base64 剥离为引用                            ← 复用现有出口闸门
        ▼
结果回流(引用 + details)
```

---

## 6. 安全与边界

### 6.1 属主校验:免费复用

内置工具用 `attachmentId` 承载输入,而 `wireAttachmentBridge` 已把 `makeBeforeToolCall(store, sessionId)` 接到 `agent.beforeToolCall`(`attachment-wiring.ts:157-174`),对**所有**工具调用做属主校验。内置工具**无需自己写属主校验**,越权/不存在的 `attachmentId` 在进入 execute 前即被 `{ block:true }` 拦下。

### 6.2 输出 base64 剥离:免费复用

`makeAfterToolCall` 出口闸门(`attachment-wiring.ts:177-207`)对回图的 inline base64 做剥离。内置工具回图无需自管。

### 6.3 同名覆盖语义

合并顺序 `[...builtin, ...authored]`:若作者 `customTools` 里有同名工具,**后者在数组后位**。需确认 pi SDK `customTools` 的同名解析是"后者胜"还是"报错/前者胜"——**待验证**(§8)。期望语义:作者可用同名 customTool **覆盖**内置实现。

### 6.4 资源上限

每个工具需有:输入字节上限(超限早返回)、单次执行超时、PDF 页数上限。默认值待定;`shared.ts` 提供统一守卫。

### 6.5 依赖的子进程隔离

图像/PDF/OCR 库都是较重的 native/wasm 依赖。约束:

- 仅 `builtin-tools/` 子进程侧导入,**绝不进 Next 主 bundle**(同 §2.3)。
- **懒加载**:工具 execute 内 `await import()` 其依赖库;依赖缺失(未安装)→ 视同能力降级,早返回"该工具依赖不可用",不崩溃子进程。这让重依赖成为**可选**安装项。

---

## 7. 测试策略

- **单测**(每工具):mock `getCtx` 返回桩 ctx(`resolve` 回固定字节、`putOutput` 记录调用),断言变换正确、putOutput 入参、降级分支、依赖缺失分支。
- **装配单测**:`buildBuiltinWebTools` 的开关过滤(undefined / true / allowlist / env 熔断)。
- **e2e**:沿用隔离 build 跑法(memory `pi-web-e2e-isolated-build`:`NEXT_DIST_DIR=.next-e2e` + external server);用一个 stub agent 声明 `webTools`,上传附件 → 触发工具 → 断言产出附件回流 + 富渲染。注意 memory `pi-web-handler-singleton-restart`(改注入/配置域后须重启 dev)。

---

## 8. 待决策 / 开放问题

1. **图像库选型**:`sharp`(native,快,但平台二进制)vs `jimp`(纯 JS,慢但零 native)vs wasm 方案。影响安装体验与跨平台。倾向 `sharp` + 懒加载降级。
2. **PDF 库选型**:抽文本(`pdfjs-dist` / `pdf-parse`)与渲染成图(需 canvas/wasm)可能是两套依赖。
3. **OCR 后端**:本地 wasm(`tesseract.js`,体积大)vs 云(需密钥配置,引入外部依赖与隐私面)。建议 Tier 1 先不做,后置。
4. **`customTools` 同名解析语义**(§6.3):需查 pi SDK 实际行为,确认"作者同名覆盖内置"可行。
5. **默认开关**:本文取"默认关 + 显式 opt-in"。若产品希望"开箱即用",可改为"附件存储可用时默认开",但会扩大回归面,需另议。
6. **配置面是否上行到 descriptor/Web UI**:Tier 1 工具纯 agent 侧,Web UI 无需感知;但若将来要在前端展示"本 agent 启用了哪些内置工具",需扩 descriptor。Tier 1 暂不做。

---

## 9. 明确不做(Out of Scope)

- **不重造 SDK 内置**:shell / 文件读写 / 通用 fetch / grep / glob。
- **Tier 2(Artifact/UI 工具)**:`render_chart` / `render_table` / html artifact —— 另立文档。
- **Tier 3(Web-into-store)**:`fetch_to_attachment` / `screenshot_url` —— 另立文档。
- **WebExtension 贡献点**:slash/mention 是输入触发机制,与工具正交。

---

## 10. 落地顺序建议

1. 骨架:`builtin-tools/` 目录 + `seam.ts` + `buildBuiltinWebTools` 开关过滤 + `webTools` 字段 + runner 合并点。**用一个最简工具(`image_transform` 仅 convert)端到端跑通注册/装配/开关/降级范式。**
2. 范式立住后,补齐 `image_transform` 全 op + `image_thumbnail`。
3. PDF 两件(依赖较重,懒加载降级先行验证)。
4. `ocr` 视需求后置。
