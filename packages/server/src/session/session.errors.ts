/**
 * session-engine — 会话层错误类型(可识别、不产半初始化)。
 */

/** 在已停止/停止中的会话上调用命令转发或订阅(Req 2.4 / 7.6)。 */
export class SessionStoppedError extends Error {
  readonly code = "SESSION_STOPPED" as const;
  constructor(sessionId?: string) {
    super(
      sessionId
        ? `Session "${sessionId}" is stopped; operation rejected.`
        : "Session is stopped; operation rejected.",
    );
    this.name = "SessionStoppedError";
  }
}

/** 按不存在的 sessionId 检索的上层语义错误(Req 9.5 的上层封装)。 */
export class SessionNotFoundError extends Error {
  readonly code = "SESSION_NOT_FOUND" as const;
  constructor(sessionId: string) {
    super(`Session "${sessionId}" not found.`);
    this.name = "SessionNotFoundError";
  }
}

/** 对不存在/已回复的扩展 UI 请求 ID 提交回复(Req 5.3)。 */
export class UnknownExtensionUIError extends Error {
  readonly code = "UNKNOWN_EXTENSION_UI" as const;
  constructor(id: string) {
    super(`No pending extension UI request for id "${id}".`);
    this.name = "UnknownExtensionUIError";
  }
}

/**
 * agent-declared-routes:route 调用在转发超时时限内未收到子进程结果帧(Req 3.4)。
 * HTTP 层(agent-route-routes,task 3.2)据此可判别地映射 504 `ROUTE_TIMEOUT`。
 */
export class AgentRouteTimeoutError extends Error {
  readonly code = "ROUTE_TIMEOUT" as const;
  constructor(name: string, timeoutMs: number) {
    super(`Agent route "${name}" timed out after ${timeoutMs}ms.`);
    this.name = "AgentRouteTimeoutError";
  }
}

/**
 * agent-attachment-catalog:catalog 请求(list/materialize)在转发超时时限内未收到子进程
 * 结果帧(design.md §Error Handling)。物化端点(task 4.2)据此可判别地映射 504 `CATALOG_TIMEOUT`;
 * catalog provider(task 4.1)据此把 list 超时降级为空组(Req 2.4)。
 */
export class AttachmentCatalogTimeoutError extends Error {
  readonly code = "CATALOG_TIMEOUT" as const;
  constructor(op: "list" | "materialize", timeoutMs: number) {
    super(`Attachment catalog "${op}" timed out after ${timeoutMs}ms.`);
    this.name = "AttachmentCatalogTimeoutError";
  }
}

/** 创建会话时缺少必需注入入参(Req 1.5)。 */
export class MissingInputError extends Error {
  readonly code = "MISSING_INPUT" as const;
  constructor(field: string) {
    super(`Cannot create session: missing required input "${field}".`);
    this.name = "MissingInputError";
  }
}
