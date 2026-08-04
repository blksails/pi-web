/**
 * 通道错误类型与诊断记录形状(Req 2.4, 4.5, 4.6, 6.3, 6.5)。
 *
 * 供 PiRpcProcess 拒绝待决命令与上报可观察诊断使用。错误类型携带可被上层
 * 判别的 `name`,使 session-engine 能区分 spawn 失败 / 通道关闭 / 子进程崩溃。
 */

/** spawn 子进程失败(命令不存在或无法执行)——构造/启动期传播(Req 2.4)。 */
export class SpawnError extends Error {
  override readonly name = "SpawnError";
  constructor(
    message: string,
    /** 触发本错误的底层原因(若有)。 */
    override readonly cause?: unknown,
  ) {
    super(message);
  }
}

/** 通道已关闭——`close()` 后拒绝待决命令、之后命令方法立即拒绝(Req 6.3)。 */
export class ChannelClosedError extends Error {
  override readonly name = "ChannelClosedError";
  constructor(message = "RPC channel is closed") {
    super(message);
  }
}

/** 子进程异常崩溃/退出——退出码非 0 或被信号终止时拒绝待决(Req 6.2 / 6.5)。 */
export class ChildCrashError extends Error {
  override readonly name = "ChildCrashError";
  constructor(
    /** 退出码(被信号终止时为 null)。 */
    readonly code: number | null,
    /** 终止信号名(正常退出时为 null)。 */
    readonly signal: string | null,
    message?: string,
  ) {
    super(
      message ??
        `RPC child process exited (code=${String(code)}, signal=${String(signal)})`,
    );
  }
}

/** 可观察诊断记录类别(经 onDiagnostic 暴露,不静默吞掉,Req 4.5 / 4.6)。 */
export type DiagnosticKind =
  | "parse_error" // 一行 stdout 无法解析为合法 JSON(Req 4.6)
  | "orphan_response" // 响应 id 无对应待决请求(Req 4.5)
  | "unknown_message"; // 解析成功但不属于三类消息

/** 诊断记录形状:可被上层用于日志/排障,不含敏感命令负载。 */
export interface Diagnostic {
  readonly kind: DiagnosticKind;
  readonly message: string;
  /** 触发诊断的原始行(截断保护交由上层日志策略)。 */
  readonly line?: string;
}
