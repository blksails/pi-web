/**
 * attachment-store · 公开 id 铸造工具(L1)。
 *
 * 形如 `att_<URL-safe 随机串>`,基于密码学随机字节(node:crypto,零新第三方依赖)。
 * 设计约束(design.md File Structure / Req 2.3):
 * - 前缀 `att_`,随机体为 base64url(URL-safe,无 `+` `/` `=`);
 * - 16 字节随机熵 → 不可顺序枚举、不可推测;
 * - 多次生成不重复(单一身份的前置保障)。
 *
 * 仅在 server 写路径(AttachmentStore.put)内调用以铸造公开 id(Req 2.4 单一身份)。
 */
import { randomBytes } from "node:crypto";

/** 公开 id 前缀。 */
const ATTACHMENT_ID_PREFIX = "att_";

/** 随机熵字节数(128 bit → base64url 22 字符,足够防枚举与碰撞)。 */
const RANDOM_BYTES = 16;

/**
 * 铸造一个形如 `att_<base64url>` 的公开附件 id。
 *
 * 基于 `randomBytes(16)` 的密码学随机熵,经 base64url 编码;URL-safe、不可顺序枚举、
 * 多次生成实际不重复。
 */
export function mintAttachmentId(): string {
  return ATTACHMENT_ID_PREFIX + randomBytes(RANDOM_BYTES).toString("base64url");
}
