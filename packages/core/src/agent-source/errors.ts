/** agent-source-resolver — 可识别错误类型。错误信息绝不包含 env 敏感值。 */

/** 源类型不可识别(Req 1.5)。 */
export class SourceKindError extends Error {
  override readonly name = "SourceKindError";
  readonly source: string;
  constructor(source: string) {
    super(`Unrecognized agent source: ${JSON.stringify(source)}`);
    this.source = source;
  }
}

/** git 克隆/更新失败(Req 2.6 / 7.3)。原因摘要不含 env 敏感值。 */
export class GitResolveError extends Error {
  override readonly name = "GitResolveError";
  readonly source: string;
  readonly ref: string;
  constructor(source: string, ref: string, reason: string) {
    super(`Failed to resolve git source ${source}@${ref}: ${reason}`);
    this.source = source;
    this.ref = ref;
  }
}

/** package.json#pi-web.entry 覆盖指向不存在的文件(Req 3.3),不静默回退。 */
export class EntryOverrideError extends Error {
  override readonly name = "EntryOverrideError";
  readonly overridePath: string;
  constructor(overridePath: string) {
    super(`package.json#pi-web.entry override points to a missing file: ${overridePath}`);
    this.overridePath = overridePath;
  }
}

/**
 * spawnSpec 装配缺少必需入口(runnerEntry / piCliEntry 未注入)。
 * 在装配阶段早退,避免子进程指向占位路径秒崩导致会话丢失 → 404。
 * 错误信息绝不含 env 敏感值。
 */
export class AgentSourceError extends Error {
  override readonly name = "AgentSourceError";
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}
