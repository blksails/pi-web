/**
 * Author-facing attachment tool context contract (attachment-tool-bridge task 4.1; Req 4.1).
 *
 * `@blksails/pi-web-agent-kit` exposes only the **type** contract a server-side tool author
 * references when authoring an attachment-aware tool. The concrete construction
 * (`createAttachmentToolContext`) and the runtime store handle live in
 * `@blksails/pi-web-server` (runner sub-process side) — keeping construction out of
 * agent-kit means this package never gains a runtime dependency edge into the
 * server bundle (which would break the Next/webpack externals boundary). These
 * are pure `type` declarations derived from the public `@blksails/pi-web-protocol`
 * descriptor surface, structurally compatible with the server-side
 * `AttachmentToolContext` implementation a tool actually receives at runtime.
 *
 * Node stream globals (`NodeJS.ReadableStream`) are intentionally avoided here
 * because agent-kit is type-checked with `"types": []` (no `@types/node`): the
 * handle's `stream()` form is left to the server-side handle type, so this
 * author-facing handle exposes the node-global-free forms (`meta` / `bytes` /
 * `localPath` / `url`). The server `AttachmentHandle` (a superset) remains
 * assignable to {@link AttachmentToolHandle}.
 */
import type { Attachment } from "@blksails/pi-web-protocol";

/**
 * tool-output 回流引用:不含字节,仅承载公开 id 与展示 URL(及类型/文件名)。
 *
 * Mirrors the server-side `ToolOutputRef`; an author receives this from
 * {@link AttachmentToolContext.putOutput} and回流 it as a reference (never inline
 * bytes / base64). Kept structurally identical to the server contract so the
 * runtime value typechecks against this author-facing alias.
 */
export interface ToolOutputRef {
  /** 产出附件的公开 id（`att_<nanoid>`；与上传 id 同一空间）。 */
  readonly attachmentId: string;
  /** 客户端可达展示 URL（与分发签名同形）。 */
  readonly displayUrl: string;
  readonly name: string;
  readonly mimeType: string;
}

/**
 * 作者面 L2 解析句柄:按公开 id 投影出的访问形态 + 上游附件元数据。
 *
 * Node-global-free subset of the server-side `AttachmentHandle` (the `stream()`
 * form, which is typed with `NodeJS.ReadableStream`, is omitted here so agent-kit
 * stays free of `@types/node`). 不暴露 base64 形态。The server handle is a
 * structural superset and remains assignable to this type.
 */
export interface AttachmentToolHandle {
  /** 上游 {@link Attachment} 描述符(不含字节)。 */
  readonly meta: Attachment;
  /** 原始字节形态。 */
  bytes(): Promise<Uint8Array>;
  /** 本地路径形态(LocalFs 直返落盘路径;远程后端懒下载临时文件)。 */
  localPath(): Promise<string>;
  /** 网络 URL 形态:客户端可达展示 URL。 */
  url(opts?: { expiresInMs?: number }): Promise<string>;
}

/**
 * `putOutput(...)` 作者入参:产出字节 + 描述符元数据。
 *
 * **不含** `sessionId`/`origin`/`size`:`sessionId` 由上下文以当前会话闭包注入,
 * `origin` 固定 `"tool-output"`,`size` 由字节长度内部计算。
 */
export interface PutOutputInput {
  /** 产出物字节(已物化的 `Uint8Array`)。 */
  readonly bytes: Uint8Array;
  readonly name: string;
  readonly mimeType: string;
}

/**
 * tool 接入上下文:工具在其 `execute` 逻辑内取得子进程 store 句柄的接入面(Req 4.1)。
 *
 * 由 `@blksails/pi-web-server` 的 `createAttachmentToolContext(store, sessionId)` 构造并经
 * runner 装配注入到 tool;tool 作者经 `@blksails/pi-web-agent-kit` 引用本类型。
 *
 * - `available`:存储能力是否可用。env 缺失/未配置附件存储时为 `false`(Req 3.4);
 *   此时 `resolve`/`putOutput` 安全拒绝(抛可识别错误),tool 据此报「附件能力不可用」。
 * - `resolve(id)`:L2 投影,按公开 id 解析输入附件(属主已由 `beforeToolCall` 前置保证)。
 * - `putOutput(...)`:把产出物先落库(`origin:"tool-output"`,当前会话属主)再以引用回流。
 *
 * @typeParam THandle 解析句柄类型,默认 {@link AttachmentToolHandle};服务端实现以其
 *   `AttachmentHandle`(含 `stream()`)实例化,该类型是本默认的结构超集。
 */
export interface AttachmentToolContext<
  THandle extends AttachmentToolHandle = AttachmentToolHandle,
> {
  /** 存储能力是否可用(env 缺失为 `false`,Req 4.1/3.4)。 */
  readonly available: boolean;
  /** 按公开 id 解析输入附件(Req 4.1);不可用时安全拒绝(抛可识别错误)。 */
  resolve(id: string): Promise<THandle>;
  /** 把产出物先落库(`tool-output`,当前会话属主)再以引用回流;不可用时安全拒绝。 */
  putOutput(input: PutOutputInput): Promise<ToolOutputRef>;
  /**
   * 与 `putOutput` 同样先落库(`tool-output`,当前会话属主)再以引用回流,额外向主进程
   * 广播一次「新增附件」推送事件(agent-attachment-catalog spec,Req 4.1),使已连接的前端
   * 免刷新即时感知(经 SSE `control:"attachment"`)。适合 agent 在运行期(不只是响应工具调用)
   * 主动产出用户可见产物的场景。不可用时安全拒绝(抛可识别错误)。
   */
  publish(input: PutOutputInput): Promise<ToolOutputRef>;
  /**
   * 枚举**当前会话**的附件描述符(不含字节;领域无关的枚举 seam,供上层 surface 如 Canvas
   * 做 hydrate 重建)。不可用时安全拒绝(抛可识别错误)。
   */
  listBySession(): Promise<Attachment[]>;
  /**
   * 读回某附件的不透明扩展 meta(领域无关,attachment 层不解释内容;供上层承载如
   * `{derivedFrom,genParams}` 等血缘/派生信息)。不存在或未曾写入返回 `undefined`;
   * 不可用时安全拒绝(抛可识别错误)。
   */
  getMeta(id: string): Promise<Record<string, unknown> | undefined>;
  /**
   * 写入某附件的不透明扩展 meta(整体覆盖,attachment 层不解释内容,原样持久)。
   * 不可用时安全拒绝(抛可识别错误)。
   */
  setMeta(id: string, meta: Record<string, unknown>): Promise<void>;
}
