/**
 * 单键值上限的装配期解析(spec: host-contract-ports,任务 2.2;Req 3.1-3.3)。
 *
 * 权威依据:`docs/pi-web-host-contract-v1.md` §3.2.1。
 *
 * 三段式 env 契约(沿用 `ai-gateway/config.ts` 与 `attachment/backends-config.ts` 的既有惯例):
 *  - 未设 / 空白 → 采用默认值(功能正常,零行为变化);
 *  - 设置但非法 → **装配期抛类型化错误**,不静默回落默认;
 *  - 签名收 `env: NodeJS.ProcessEnv` 而非直读 `process.env`,便于注入测试。
 *
 * 「非法即抛而非回落默认」是刻意的:若静默回落,运维把上限写错(如误写 `1MB`)时系统会以
 * 一个他并未选择的值运行,且无任何信号——上限这类容量参数一旦悄悄失效,故障会在很久之后
 * 以「写入莫名被拒」的形态出现,届时已无从追溯到这行配置。
 *
 * ⚠ 上限**只在写路径校验**(Req 3.4/3.5)。读路径永不校验——否则把上限调小之后,既有的
 * 超限值将无法读出:数据仍在存储中却不可达,且用户无法自救(要缩小它必须先读到它)。
 *
 * 纯函数 + 常量,pi-SDK-free。
 */

/** 单键值上限的环境变量名。 */
export const WORKSPACE_MAX_VALUE_BYTES_ENV = "PI_WEB_WORKSPACE_MAX_VALUE_BYTES";

/** 默认单键值上限:1 MiB。 */
export const DEFAULT_WORKSPACE_MAX_VALUE_BYTES = 1_048_576;

/**
 * 上限配置非法(装配期)。
 *
 * ⚠ 与 `WorkspaceError` 的四个运行期判别码(`key`/`limit`/`corrupt`/`io`)**不同类**:
 * 那四类描述运行期的存储操作失败,本类描述装配期的配置错误——后者应导致启动失败,
 * 不应被当作可降级的运行期故障捕获。故刻意不并入那套判别码。
 */
export class WorkspaceConfigError extends Error {
  constructor(
    public readonly envName: string,
    public readonly rawValue: string,
    reason: string,
  ) {
    super(`invalid ${envName}=${JSON.stringify(rawValue)}: ${reason}`);
    this.name = "WorkspaceConfigError";
  }
}

/**
 * 解析单键值上限(Req 3.1-3.3)。
 *
 * @returns 未设/空白 → {@link DEFAULT_WORKSPACE_MAX_VALUE_BYTES};已设正整数 → 该值。
 * @throws {WorkspaceConfigError} 值不可解析、非整数或不为正。
 */
export function resolveWorkspaceValueLimit(env: NodeJS.ProcessEnv): number {
  const raw = env[WORKSPACE_MAX_VALUE_BYTES_ENV];
  if (raw === undefined || raw.trim().length === 0) {
    return DEFAULT_WORKSPACE_MAX_VALUE_BYTES;
  }

  const trimmed = raw.trim();
  // 刻意不用 parseInt:它会把 "1MB" 解析成 1 而静默吞掉单位后缀 —— 那正是本模块要
  // 拒绝的那类错误。Number() 对含非数字字符的串返回 NaN,能被下面的分支抓住。
  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed)) {
    throw new WorkspaceConfigError(
      WORKSPACE_MAX_VALUE_BYTES_ENV,
      raw,
      "expected a positive integer number of bytes",
    );
  }
  if (!Number.isInteger(parsed)) {
    throw new WorkspaceConfigError(
      WORKSPACE_MAX_VALUE_BYTES_ENV,
      raw,
      "expected an integer, got a fractional value",
    );
  }
  if (parsed <= 0) {
    throw new WorkspaceConfigError(
      WORKSPACE_MAX_VALUE_BYTES_ENV,
      raw,
      "expected a positive value",
    );
  }
  return parsed;
}
