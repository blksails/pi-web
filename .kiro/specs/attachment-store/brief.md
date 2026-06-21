# Brief: attachment-store

> 附件系统两切片之一(基础层)。权威分层/pipeline/id 设计见 `.kiro/steering/roadmap.md` 的「附件系统」波次。
> 配套切片:`attachment-tool-bridge`(场景 ②,依赖本 spec)。

## Problem
当前附件能力仅覆盖"图片 + 内存 base64":前端 `useAttachments` 用 `FileReader` 把文件读成 data URL 存内存,提交时抽裸 base64 经 `prompt({images})` 发给 LLM,历史回显再重建 `data:` URL。带来四个痛点:
- **无持久化**:刷新/关页即丢;tool 产出物无处存。
- **撑大体积**:base64 比二进制膨胀 ~33%,既进 LLM context 又进消息历史/DOM,展示侧尤其浪费。
- **仅图片**:非图片一律 rejected。
- **拿不到文件**:server 端 tool(图像编辑/生成)需要文件路径/URL,内存 base64 够不着(留给 `attachment-tool-bridge` 解决,但前提是先有持久化对象存储)。

## Current State
- `packages/react/src/hooks/use-attachments.ts` — `PendingAttachment{ id, name, mimeType, dataUrl }`,id 形如 `att-1`(前端临时、内存)。
- `packages/ui/src/elements/attachments.tsx` — 拖拽/粘贴/选择 UI;`packages/ui/src/chat/pi-chat.tsx` 提交时 `toImageContents()`。
- `packages/react/src/transport/agent-message-to-ui.ts` — 历史 `ImageContent` → `file` part,`url` 为重建的 `data:` URL。
- HTTP 层(`packages/server/src/http`)无任何上传/分发端点;无对象存储概念。

## Desired Outcome
- 存在一个**可插拔后端的对象存储**(先 LocalFs),上传即落盘并返回稳定的 `Attachment` 描述符(含 `att_<nanoid>` 公开 id)。
- 上传与发消息**解耦**:`POST /attachments`(multipart)落库拿 id;前端发消息只带引用。
- 任意附件(上传 / 后续 tool 产出)可经 `GET /attachments/:id/raw` 用**网络 URL** 展示,前端不再把 base64 塞进列表/历史。
- `useAttachments` 改为"上传拿正式 id、用 URL 展示";正式 id 只能来自 server `put()`。
- **本切片对 LLM 维持现状**:仍按 base64 发图(vision),不改 `prompt({images})` 链路 —— context 闸门留给 `attachment-tool-bridge`。

## Approach
分层落地 L0 + L1 + HTTP 端点,守住「先落库后引用」不变式:
- **L0 Blob Store / VFS**:接口按 S3 风格(`put`/`get`/`head`/`presignUrl`/`delete`),先实 `LocalFsBackend`。对外暴露多种 accessor 雏形(`getReadStream`/`getUrl`;`localPath`/`bytes` 由 tool-bridge 切片补全使用)。
- **L1 Attachment 描述符**:`{ id, name, mimeType, size, origin:"upload"|"tool-output", sessionId, createdAt }`,**不含字节**;是系统内到处流通的"普通话"。
- **id 生成**:公开 id = `att_` + nanoid(URL-safe、不可枚举),在 `put()` 内唯一铸造;存储 key 可后置内容哈希去重(第一版可 `key=id`)。
- **HTTP**:`POST /sessions/:id/attachments`(multipart,落库返回描述符)+ `GET /attachments/:id/raw`(带签名/token,防枚举越权;本地后端也需能签发可达 URL,为 S3 presign 预留同形接口)。
- **双进程实例化预留**:store 在 server 主进程实例化服务上传/分发;目录约定经 spawn env 下发(像 session workdir),为 `attachment-tool-bridge` 的 runner 子进程共享同一后端预留接缝。

## Scope
- **In**:
  - 对象存储接口 + `LocalFsBackend` + id 生成(`att_<nanoid>`)。
  - `Attachment` 描述符类型 + session 属主元数据。
  - `POST /sessions/:id/attachments`(multipart 上传落库)。
  - `GET /attachments/:id/raw`(签名校验 + 正确 mimeType/缓存头)。
  - 前端 `useAttachments` 重构:上传→正式 id;列表/缩略图改用 `toDisplayUrl(id)` URL。
  - 历史回显从内嵌 base64 改为按引用走 `/raw` URL。
  - 单元/集成测试 + e2e(上传→落库→URL 回显)。
- **Out**:
  - L2 `resolve` / `AgentTool` 接入 / tool 执行(→ `attachment-tool-bridge`)。
  - L3 context 闸门 / 智能意图路由(→ `attachment-tool-bridge` 第一版仅打通显式路径;智能路由 future)。
  - 改造 base64→LLM 的 `prompt({images})`(维持现状)。
  - S3/对象服务后端实现(接口预留,future)。
  - 非图片"给 LLM 看"(pi 协议不支持,非本系统职责)。

## Boundary Candidates
- 后端抽象(Store 接口)vs 本地实现(LocalFsBackend)—— 为 S3 留缝。
- 上传端点 vs 分发端点(写路径 / 读路径,签名策略不同)。
- 前端摄入/展示重构(useAttachments + attachments.tsx + 历史回显)。

## Out of Boundary
- runner 子进程侧的 store 实例化与 tool `resolve`(那是 tool-bridge 的进程边界问题)。
- pi transcript 内的 base64(由 pi 子进程持有,属 tool-bridge/pi 域)。

## Upstream / Downstream
- **Upstream**:`http-api`(新增路由注入)、`react-client` / `ui-components`(useAttachments/attachments.tsx)、`session-engine`(session 属主 / workdir 目录约定)。
- **Downstream**:`attachment-tool-bridge`(消费 store 的 `resolve` + 同一 id 空间);future 智能路由 / S3 后端。

## Existing Spec Touchpoints
- **Extends**:`http-api`(加上传/分发路由)、`react-client`+`ui-components`(附件 hook 与 UI)、`session-engine`(属主/目录)。
- **Adjacent**:`session-store-adapters`(存储抽象的可插拔风格可参考对齐,避免两套接口风格分裂)、`rich-chat-ui`(file part 渲染)。

## Constraints
- 本地后端先行,接口按 S3 风格,后续 S3 实现不改调用方。
- `/raw` URL 不可枚举、需签名;本地后端也要能签发可达 URL(为 S3 presign 同形)。
- store 须可在 server 进程实例化,且**存储目录约定要让未来 runner 子进程也能共享**(经 spawn env 下发)。
- 不污染 dev `.next`(遵循项目既有 e2e 隔离 build 约定);测试需新鲜运行证据。
- spec 文档与代码注释用中文(`spec.json.language = zh`)。
