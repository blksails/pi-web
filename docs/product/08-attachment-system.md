# 08 · 附件系统

附件系统为 pi-web 提供从上传落库到 tool 消费的全链路文件管理能力，以「引用而非 base64」为核心原则，分四层（L0–L3）实现可插拔、防枚举、跨进程一致的附件存储与分发。

---

## 1. 设计原则与三条不变式

| 不变式 | 含义 |
|--------|------|
| **单一身份** | `att_<nanoid>` 公开 id 唯一，只能由 server 端 `AttachmentStore.put()` 铸造，前端无法自造正式 id |
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

L1  描述符与公开 id — att_<nanoid>
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

> 类型契约 `AttachmentToolContext` / `AttachmentToolHandle` 由 `@blksails/agent-kit` 暴露给 tool 作者（仅类型，无值导入）；构造函数 `createAttachmentToolContext()`（值）留在 `@blksails/server`。

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
import { useAttachments } from "@blksails/react";

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
import { uploadAttachment } from "@blksails/react";

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
import type { AttachmentToolContext } from "@blksails/agent-kit";

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
2. 打开 http://localhost:3000，在对话框上传一张图片（仅 `image/*`），等状态变 `ready`。
3. 发一句要求编辑该图片的消息；模型据注入的 `[attachment id=… ]` 标记调用 `edit_image` 工具。
4. 预期结果：tool 回流一个 `att_out` 产出物，消息里出现新的 `displayUrl`，刷新后历史仍可见。
5. 若 tool 报「附件能力不可用」→ 子进程 env 缺 `PI_WEB_ATTACHMENT_DIR`（`ctx.available === false`）；若产出图 401 → 主/子 `PI_WEB_ATTACHMENT_SECRET` 不一致。详见 [18 故障排查 FAQ](./18-troubleshooting-faq.md)。

> runner 装配（`wireAttachmentBridge`，`packages/server/src/runner/attachment-wiring.ts`）通过约定 globalThis seam `__piWebAttachmentToolContext__` 把闭包绑定的 `AttachmentToolContext`（子进程 store + 当前 sessionId）透给运行在子进程的工具——示例工具据此取上下文，缺失时回落 `available:false` 安全降级。

---

## 9. @ 引用补全

`attachment-mention-completion` spec 在补全框架中注册了一个 attachment provider（工厂 `createAttachmentProvider(store)`，id `"attachment"`、触发符 `@`、kind `attachment`）：

- `complete`:触发符 `@` → `store.listBySession(ctx.sessionId)` 列举本会话已有附件，按附件名子序列模糊匹配，映射为候选。
- token 形态:`@attachment:<id>`（由 `serializeToken({ trigger: "@", kind: "attachment", id })` 产出）。
- `resolve`:仅当 `head(id)` 命中且 `att.sessionId === ctx.sessionId` 时复用 `buildAttachmentRefs([att])` 产出与上传/剥离路径完全一致的规范引用标记;否则返回 `null`（框架保留原文降级，杜绝跨会话枚举）。框架级解析入口为 `resolveCompletions`（`packages/server/src/completion/resolve.ts`）。

Provider 源文件:`packages/server/src/completion/providers/attachment-provider.ts`。

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

> 更详细的报错复现与排障步骤（签名 URL 401、子进程 `ctx.available === false`、上传 413 等）见 [18 故障排查 FAQ](./18-troubleshooting-faq.md)。

---

## 下一步 / 相关

- AIGC 图像工具如何调用附件系统 → [11 AIGC 工具](./11-aigc-tools.md)
- @ 触发符补全框架 → [09 扩展与 Skills](./09-extensions-and-skills.md)
- HTTP API 完整端点列表（含 `/attachments`） → [13 HTTP API 参考](./13-http-api-reference.md)
- 系统整体架构与进程边界 → [03 架构](./03-architecture.md)
- 部署时的环境变量配置 → [15 部署](./15-deployment.md)
- 签名 URL 401、`ctx.available === false` 等排障 → [18 故障排查 FAQ](./18-troubleshooting-faq.md)
