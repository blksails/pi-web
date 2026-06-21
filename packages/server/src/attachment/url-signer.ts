/**
 * attachment-store · URL 签名器(安全 · Req 4.3, 4.4, 4.5, 4.6)。
 *
 * 为防枚举的分发 URL `/attachments/:id/raw?exp&sig` 签发/校验 HMAC 签名:
 * - `sign(id, expiresInMs)`:产出 `{ exp, sig }`,`sig = HMAC-SHA256(secret, `${id}.${exp}`)`(hex)。
 * - `verify(id, exp, sig)`:以**常量时间**比较(`timingSafeEqual`)校验 HMAC,并检查 `exp >= now`;
 *   篡改 id/exp/sig 或已过期均返回 false,不抛(防侧信道、防枚举)。
 *
 * secret 取自稳定来源 `PI_WEB_ATTACHMENT_SECRET` 环境变量(Req 4.6);本模块的核心是
 * **接受注入的 secret**(`createUrlSigner(secret)`),secret 来源的完整 config 工厂解析留给
 * task 2.5(attachmentStoreConfigFromEnv)。`resolveAttachmentSecret` 仅作 signer 自身可选默认:
 * 优先 env;仅纯单进程无共享场景可回退进程启动随机(该回退在子进程共享场景不可用,需主/子进程一致)。
 *
 * 安全:secret 与签名内容不写日志(design.md Security Considerations)。
 * 实现:`node:crypto` 的 `createHmac` + `timingSafeEqual`,零新第三方依赖。
 */
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/** 防枚举签名 URL 的签发与校验(design.md UrlSigner 契约)。 */
export interface UrlSigner {
  /** 按公开 id + 过期窗口签发 HMAC;`exp` 为绝对过期时刻(epoch ms)。 */
  sign(id: string, expiresInMs: number): { exp: number; sig: string };
  /** 校验 id|exp 的 HMAC(timingSafeEqual)并检查未过期;失败返回 false。 */
  verify(id: string, exp: number, sig: string): boolean;
}

/** HMAC 摘要算法。 */
const HMAC_ALG = "sha256";

/** 签名 secret 的环境变量名(稳定来源,Req 4.6)。 */
const SECRET_ENV = "PI_WEB_ATTACHMENT_SECRET";

/** 对 `id|exp` 计算 hex HMAC 摘要。 */
function digest(secret: string | Buffer, id: string, exp: number): string {
  return createHmac(HMAC_ALG, secret).update(`${id}.${exp}`).digest("hex");
}

/**
 * 用注入的 secret 构造一个 {@link UrlSigner}。
 *
 * 相同 secret 构造的两个 signer 互验通过(主/子进程一致前提);secret 不一致则校验失败。
 *
 * @param secret HMAC 签名 secret(稳定来源,见 {@link resolveAttachmentSecret})。
 */
export function createUrlSigner(secret: string | Buffer): UrlSigner {
  return {
    sign(id, expiresInMs) {
      const exp = Date.now() + expiresInMs;
      return { exp, sig: digest(secret, id, exp) };
    },
    verify(id, exp, sig) {
      // 先做过期检查(廉价,且对所有 id 一致 → 不泄露存在性)。
      if (!Number.isFinite(exp) || exp < Date.now()) return false;
      const expected = digest(secret, id, exp);
      // 常量时间比较:长度不一致(含空/非法)直接 false,不抛、不短路泄露。
      const a = Buffer.from(sig, "utf8");
      const b = Buffer.from(expected, "utf8");
      if (a.length !== b.length) return false;
      return timingSafeEqual(a, b);
    },
  };
}

/**
 * 解析 signer 自身可选的默认 secret(稳定来源)。
 *
 * 优先读取 `PI_WEB_ATTACHMENT_SECRET`;仅在**纯单进程无共享**场景下可回退进程启动随机
 * `randomBytes(32)`。该随机回退在附件-tool(子进程共享)场景下**不可用**——子进程产出的签名
 * URL 会在主进程校验时 401;那些场景必须经 spawn env 下发稳定 secret(task 2.5/5.2)。
 *
 * 完整的 config 解析(目录 + secret)归 task 2.5 的 `attachmentStoreConfigFromEnv`;此处仅为
 * signer 自身提供一个可选默认,核心仍是经 {@link createUrlSigner} 接受 secret 注入。
 *
 * @param env 环境变量来源(默认 `process.env`,便于测试注入)。
 */
export function resolveAttachmentSecret(
  env: NodeJS.ProcessEnv = process.env,
): string {
  const fromEnv = env[SECRET_ENV];
  if (fromEnv && fromEnv.length > 0) return fromEnv;
  // 纯单进程回退(子进程共享场景不可用)。
  return randomBytes(32).toString("hex");
}

/** 签名 secret 环境变量名(供 config 工厂复用,避免字面量漂移)。 */
export const ATTACHMENT_SECRET_ENV = SECRET_ENV;
