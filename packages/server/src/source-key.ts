/**
 * 稳定 sourceKey 工具(spec: source-settings-and-slots,任务 0.1;地基 G3;Req 0.1-0.4)。
 *
 * 面⑦ per-source 配置目录/DB 主键与面⑤ dist 寻址/源匹配的单一事实来源。
 *
 * 决策(拍板 Q2,design.md §地基 G3):以 registry sourceId 作稳定输入——即调用方已
 * 剥离版本/channel 的 source 逻辑标识(如 `PluginDescriptor.id`,同一 source 升版时不变)。
 * 本工具本身不做「从完整标识里剥版本」的解析(该职责属 registry-client/resolvePiPlugin),
 * 只负责把 sourceId 稳定映射为文件系统与 DB 主键安全的短散列——因此同一 sourceId 恒同输出,
 * 升版(version/channel 变、sourceId 不变)天然散列不变(Req 0.2)。
 *
 * 散列先例同 `sandbox-image/template-name.ts:104`(`sha256(identity).slice(0,HASH_LEN)`),
 * 但用途是 DB 主键/目录段而非人类可读 slug,故不带 basename 前缀,取更长的哈希位数
 * (16 hex = 64 bit)以降低多租户长期运行下的碰撞概率。
 *
 * 不变式:
 * - 纯函数,不读 env / fs;同输入恒同输出。
 * - 输出仅含 `[0-9a-f]`(sha256 hex 的固有性质),不含 `.`/`/`/`..` 等路径穿越字符,
 *   可直接用作目录段/DB 主键而无路径注入风险(Req 0.3)——即便输入含 `../`、空字节、
 *   unicode 等恶意内容,输出形状不变。
 */
import { createHash } from "node:crypto";

/** sourceKey 哈希位数(sha256 hex 前 16 位 = 64 bit)。 */
const SOURCE_KEY_HASH_LEN = 16;

/** 输出字符集校验(仅供内部断言/文档化,不对外暴露为运行时开销)。 */
const SOURCE_KEY_PATTERN = /^[0-9a-f]{16}$/;

/**
 * 从稳定 sourceId 派生 sourceKey:`sha256(sourceId).slice(0, 16)`。
 *
 * @param sourceId registry sourceId(不含版本/channel 的稳定 source 逻辑标识,
 *   如 `PluginDescriptor.id`);必须非空(trim 后)。
 * @throws {TypeError} sourceId 为空或仅含空白字符。
 */
export function sourceKey(sourceId: string): string {
  const id = sourceId.trim();
  if (id === "") {
    throw new TypeError(
      "sourceKey: sourceId must be a non-empty registry source identity (version/channel-less)",
    );
  }
  const hash = createHash("sha256").update(id).digest("hex").slice(0, SOURCE_KEY_HASH_LEN);
  return hash;
}

/** 校验一个字符串是否是合法的 sourceKey 形状(供落盘/端点侧防御性校验复用)。 */
export function isSourceKey(value: string): boolean {
  return SOURCE_KEY_PATTERN.test(value);
}
