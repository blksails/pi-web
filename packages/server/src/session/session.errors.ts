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

/** 创建会话时缺少必需注入入参(Req 1.5)。 */
export class MissingInputError extends Error {
  readonly code = "MISSING_INPUT" as const;
  constructor(field: string) {
    super(`Cannot create session: missing required input "${field}".`);
    this.name = "MissingInputError";
  }
}
