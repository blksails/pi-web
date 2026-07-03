/**
 * attachment-tool-bridge · tool 接入上下文 `createAttachmentToolContext`
 * (task 4.1;Req 4.1, 3.3, 3.4)。
 *
 * 让运行在 runner 子进程的 tool 在其 `execute` 逻辑内取得**子进程 store 句柄**的接入面:
 * 解析输入附件(`resolve`)、落库产出附件(`putOutput`)、可用性标记(`available`)。
 * 由 runner 装配 `customTools` 时以闭包绑定**子进程 store**(由 `createChildAttachmentStore`
 * 实例化)+ 当前 `sessionId` 构造后注入到 tool;子进程内直接访问后端、**不回调主进程**(Req 3.3)。
 *
 * 设计约束(design.md §AttachmentToolContext + 示例 AgentTool · Error Handling):
 * - **可用性降级**:store 为 `undefined`(env 缺失/未配置附件存储,见
 *   {@link createChildAttachmentStore})→ `available === false`,且 `resolve`/`putOutput`
 *   以可 `instanceof` 识别的 {@link AttachmentCapabilityUnavailableError} **安全拒绝**,
 *   而非以未定义行为崩溃子进程(Req 3.4)。tool 据此早返回「附件能力不可用」。
 * - **委托既有切片,不重定义**:`resolve` 委托 {@link resolveAttachment}(task 2.2);
 *   `putOutput` 委托 {@link putToolOutput}(task 3.3),`sessionId` 由上下文以当前会话闭包
 *   注入(`origin:"tool-output"` 固定、`size` 内部计算),作者入参不含 `sessionId`。
 * - **构造留在 server 侧**:类型契约经 `@blksails/pi-web-agent-kit` 暴露给 tool 作者(仅类型,无值导入);
 *   本工厂(值)留在 `@blksails/pi-web-server`,与作者面 `AttachmentToolContext` 结构兼容。
 */
import type { Attachment } from "@blksails/pi-web-protocol";
import type { ChildAttachmentStore } from "./child-store.js";
import type { AttachmentHandle } from "./attachment-handle.js";
import { resolveAttachment } from "./resolve.js";
import { putToolOutput, type ToolOutputRef } from "./tool-output.js";

/**
 * `putOutput(...)` 入参:产出字节 + 描述符元数据。
 *
 * **不含** `sessionId`/`origin`/`size`:`sessionId` 由上下文以当前会话闭包注入,
 * `origin` 固定 `"tool-output"`,`size` 由字节长度内部计算(见 {@link putToolOutput})。
 */
export interface PutOutputInput {
  /** 产出物字节(已物化的 `Uint8Array`)。 */
  readonly bytes: Uint8Array;
  readonly name: string;
  readonly mimeType: string;
}

/**
 * tool 接入上下文:工具在其 `execute` 内取得子进程 store 句柄的接入面(Req 4.1)。
 *
 * 与 `@blksails/pi-web-agent-kit` 暴露的作者面 `AttachmentToolContext` 结构兼容(此处的
 * {@link AttachmentHandle} 是作者面 `AttachmentToolHandle` 的结构超集,含 `stream()`)。
 */
export interface AttachmentToolContext {
  /** 存储能力是否可用(store 缺失为 `false`,Req 4.1/3.4)。 */
  readonly available: boolean;
  /**
   * 按公开 id 解析输入附件 → {@link AttachmentHandle}(Req 4.1)。
   * 属主已由 `beforeToolCall` 前置保证;能力不可用时抛
   * {@link AttachmentCapabilityUnavailableError}(安全拒绝,不崩溃)。
   */
  resolve(id: string): Promise<AttachmentHandle>;
  /**
   * 把产出物先落库(`origin:"tool-output"`、当前会话属主)再以引用回流 → {@link ToolOutputRef}(Req 4.1)。
   * 能力不可用时抛 {@link AttachmentCapabilityUnavailableError}(安全拒绝,不崩溃)。
   */
  putOutput(input: PutOutputInput): Promise<ToolOutputRef>;
  /**
   * 枚举**当前会话**(上下文闭包绑定的 sessionId,与 `putOutput` 属主一致)的附件描述符
   * (不含字节;领域无关的枚举 seam,供上层 surface 如 Canvas 做 hydrate 重建)。
   * 能力不可用时抛 {@link AttachmentCapabilityUnavailableError}(安全拒绝,不崩溃)。
   */
  listBySession(): Promise<Attachment[]>;
  /**
   * 读回某附件的不透明扩展 meta(领域无关,attachment 层不解释内容;供上层承载如
   * `{derivedFrom,genParams}` 等血缘/派生信息)。不存在或未曾写入返回 `undefined`。
   * 能力不可用时抛 {@link AttachmentCapabilityUnavailableError}(安全拒绝,不崩溃)。
   */
  getMeta(id: string): Promise<Record<string, unknown> | undefined>;
  /**
   * 写入某附件的不透明扩展 meta(整体覆盖,attachment 层不解释内容,原样持久)。
   * 能力不可用时抛 {@link AttachmentCapabilityUnavailableError}(安全拒绝,不崩溃)。
   */
  setMeta(id: string, meta: Record<string, unknown>): Promise<void>;
}

/**
 * 存储能力不可用错误:`available === false` 时 `resolve`/`putOutput` 被调用而抛出(Req 3.4)。
 *
 * 可经 `instanceof` 识别、是 `Error` 子类,使 tool `execute` 能据此早返回「附件能力不可用」,
 * 而非以未定义行为崩溃子进程。风格与上游可识别错误(`AttachmentResolveError`/`ToolOutputPutError`)一致。
 */
export class AttachmentCapabilityUnavailableError extends Error {
  constructor() {
    super("attachment capability unavailable: store not configured");
    this.name = "AttachmentCapabilityUnavailableError";
  }
}

/**
 * 构造 tool 接入上下文(Req 4.1/3.3/3.4)。
 *
 * @param store     子进程 store 客户端(上游门面),由 {@link createChildAttachmentStore} 实例化;
 *                  `undefined` 表示存储能力不可用(env 缺失降级)。
 * @param sessionId 当前会话 id(以闭包绑定,作为 `putOutput` 落库描述符属主)。
 * @returns 与作者面 `AttachmentToolContext`(`@blksails/pi-web-agent-kit`)结构兼容的上下文。
 */
export function createAttachmentToolContext(
  store: ChildAttachmentStore | undefined,
  sessionId: string,
): AttachmentToolContext {
  const available = store !== undefined;
  return {
    available,
    async resolve(id: string): Promise<AttachmentHandle> {
      if (store === undefined) {
        // 安全拒绝:不可用时不静默返回空,而以可识别错误暴露(Req 3.4)。
        throw new AttachmentCapabilityUnavailableError();
      }
      return resolveAttachment(store, id);
    },
    async putOutput(input: PutOutputInput): Promise<ToolOutputRef> {
      if (store === undefined) {
        throw new AttachmentCapabilityUnavailableError();
      }
      // sessionId 由上下文注入(作者入参不含);origin/size 由 putToolOutput 内部决定。
      return putToolOutput(store, {
        bytes: input.bytes,
        name: input.name,
        mimeType: input.mimeType,
        sessionId,
      });
    },
    async listBySession(): Promise<Attachment[]> {
      if (store === undefined) {
        throw new AttachmentCapabilityUnavailableError();
      }
      return store.listBySession(sessionId);
    },
    async getMeta(id: string): Promise<Record<string, unknown> | undefined> {
      if (store === undefined) {
        throw new AttachmentCapabilityUnavailableError();
      }
      return store.getMeta(id);
    },
    async setMeta(id: string, meta: Record<string, unknown>): Promise<void> {
      if (store === undefined) {
        throw new AttachmentCapabilityUnavailableError();
      }
      return store.setMeta(id, meta);
    },
  };
}

/**
 * 别名:作者面契约的服务端等价类型导出便利。
 *
 * 不与 `@blksails/pi-web-agent-kit` 的作者面类型混淆 —— server 不依赖 agent-kit,故此处自持
 * 结构兼容契约(`@blksails/pi-web-agent-kit` 侧独立声明同形作者面类型)。
 */
export type { ToolOutputRef } from "./tool-output.js";
