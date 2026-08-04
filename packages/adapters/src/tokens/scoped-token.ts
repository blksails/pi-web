/**
 * tokens · 分面 scoped token 签发/校验原语(design.md ScopedToken,Req 1.1-1.6)。
 *
 * 每个启用 token 代理认证的服务面(如每个 LLM provider)按会话独立签发一枚短期 token:
 * 线格式 `pw2.<scope>.<sessionId>.<exp>.<sigHex>`,
 * `sig = HMAC-SHA256(secret, "pi-token.v2." + scope + "." + sessionId + "." + exp)` hex。
 *
 * 签名域前缀 `pi-token.v2.` 与 `attachment/url-signer.ts`(附件签名 URL)、既有
 * `aigc-proxy/session-token.ts`(`aigc-proxy.v1.`)的签名域全部隔离——即便三者共用同一 secret,
 * 产物也不可互换互认。
 *
 * 与会话短期 token(aigc-proxy)的区别:本原语多一个 `scope` 维度,校验时除格式/过期/签名外还
 * 须**逐字**匹配 `expectedScope`(Req 1.3),用于把同一会话下不同服务面(如 `llm:newapi` /
 * `llm:sufy`)的 token 相互隔离——即便二者由同一会话签发、共用同一 secret,校验方也必须按路径
 * /调用点声明的 expectedScope 拒绝 scope 不符的 token(scope-mismatch)。
 *
 * 校验顺序:格式 → 过期(`nowMs` 可注入,便于测试)→ scope 逐字等于 expectedScope →
 * `timingSafeEqual` 常量时间比对;任一步失败返回判别原因(`malformed | expired |
 * scope-mismatch | bad-signature`),不抛——原因仅进服务端日志,对外响应不区分细节(防探测,
 * Req 1.6)。
 */
import { createHmac, timingSafeEqual } from "node:crypto";

/** HMAC 摘要算法。 */
const HMAC_ALG = "sha256";

/** token 版本前缀(格式首段,便于未来演进版本号)。 */
const TOKEN_PREFIX = "pw2";

/** 签名域前缀(与 attachment/url-signer、aigc-proxy/session-token 的签名域隔离)。 */
const SIGNATURE_DOMAIN = "pi-token.v2.";

/** scoped token 校验失败的判别原因。 */
export type ScopedTokenFailureReason =
  | "malformed"
  | "expired"
  | "scope-mismatch"
  | "bad-signature";

/** 分面 scoped token 的签发/校验服务(design.md ScopedTokenService 契约)。 */
export interface ScopedTokenService {
  /** 签发:`exp = Date.now() + ttlMs`;ttlMs 由调用方按沙盒最大存活时间给出。 */
  mintScopedToken(input: {
    scope: string;
    sessionId: string;
    ttlMs: number;
    secret: string | Buffer;
  }): string;
  /** 校验:成功返回所属会话/scope/exp;失败返回判别原因,不抛。 */
  verifyScopedToken(input: {
    token: string;
    expectedScope: string;
    secret: string | Buffer;
    nowMs?: number;
  }):
    | { ok: true; sessionId: string; scope: string; exp: number }
    | { ok: false; reason: ScopedTokenFailureReason };
}

/** 对签名域内容计算 hex HMAC 摘要。 */
function digest(
  secret: string | Buffer,
  scope: string,
  sessionId: string,
  exp: number,
): string {
  return createHmac(HMAC_ALG, secret)
    .update(`${SIGNATURE_DOMAIN}${scope}.${sessionId}.${exp}`)
    .digest("hex");
}

/**
 * 签发 scoped token。
 *
 * `scope`/`sessionId` 含 `.`(token 字段分隔符)会与其余字段边界冲突,故在签发路径直接拒签
 * 抛错——校验路径不承担这类防御,交由签发侧保证输入干净。
 *
 * @param input.scope 服务面作用域,形如 `llm:<providerId>`;不得含 `.`。
 * @param input.sessionId 会话标识,不得含 `.`。
 * @param input.ttlMs 有效期(毫秒),`exp = Date.now() + ttlMs`。
 * @param input.secret HMAC 签名 secret。
 */
export function mintScopedToken(input: {
  scope: string;
  sessionId: string;
  ttlMs: number;
  secret: string | Buffer;
}): string {
  const { scope, sessionId, ttlMs, secret } = input;
  if (scope.includes(".")) {
    throw new Error(
      `[tokens] scope 不得包含 "."(与 token 字段分隔符冲突):${scope}`,
    );
  }
  if (sessionId.includes(".")) {
    throw new Error(
      `[tokens] sessionId 不得包含 "."(与 token 字段分隔符冲突):${sessionId}`,
    );
  }
  const exp = Date.now() + ttlMs;
  const sig = digest(secret, scope, sessionId, exp);
  return `${TOKEN_PREFIX}.${scope}.${sessionId}.${exp}.${sig}`;
}

/**
 * 校验 scoped token。
 *
 * 顺序:格式(前缀 + 5 段 + exp 数值合法)→ 过期(`nowMs` 可注入便于测试)→ scope 逐字等于
 * `expectedScope` → `timingSafeEqual` 常量时间签名比对。任一步失败返回判别原因,不抛。
 *
 * @param input.token 待校验 token 原文。
 * @param input.expectedScope 调用点声明的期望作用域,逐字匹配;不符即 scope-mismatch。
 * @param input.secret HMAC 签名 secret。
 * @param input.nowMs 注入的当前时刻(默认 `Date.now()`),便于测试构造过期场景。
 */
export function verifyScopedToken(input: {
  token: string;
  expectedScope: string;
  secret: string | Buffer;
  nowMs?: number;
}):
  | { ok: true; sessionId: string; scope: string; exp: number }
  | { ok: false; reason: ScopedTokenFailureReason } {
  const { token, expectedScope, secret, nowMs = Date.now() } = input;

  const parts = token.split(".");
  if (parts.length !== 5 || parts[0] !== TOKEN_PREFIX) {
    return { ok: false, reason: "malformed" };
  }
  const [, scope, sessionId, expRaw, sig] = parts;
  if (!scope || !sessionId || !expRaw || !sig) {
    return { ok: false, reason: "malformed" };
  }
  const exp = Number(expRaw);
  if (!Number.isFinite(exp)) {
    return { ok: false, reason: "malformed" };
  }

  if (exp < nowMs) {
    return { ok: false, reason: "expired" };
  }

  if (scope !== expectedScope) {
    return { ok: false, reason: "scope-mismatch" };
  }

  const expected = digest(secret, scope, sessionId, exp);
  // 常量时间比较:长度不一致(含篡改导致的非 hex/变长)直接判定失败,不抛。
  const a = Buffer.from(sig, "utf8");
  const b = Buffer.from(expected, "utf8");
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return { ok: false, reason: "bad-signature" };
  }

  return { ok: true, sessionId, scope, exp };
}
