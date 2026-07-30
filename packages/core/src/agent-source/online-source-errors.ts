/**
 * online-source-errors(spec: desktop-online-source-runnable,任务 4.2)——
 * 线上源安装失败的**领域词汇**与错误类型。
 *
 * ## 为什么定义在 packages/server 而非应用层
 *
 * 失败码是领域词汇(「未认证」「未找到」「形态不支持」),不是实现细节 —— 纯数据、零依赖,
 * 因此不违反「registry-client 不得进入包内」的铁律。放在包内的实际收益:`mapEngineError`
 * 得以 `instanceof` 判别并映射到合适的 HTTP 状态码。
 *
 * 若把错误类留在应用层,包内的错误映射就只能靠字符串鸭子类型(`err.name === "..."`)去猜,
 * 那是更脆的耦合。
 *
 * ## 为什么必须做这层映射(实施期发现)
 *
 * 真机烟雾证实:`mapEngineError` 对未映射错误一律兜底 `500 INTERNAL`,响应体只有
 * 「Internal server error.」。用户选中一个线上源却未登录时,看到的是「服务器内部错误」——
 * 既不可诊断(违反 Req 4.1),也没告诉他该去登录(违反 Req 5.1)。
 */

/** 安装失败分类;与应用层安装端口的 `InstallFailure.code` 同一套词汇。 */
export type OnlineSourceFailureCode =
  | "NOT_AUTHENTICATED"
  | "GRANT_UNAVAILABLE"
  | "NOT_FOUND"
  | "UNSUPPORTED_DISTRIBUTION"
  | "DOWNLOAD_FAILED"
  | "EXTRACT_FAILED"
  | "INTEGRITY_MISMATCH"
  | "TARGET_OCCUPIED"
  | "INSTALL_BACKEND_UNAVAILABLE";

/**
 * 线上源安装失败。
 *
 * 携带结构化 `failureCode` 而非仅一句话:前端据此区分「需登录」「未找到」「不支持」等
 * 不同处置(Req 4.1),压成同一种错误会让用户无从下手。
 */
export class OnlineSourceInstallError extends Error {
  readonly failureCode: OnlineSourceFailureCode;
  /** 触发本次失败的可提交源标识(`sourceId@channel`),用于诊断。不含任何凭据。 */
  readonly source: string;

  constructor(source: string, failureCode: OnlineSourceFailureCode, message?: string) {
    super(message ?? `无法使用线上源 ${source}: ${failureCode}`);
    this.name = "OnlineSourceInstallError";
    this.failureCode = failureCode;
    this.source = source;
  }
}

/**
 * 失败码 → HTTP 状态码。
 *
 * 分档依据「谁能修」:
 *  - 4xx —— 调用方可自行处置(去登录、换标识、清理目录);
 *  - 502 —— 上游注册表或本机运行环境的问题,重试或换环境才可能好转,不是调用方的错。
 */
export function onlineSourceFailureStatus(code: OnlineSourceFailureCode): number {
  switch (code) {
    case "NOT_AUTHENTICATED":
      return 401;
    case "NOT_FOUND":
      return 404;
    case "UNSUPPORTED_DISTRIBUTION":
      return 400;
    case "TARGET_OCCUPIED":
      return 409;
    case "GRANT_UNAVAILABLE":
    case "DOWNLOAD_FAILED":
    case "EXTRACT_FAILED":
    case "INTEGRITY_MISMATCH":
    case "INSTALL_BACKEND_UNAVAILABLE":
      return 502;
  }
}
