/**
 * aigc-proxy · 会话短期凭据(签发/校验,Req 3.1, 3.2, 3.3, 3.4)。
 *
 * e2b 沙盒内 aigc 工具不再持有真实 provider key,改持一枚与会话绑定、可过期的短期
 * token:格式 `pwap1.<sessionId>.<exp>.<sigHex>`,
 * `sig = HMAC-SHA256(secret, "aigc-proxy.v1." + sessionId + "." + exp)`。
 *
 * 签名域前缀 `aigc-proxy.v1.` 与 `attachment/url-signer.ts` 的签名 URL 隔离——即便两者共用
 * 同一 secret(见 {@link resolveAigcProxySecret} 的回退顺序),token 与签名 URL 也不可互换
 * (design.md Security Considerations)。
 *
 * 校验顺序为格式 → 过期 → 签名(`timingSafeEqual` 常量时间比较),全部通过才返回
 * sessionId;任何一步失败都返回可判别原因,不抛(代理路由据此短路映射 401,不区分对外
 * 文案防探测,原因仅进服务端日志)。
 *
 * secret 解析优先 `PI_WEB_AIGC_PROXY_SECRET`,回退 `PI_WEB_ATTACHMENT_SECRET`(复用附件系统
 * 已建立的主/子进程 secret 分发通道);两者皆缺时抛清晰错误——代理模式下 secret 必须稳定
 * (不可随机回退,否则沙盒签发的 token 主进程校验必失败)。
 */
import { createHmac, timingSafeEqual } from "node:crypto";

/** HMAC 摘要算法。 */
const HMAC_ALG = "sha256";

/** token 版本前缀(格式首段,便于未来演进版本号)。 */
const TOKEN_PREFIX = "pwap1";

/** 签名域前缀(与附件签名 URL 的签名域隔离)。 */
const SIGNATURE_DOMAIN = "aigc-proxy.v1.";

/** 本模块专属 secret 环境变量名。 */
const AIGC_PROXY_SECRET_ENV = "PI_WEB_AIGC_PROXY_SECRET";

/** 回退复用的附件系统 secret 环境变量名。 */
const ATTACHMENT_SECRET_ENV = "PI_WEB_ATTACHMENT_SECRET";

/** 会话 token 校验失败的判别原因。 */
export type SessionTokenFailureReason = "malformed" | "expired" | "bad-signature";

/** 会话 token 的签发/校验服务(design.md AigcProxyTokenService 契约)。 */
export interface AigcProxyTokenService {
  /** 签发:`exp = now + ttlMs`;ttlMs 由调用方按沙盒最大存活时间给出。 */
  mintSessionToken(input: {
    sessionId: string;
    ttlMs: number;
    secret: string | Buffer;
  }): string;
  /** 校验:成功返回所属会话,失败返回原因(malformed | expired | bad-signature)。 */
  verifySessionToken(input: {
    token: string;
    secret: string | Buffer;
    nowMs?: number;
  }):
    | { ok: true; sessionId: string; exp: number }
    | { ok: false; reason: SessionTokenFailureReason };
}

/** 对签名域内容计算 hex HMAC 摘要。 */
function digest(secret: string | Buffer, sessionId: string, exp: number): string {
  return createHmac(HMAC_ALG, secret)
    .update(`${SIGNATURE_DOMAIN}${sessionId}.${exp}`)
    .digest("hex");
}

/**
 * 签发会话 token。
 *
 * sessionId 含 `.`(token 字段分隔符)会与 exp/sig 边界冲突,故在签发路径直接拒签抛错——
 * 校验路径不承担这类防御,交由签发侧保证输入干净。
 *
 * @param input.sessionId 会话标识,不得含 `.`。
 * @param input.ttlMs 有效期(毫秒),`exp = Date.now() + ttlMs`。
 * @param input.secret HMAC 签名 secret。
 */
export function mintSessionToken(input: {
  sessionId: string;
  ttlMs: number;
  secret: string | Buffer;
}): string {
  const { sessionId, ttlMs, secret } = input;
  if (sessionId.includes(".")) {
    throw new Error(
      `[aigc-proxy] sessionId 不得包含 "."(与 token 字段分隔符冲突):${sessionId}`,
    );
  }
  const exp = Date.now() + ttlMs;
  const sig = digest(secret, sessionId, exp);
  return `${TOKEN_PREFIX}.${sessionId}.${exp}.${sig}`;
}

/**
 * 校验会话 token。
 *
 * 顺序:格式(前缀 + 4 段 + exp 数值合法)→ 过期(`nowMs` 可注入便于测试)→
 * `timingSafeEqual` 常量时间签名比对。任一步失败返回判别原因,不抛。
 *
 * @param input.token 待校验 token 原文。
 * @param input.secret HMAC 签名 secret。
 * @param input.nowMs 注入的当前时刻(默认 `Date.now()`),便于测试构造过期场景。
 */
export function verifySessionToken(input: {
  token: string;
  secret: string | Buffer;
  nowMs?: number;
}):
  | { ok: true; sessionId: string; exp: number }
  | { ok: false; reason: SessionTokenFailureReason } {
  const { token, secret, nowMs = Date.now() } = input;

  const parts = token.split(".");
  if (parts.length !== 4 || parts[0] !== TOKEN_PREFIX) {
    return { ok: false, reason: "malformed" };
  }
  const [, sessionId, expRaw, sig] = parts;
  if (!sessionId || !expRaw || !sig) {
    return { ok: false, reason: "malformed" };
  }
  const exp = Number(expRaw);
  if (!Number.isFinite(exp)) {
    return { ok: false, reason: "malformed" };
  }

  if (exp < nowMs) {
    return { ok: false, reason: "expired" };
  }

  const expected = digest(secret, sessionId, exp);
  // 常量时间比较:长度不一致(含篡改导致的非 hex/变长)直接判定失败,不抛。
  const a = Buffer.from(sig, "utf8");
  const b = Buffer.from(expected, "utf8");
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return { ok: false, reason: "bad-signature" };
  }

  return { ok: true, sessionId, exp };
}

/**
 * 解析 aigc-proxy token 的签名 secret。
 *
 * 优先 `PI_WEB_AIGC_PROXY_SECRET`;回退 `PI_WEB_ATTACHMENT_SECRET`(复用附件系统已建立的
 * 主/子进程 secret 分发通道,签名域前缀仍确保两者签名不可互换);两者皆缺时抛清晰错误——
 * 代理模式下 secret 必须来自稳定来源,不可静默回退随机值。
 *
 * @param env 环境变量来源(默认 `process.env`,便于测试注入)。
 */
export function resolveAigcProxySecret(
  env: NodeJS.ProcessEnv = process.env,
): string {
  const fromAigcProxy = env[AIGC_PROXY_SECRET_ENV];
  if (fromAigcProxy && fromAigcProxy.length > 0) return fromAigcProxy;
  const fromAttachment = env[ATTACHMENT_SECRET_ENV];
  if (fromAttachment && fromAttachment.length > 0) return fromAttachment;
  throw new Error(
    `[aigc-proxy] 缺少签名 secret:请设置 ${AIGC_PROXY_SECRET_ENV}(推荐)或 ${ATTACHMENT_SECRET_ENV}(回退复用附件系统 secret)。`,
  );
}

/** aigc-proxy 专属 secret 环境变量名(供 config 工厂复用,避免字面量漂移)。 */
export const AIGC_PROXY_SECRET_ENV_NAME = AIGC_PROXY_SECRET_ENV;
