# 09 · 附件系统

附件系统为 pi-web 提供从上传落库到 tool 消费的全链路文件管理能力，以「引用而非 base64」为核心原则，分四层（L0–L3）实现可插拔、防枚举、跨进程一致的附件存储与分发。

---

## 1. 设计原则与三条不变式

| 不变式 | 含义 |
|--------|------|
| **单一身份** | `att_<base64url>` 公开 id 唯一（`node:crypto` `randomBytes(16)` 编码，无第三方依赖），只能由 server 端 `AttachmentStore.put()` 铸造，前端无法自造正式 id |
| **先落库后引用** | 发消息引用前必先完成上传落库，history/context 只存 `att_<id>` 引用 |
| **base64 仅具名出口物化** | 只有两个出口可产生 base64：vision 喂 LLM（`toImageContents()`，现状保留）与 `afterToolCall` 标记"需复看"；所有其他路径只传引用 |

**协议约束**：pi `AgentTool.content` 仅 `text | image base64`，无文件引用原语 → 文件能力全在 pi-web 层实现，不进 pi 协议。

---

## 2. 分层架构（L0–L3）

```
L3  context 闸门（已接入 runner）
     ├─ beforeToolCall 属主校验（makeBeforeToolCall）
     └─ afterToolCall base64 剥离（makeAfterToolCall）

L2  resolve 投影 — AttachmentHandle（attachment-handle.ts）
     ├─ bytes()  stream()  localPath()  url()（无 base64 形态）
     └─ 子进程 store 工厂 createChildAttachmentStore（child-store.ts）

L1  描述符与公开 id — att_<base64url>
     ├─ AttachmentStore 门面（put/head/getReadStream/presignUrl/localPath/listBySession）
     └─ AttachmentRegistry（<id>.att.json 持久化）

L0  对象存储 — BlobStore
     ├─ LocalFsBlobBackend（落盘，$PI_WEB_ATTACHMENT_DIR）
     └─ S3-ready 接口（规划中，未实现）
```

### 盘上布局（LocalFs 后端）

```
$PI_WEB_ATTACHMENT_DIR/
├── <att_id>            # 字节内容（key = id，本切片不去重）
├── <att_id>.meta.json  # { mimeType, size }
└── <att_id>.att.json   # Attachment 描述符（含 sessionId/origin/createdAt 等）
```

> 默认目录：`~/.pi/agent/attachments`（`PI_WEB_ATTACHMENT_DIR` 未设时回落）。

---

## 3. 关键组件与源文件

| 组件 | 路径 | 职责 |
|------|------|------|
| `BlobStore` 端口 | `packages/server/src/attachment/blob-store.ts` | S3 风格五能力接口 + `BlobNotFoundError` |
| `LocalFsBlobBackend` | `packages/server/src/attachment/local-fs-backend.ts` | 字节落盘/读流/删除 |
| `UrlSigner` | `packages/server/src/attachment/url-signer.ts` | HMAC-SHA256 签名/校验（`timingSafeEqual`）|
| `AttachmentRegistry` | `packages/server/src/attachment/attachment-registry.ts` | 描述符元数据持久化与查询 |
| `AttachmentStore` 门面 | `packages/server/src/attachment/attachment-store.ts` | `put` 内铸造 id + 组合三者 |
| `mintAttachmentId()` | `packages/server/src/attachment/id.ts` | `att_` + `randomBytes(16).toString("base64url")` |
| `attachmentStoreConfigFromEnv()` | `packages/server/src/attachment/config.ts` | 从 env 构造 store + 返回 `{store, dir, secret}` |
| `createAttachmentRoutes()` | `packages/server/src/http/routes/attachment-routes.ts` | 注入上传/分发两路由 |
| `uploadAttachment()` | `packages/react/src/transport/attachment-upload.ts` | 客户端 multipart 上传 |
| `useAttachments` | `packages/react/src/hooks/use-attachments.ts` | 上传状态机 hook（uploading → ready / error）|
| `createChildAttachmentStore()` | `packages/server/src/attachment-bridge/child-store.ts` | runner 子进程内从 env 实例化 store（缺 `PI_WEB_ATTACHMENT_DIR` 返回 `undefined`）|
| `resolveAttachment()` | `packages/server/src/attachment-bridge/resolve.ts` | L2 投影入口（`head(id)` 不存在 → `AttachmentResolveError`）|
| `createAttachmentHandle()` | `packages/server/src/attachment-bridge/attachment-handle.ts` | 四形态句柄 `AttachmentHandle`（`bytes/stream/localPath/url`，无 base64）|
| `makeBeforeToolCall()` | `packages/server/src/attachment-bridge/ownership-guard.ts` | tool 前属主校验闸门 |
| `makeAfterToolCall()` | `packages/server/src/attachment-bridge/base64-gate.ts` | tool 后 base64 剥离闸门 |
| `putToolOutput()` | `packages/server/src/attachment-bridge/tool-output.ts` | tool 产出落库（origin: tool-output）|
| `buildAttachmentRefs()` | `packages/server/src/attachment-bridge/reference-injection.ts` | 附件文本引用注入消息 |
| `createAttachmentToolContext()` | `packages/server/src/attachment-bridge/tool-context.ts` | 构造 tool `execute` 内的 store 句柄接入面（`available/resolve/putOutput`）|
| `wireAttachmentBridge()` | `packages/server/src/runner/attachment-wiring.ts` | runner 子进程把 store + 两闸门接到 pi `agent.beforeToolCall/afterToolCall`，并经 globalThis seam 透 ctx 给 customTools |

> 类型契约 `AttachmentToolContext` / `AttachmentToolHandle` 由 `@blksails/pi-web-agent-kit` 暴露给 tool 作者（仅类型，无值导入）；构造函数 `createAttachmentToolContext()`（值）留在 `@blksails/pi-web-server`。

---

## 4. HTTP 端点

### 4.1 上传（写路径）

```
POST /sessions/:id/attachments
Content-Type: multipart/form-data

字段: file   （File/Blob）
```

- `:id` 会话门控：Router 自动完成存在性（404）/ 越权（403）/ 未鉴权（401）校验。
- 文件字段缺失或空 → `400 NO_FILE`；超 25 MiB（默认上限）→ `413 PAYLOAD_TOO_LARGE`。

**成功响应（200）：**

```json
{
  "attachment": {
    "id": "att_aBcDeFgH...",
    "name": "photo.jpg",
    "mimeType": "image/jpeg",
    "size": 204800,
    "origin": "upload",
    "sessionId": "sess_...",
    "createdAt": "2026-06-24T10:00:00.000Z"
  },
  "displayUrl": "/attachments/att_aBcDeFgH.../raw?exp=1750000000&sig=..."
}
```

### 4.2 分发（读路径）

```
GET /attachments/:attachmentId/raw?exp=<timestamp>&sig=<hmac>
```

- 不绑会话，靠 HMAC 签名自洽鉴权（防枚举）。
- 先校验签名；签名缺失/无效/过期 → `401 INVALID_SIGNATURE`（不暴露 id 是否存在）。
- 仅签名有效才查存在性；不存在 → `404 ATTACHMENT_NOT_FOUND`。
- 成功响应：字节流 + `Content-Type=附件 mime` + `Cache-Control: private, max-age=300`。

> **安全**：路由参数名用 `:attachmentId` 而非 `:id`，避免 Router 把附件 id 当 sessionId 触发会话门控（见 `attachment-routes.ts:144`）。

---

## 5. 环境变量

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `PI_WEB_ATTACHMENT_DIR` | `~/.pi/agent/attachments` | 本地后端落盘根目录（主进程经 spawn env 下发给子进程） |
| `PI_WEB_ATTACHMENT_SECRET` | —（未设时纯单进程可回退随机） | HMAC 签名 secret（主/子进程必须一致，否则子进程产出的签名 URL 在主进程 401） |
| `PI_WEB_ATTACHMENT_URL_BASE` | `""` | 分发 URL 的 base path 前缀（pi-handler 挂在 `/api` 下时传 `"/api"`；不进 HMAC 签名输入） |
| `PI_WEB_ATTACHMENT_URL_TTL_MS` | `315360000000`（10 年） | 签名分发 URL 的默认过期窗口（ms）。取长窗口使历史回放图片长期可达；`sig` 仍需有效，防枚举不变 |

> **跨进程一致性**：主进程经 spawn env 同时下发 `PI_WEB_ATTACHMENT_DIR` + `PI_WEB_ATTACHMENT_SECRET`，runner 子进程用 `createChildAttachmentStore(process.env)` 实例化同一后端，不回调主进程。

---

## 6. 两条消费路径

### 6.1 路径 A：base64 喂 LLM（vision）

适用于图片。`useAttachments` 的 `toImageContents()` 保留此链路，维持现状，不经附件系统落库。

### 6.2 路径 B：文件交 server 端 tool

适用于图像编辑/生成等需要在 runner 子进程内操作文件的场景。

1. 用户上传图片 → `POST /sessions/:id/attachments` 落库得 `att_<id>`。
2. 用户发消息 → 主进程 `injectAttachmentRefs()` 注入文本标记：
   ```
   [attachment id=att_aBcDeFgH... type=image/jpeg name=photo.jpg]
   ```
3. 模型据标记抄 id，调用 tool 时显式传 `{ attachmentId: "att_aBcDeFgH..." }`。
4. `beforeToolCall` 属主校验（`ownership-guard.ts`）:**不限参数名**——递归扫描所有工具参数里形如 `att_<id>` 的值，逐个 `store.head(id)` 校验 `sessionId === 当前会话`;任一不存在/越权/store 不可用 → `{ block: true, reason }`（fail-closed，tool 不进 `execute`）。
5. tool `execute` 内用 `ctx.resolve(attachmentId)` 取 `AttachmentHandle`：
   ```ts
   const handle = await ctx.resolve(params.attachmentId);
   const localPath = await handle.localPath(); // LocalFs 直返落盘路径，零拷贝
   const url      = await handle.url();        // HMAC 签名分发 URL
   const bytes    = await handle.bytes();      // 整块字节（小文件）
   ```
6. 处理完毕 → `ctx.putOutput({ bytes, name, mimeType })` 落库（`origin: "tool-output"`）得 `att_out`。
7. `afterToolCall` 剥离 tool result 中内联 base64，替换为文本引用 `[attachment id=att_out ...]`。
8. 跨轮回环 B：`att_out` 与上传 id 同一空间，下一轮可再次注入引用被 tool 消费。

---

## 7. 前端集成

### 7.1 useAttachments hook

```ts
import { useAttachments } from "@blksails/pi-web-react";

const { items, add, remove, clear, toImageContents, referenceIds } =
  useAttachments({
    supported: true,
    baseUrl: "/api",
    sessionId: currentSessionId,
  });

// 添加文件（仅 image/*）：返回 { rejected } 列出被拒文件名
await add(fileList);

// items[n].status: "uploading" | "ready" | "error"
// items[n].attachmentId: "att_..." （status=ready 时才有，server 铸造）
// items[n].displayUrl: "/attachments/.../raw?exp=..." （status=ready 时才有）
// items[n].dataUrl: "data:image/..."  （本地预览用，上传前/后均有）

// 提交时 toImageContents() 走 vision base64 路径（维持现状）
// referenceIds() 返回已落库 attachmentId 列表（供文本引用注入）
```

### 7.2 手动调用上传

```ts
import { uploadAttachment } from "@blksails/pi-web-react";

const { attachment, displayUrl } = await uploadAttachment(
  "/api",
  sessionId,
  file,
);
// attachment.id === "att_..." （server 铸造，可信）
```

---

## 8. Tool 开发者接入（agent-kit）

```ts
import { defineTool } from "@earendil-works/pi-coding-agent";
import { Type } from "@earendil-works/pi-ai";
import type { AttachmentToolContext } from "@blksails/pi-web-agent-kit";

// 参数用 pi-ai 的 Type.Object 声明（defineTool 期望 TypeBox schema，非裸对象）
const EditImageParameters = Type.Object({
  attachmentId: Type.String({
    description: "输入附件公开 id（att_...），逐字抄自用户消息里的 [attachment id=…] 引用",
  }),
});

export function createMyImageTool(ctx: AttachmentToolContext) {
  return defineTool({
    name: "edit_image",
    description: "对指定附件图片进行编辑处理",
    parameters: EditImageParameters,
    async execute(toolCallId, params) {
      if (!ctx.available) {
        return { content: [{ type: "text", text: "附件能力不可用" }], details: { ok: false } };
      }
      const handle = await ctx.resolve(params.attachmentId);
      const localPath = await handle.localPath(); // 直接传给处理工具，零拷贝

      // ... 图像处理 ...
      const outputBytes = new Uint8Array(/* ... */);

      const outputRef = await ctx.putOutput({
        bytes: outputBytes,
        name: "result.png",
        mimeType: "image/png",
      });

      // ToolOutputRef 形态：{ attachmentId, displayUrl, name, mimeType }（不含 .attachment）
      return {
        content: [{ type: "text", text: `处理完成：${outputRef.displayUrl}` }],
        details: {
          ok: true,
          outputAttachmentId: outputRef.attachmentId,
          displayUrl: outputRef.displayUrl,
        },
      };
    },
  });
}
```

- 服务端示例实现：`packages/server/src/attachment-bridge/example-tool.ts`（`createEditImageTool`，演示三形态解析 + 回流）。
- 端到端可运行形态：`examples/attachment-tool-agent/tools/edit-image-tool.ts`（经 jiti 真实装载、由 runner 装配为 customTool，浏览器 e2e 跑通整链路）。

#### 跑通这个示例

1. 设好附件存储 env（主/子进程一致），并用 `PI_WEB_DEFAULT_SOURCE` 指向示例 agent 源启动 dev：
   ```bash
   export PI_WEB_ATTACHMENT_DIR="$HOME/.pi/agent/attachments"
   export PI_WEB_ATTACHMENT_SECRET="$(openssl rand -hex 32)"
   PI_WEB_DEFAULT_SOURCE=./examples/attachment-tool-agent pnpm dev
   ```
   （也可不设 `PI_WEB_DEFAULT_SOURCE`，启动后在首页 agent source picker 里直接填 `./examples/attachment-tool-agent`，与 `e2e/browser/attachment-tool-bridge.e2e.ts:44` 一致。）
2. `pnpm dev` 是 `scripts/dev-all.mjs`，并发拉起 API(3000) 与 Vite dev(5173)。浏览器打开 **http://localhost:5173**（`/api` 请求由 Vite 代理到 3000），在对话框上传一张图片（仅 `image/*`），等状态变 `ready`。
3. 发一句要求编辑该图片的消息；模型据注入的 `[attachment id=… ]` 标记调用 `edit_image` 工具。
4. 预期结果：tool 回流一个 `att_out` 产出物，消息里出现新的 `displayUrl`，刷新后历史仍可见。
5. 若 tool 报「附件能力不可用」→ 子进程 env 缺 `PI_WEB_ATTACHMENT_DIR`（`ctx.available === false`）；若产出图 401 → 主/子 `PI_WEB_ATTACHMENT_SECRET` 不一致。详见 [23 故障排查 FAQ](./23-troubleshooting-faq.md)。

> runner 装配（`wireAttachmentBridge`，`packages/server/src/runner/attachment-wiring.ts`）通过约定 globalThis seam `__piWebAttachmentToolContext__` 把闭包绑定的 `AttachmentToolContext`（子进程 store + 当前 sessionId）透给运行在子进程的工具——示例工具据此取上下文，缺失时回落 `available:false` 安全降级。

---

## 9. 触发符补全框架 / @ 引附件

附件落库后，用户还需要一种轻量方式在输入框里**引用**它们——不必每次重新上传或手抄 `att_<id>`。pi-web 为此提供了一套通用的**触发符补全框架**（spec `completion-provider-framework`），附件引用（spec `attachment-mention-completion`）是它之上的第一个内置 provider，与内置的 `@file` 文件引用并存于同一个 `@` 触发符下。

### 9.1 框架是什么

补全框架把"输入触发符 → 拉候选 → 选中插入 token → 提交期解析为上下文文本"抽象成一组可插拔的 **CompletionProvider**。一个 provider 对应一种触发符语义；多触发符能力靠注册多个 provider 达成，而非单 provider 声明数组。

| 概念 | 位置 | 职责 |
|------|------|------|
| `CompletionProvider` 契约 | `packages/server/src/completion/types.ts:36` | `id` / 单字符 `trigger` / `kind` / `priority` / `extract`（token 提取规则）+ `complete()` + 可选 `resolve()` |
| `CompletionRegistry` | `packages/server/src/completion/registry.ts:86` | 注册（校验单字符触发符、同 id 覆盖告警）、活跃触发符并集、按归一化触发符并发分发 `complete`（per-provider 超时降级）、合并去重、按 `kind` 反查 provider 供 `resolve` |
| `resolveCompletions()` | `packages/server/src/completion/resolve.ts:13` | 提交期扫描消息中的 token，按 `kind` 分发 `resolve`，把 token 替换为上下文文本；无 provider / 无 resolve / 抛错 / 返回 `null` → 保留原 token，绝不阻断发送 |
| 线协议 DTO | `packages/protocol/src/transport/completion-dto.ts` | `CompletionItem` / `CompletionResponse` / `CompletionTriggersResponse`（含函数的 provider 契约是服务端内部类型，不进协议层） |

provider 在 `createHandler` 装配期注册（`packages/server/src/http/create-handler.ts:79`）：内置 `createFileProvider()` 始终注册，附件存储就绪时再注册 `createAttachmentProvider(lister)`，宿主还可经 `opts.completionProviders` 追加自定义 provider。

### 9.2 HTTP 端点

补全走两个会话级只读端点（`packages/server/src/http/routes/completion-routes.ts`），均经 `requireSession` 复用会话门控（不存在/越权 → 404，镜像 query 路由）：

```
GET /sessions/:id/completion/triggers          → { triggers: [{ trigger, extract }] }
GET /sessions/:id/completion?trigger=@&q=<查询>  → { items, groups }
```

- `/triggers` 返回所有已注册 provider 的触发符并集 + 提取规则，前端据此决定哪些字符要触发补全弹层。
- `/completion` 按归一化触发符分发到匹配 provider，并发拉候选后合并、去重、限量（默认上限 30、单 provider 超时 800 ms 降级），返回候选 + 按 `kind` 的分组摘要。
- `CompletionCtx`（`sessionId` / `cwd` / `userId`）由服务端从会话 + 鉴权组装注入，**provider 不得自前端取**——这是会话隔离的根。

### 9.3 内置 file provider 与 realpath 安全门

`createFileProvider()`（`packages/server/src/completion/providers/file-provider.ts`）让用户用 `@` 引当前会话 `cwd` 下的工作区文件：

- `complete`:遍历 `ctx.cwd`（尊重 `.gitignore`、跳过 `.git`/`node_modules`/`dist` 等重目录、遍历上限 + TTL 缓存、不跟随符号链接），按查询模糊评分排序限量，产出 `@file:<相对路径>` 候选。
- `resolve`（提交期）:把 `@file:<rel>` 规约为 LLM 友好的 `@<rel>`（v1 不读文件内容）。关键安全门——经 `fs.realpath` 把目标解析为真实路径，断言它落在 `cwd` 的 realpath 前缀内；`../` 越界、symlink 逃逸、目标不存在 → 返回 `null`，框架保留原文，杜绝把 `cwd` 之外的路径注入上下文（`file-provider.ts:257`）。

### 9.4 @ 引附件全链路（complete → 候选 → resolve）

`createAttachmentProvider(store)`（`packages/server/src/completion/providers/attachment-provider.ts`，id `"attachment"`、触发符 `@`、kind `attachment`）把已落库附件接到同一个 `@` 触发符：

1. **complete**:用户敲 `@` → 框架命中触发符 → 调 provider。provider 以 `store.listBySession(ctx.sessionId)` 只列**本会话**附件（origin `upload` 与 `tool-output` 皆可），按附件名子序列模糊匹配，每个候选带 `label`（附件名）、`detail`（`mimeType · 人类可读大小`）。列举抛错/空会话 → 返回空数组，补全降级但不阻断 UI。
2. **候选与 token**:选中候选插入 token `@attachment:<id>`（由 `serializeToken({ trigger: "@", kind: "attachment", id })` 产出）。它与 `@file:<rel>` 共享 `@` 触发符——同一弹层里 file 与 attachment 候选按 `kind` 分组并列。
3. **resolve（提交期）**:发送时 `POST /sessions/:id/messages` 先经 `resolveCompletions` 解析 token（`packages/server/src/http/routes/command-routes.ts:104`）。attachment provider 的 `resolve` 仅当 `head(id)` 命中**且** `att.sessionId === ctx.sessionId` 时，复用 `buildAttachmentRefs([att])` 产出与上传注入/base64 剥离路径**完全一致**的规范引用标记 `[attachment id=… type=… name=…]`；否则返回 `null`，框架保留原 token——既防跨会话引用，也防经补全枚举他人附件。

### 9.5 被引附件的预览 chip（PiMentionPreviews）

选中 `@` 附件候选后，输入框里只留一段裸 token `@attachment:<id>`——用户看不出到底引用了哪张图。`PiMentionPreviews`（`packages/ui/src/completion/pi-mention-previews.tsx:54`）补上这条可视反馈：它扫描当前输入值里的 `@attachment:<id>` token（`scanAttachmentMentions`，同文件 `:35`，去重保序），为每个渲染一枚 chip——缩略图 + 附件名 + 移除按钮。这是「@ 引附件」闭环里用户唯一的可视回执。

- **预览数据来自选中一刻**：装配层在补全弹层的 `onAccept` 回调里捕获候选的 `{ label, previewUrl }`，以 `id → MentionPreview` 存进 state（`packages/ui/src/chat/pi-chat.tsx:522-532`），再经 `previews` prop 传入组件（`pi-chat.tsx:1378`）。候选的 `previewUrl` 由 `GET /completion` 产出，形如根相对的 `/attachments/:id/raw?exp=…&sig=…`；客户端 `getCompletion` 按 `baseUrl` 前缀成可达 URL（`packages/react/src/client/pi-client.ts:328-338`），与 §4.2 的分发读路径同源、同样受 HMAC 签名鉴权。
- **无预览退化**：手动键入或刷新后的 token 未经补全选中、`previews` 里查无此 id，退化为「仅名字 / id」的无图 chip（`pi-mention-previews.tsx:71,78`），仍能标记出引用了哪个附件。
- **移除**：点 chip 上的 `×` 触发 `onRemove(id)`，装配层用 `removeAttachmentMention(value, id)`（同文件 `:49`）从输入值删去对应 token（连带其后紧邻的一个空白）。
- **纯展示、不改协议**：组件不发请求、不物化 base64（三条不变式原样成立）；DOM 打 `data-pi-mention-previews`（容器）与 `data-pi-mention-preview=<id>`（每枚 chip）标记，供 e2e 定位。

### 9.6 与附件系统的衔接

`resolve` 出口刻意复用 §6 的 `buildAttachmentRefs()`：无论附件是经"先落库后引用"（§6.2 步骤 2 的 `injectAttachmentRefs`）还是经 `@` 补全引入，注入用户消息的文本标记形态**统一**，下游 `beforeToolCall` 属主校验、tool `execute` 内的 `ctx.resolve` 取句柄、跨轮回环（§6.2 步骤 8）全部沿用同一条链路，无需为补全单开分支。补全只是给附件系统多开了一个**用户侧引用入口**，没有引入新的物化或新的 id 来源——三条不变式（§1）原样成立。

### 9.7 实践参考

端到端可运行形态见 `examples/attachment-tool-agent`：上传图片落库后，在输入框敲 `@` 即可从弹层选中刚上传的附件，选中插入 `@attachment:<id>`，发送时被解析为规范引用标记交给 `edit_image` 工具消费（与 §8「跑通这个示例」同一 agent 源，浏览器 e2e 覆盖整链路）。补全框架本身的契约与端点行为，另见 [10 扩展与 Skills](./10-extensions-and-skills.md) 中触发符补全框架的扩展点说明。

---

## 10. 常见问题与约束

| 场景 | 处置方式 |
|------|----------|
| `PI_WEB_ATTACHMENT_SECRET` 未设，存在 runner 子进程 | 子进程产出的签名 URL 在主进程 401（secret 不一致）；必须显式设置 |
| 子进程 env 缺 `PI_WEB_ATTACHMENT_DIR` | `createChildAttachmentStore()` 返回 `undefined`，`ctx.available === false`，tool 安全降级 |
| 上传文件超 25 MiB | `413 PAYLOAD_TOO_LARGE`（`DEFAULT_MAX_UPLOAD_BYTES` 可覆盖） |
| vision 路径非图片 | `useAttachments.add()` 仅接受 `image/*`，其余记入 `rejected` |
| tool result 含内联 base64 | `afterToolCall`（`base64-gate.ts`）默认剥为文本引用，设 `details.keepInlineImages=true` 则保留 |
| 孤儿对象 GC / 内容哈希去重 | 接口已留缝（`key=id` 本切片不去重），规划中（未实现） |

> 更详细的报错复现与排障步骤（签名 URL 401、子进程 `ctx.available === false`、上传 413 等）见 [23 故障排查 FAQ](./23-troubleshooting-faq.md)。

---

## 下一步 / 相关

- AIGC 图像工具如何调用附件系统 → [11 AIGC 工具](./11-aigc-and-vision-tools.md)
- 触发符补全框架 / @ 引附件 → 本文 [§9](#9-触发符补全框架--引附件)；扩展点另见 [10 扩展与 Skills](./10-extensions-and-skills.md)
- HTTP API 完整端点列表（含 `/attachments`） → [24 HTTP API 参考](./24-http-api-reference.md)
- 系统整体架构与进程边界 → [03 架构](./03-architecture.md)
- 部署时的环境变量配置 → [19 部署](./19-deployment.md)
- 签名 URL 401、`ctx.available === false` 等排障 → [23 故障排查 FAQ](./23-troubleshooting-faq.md)
