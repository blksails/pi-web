/**
 * extension-management — 安装审计接缝 + 脱敏记录构造(Req 8.x/9.3)。
 *
 * 每次安装 / 卸载(成功 / 失败 / 被拒绝)均产一条审计记录(Req 8.1/8.4),记录构造剥离
 * env 敏感值与凭据(Req 8.2/9.3)。`onAudit` 接缝默认实现至少结构化输出(stderr),生产
 * 可替换为持久化落库(Req 8.3,§11.7)。
 */
import type { AuthContext } from "../../http/index.js";
import type { AuditRecord, OnAudit } from "../ext.types.js";

/** 从鉴权上下文提取操作者标识(匿名 → "anonymous")。 */
export function actorOf(auth: AuthContext): string {
  if (auth.anonymous || auth.userId === undefined) {
    return "anonymous";
  }
  return auth.userId;
}

/** 已知敏感 env 键(凭据 / token);脱敏时从 reason 中剥离匹配片段。 */
const SENSITIVE_PATTERNS: readonly RegExp[] = [
  /(?:api[_-]?key|secret|token|password|passwd|credential)s?\s*[:=]\s*\S+/gi,
  // git URL 内联凭据 https://user:token@host → 去 user:token@
  /(https?:\/\/)[^/@\s]+@/gi,
  // ssh:// 内联 user@(保留 host)
  /(ssh:\/\/)[^/@\s]+@/gi,
];

/** 剥离原因摘要中的敏感片段(Req 9.3)。 */
export function redactReason(reason: string): string {
  let out = reason;
  out = out.replace(SENSITIVE_PATTERNS[0]!, (m) => {
    const eq = m.search(/[:=]/);
    return eq >= 0 ? `${m.slice(0, eq + 1)} [redacted]` : "[redacted]";
  });
  out = out.replace(SENSITIVE_PATTERNS[1]!, "$1[redacted]@");
  out = out.replace(SENSITIVE_PATTERNS[2]!, "$1[redacted]@");
  return out;
}

/** 构造一条脱敏审计记录。 */
export function buildAuditRecord(input: {
  readonly auth: AuthContext;
  readonly action: "install" | "remove";
  readonly source: string;
  readonly outcome: "success" | "failure" | "rejected";
  readonly reason?: string;
  readonly now?: () => Date;
}): AuditRecord {
  const at = (input.now ?? (() => new Date()))().toISOString();
  const base: AuditRecord = {
    actor: actorOf(input.auth),
    at,
    action: input.action,
    source: input.source,
    outcome: input.outcome,
  };
  if (input.reason !== undefined) {
    return { ...base, reason: redactReason(input.reason) };
  }
  return base;
}

/** 默认审计接缝:结构化输出到 stderr(生产可替换为落库)。 */
export const defaultOnAudit: OnAudit = (record: AuditRecord): void => {
  // 结构化单行 JSON,便于日志采集;不含 env 敏感值(构造时已脱敏)。
  process.stderr.write(`[ext-audit] ${JSON.stringify(record)}\n`);
};
