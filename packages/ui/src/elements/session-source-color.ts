/**
 * session-source-color — agent-source 标识 → 稳定 accent 色(spec session-meta-index, Req 6.3/6.4)。
 *
 * 取代原设想的会话图标:图标需要一个产生源(agent 定义里并没有图标字段),而色条只需要
 * 来源标识本身 —— 零存储、零空值,存量会话只要有来源即可立刻着色。
 *
 * 确定性:同一 source 恒得同色(不读时钟、不读随机源),故跨刷新、跨排序、跨会话都稳定。
 * 代价:调色板取模,不同来源**可能撞色** —— 需求写的是「尽可能不同」而非「保证不同」。
 *
 * 色值用 HSL 字面量而非主题 CSS 变量:色条是**区分性**装饰(同源同色),不参与语义配色,
 * 且需要在明暗两种主题下都可辨 —— 故取中等饱和度/亮度,两种主题下对比度都够。
 */

/**
 * 调色板:8 色,色相均匀铺开且避开语义色(红=错误、绿=成功)的极端位置,
 * 使色条不被误读为状态。
 */
const PALETTE: readonly string[] = [
  "hsl(210 70% 55%)", // 蓝
  "hsl(265 60% 60%)", // 紫
  "hsl(175 55% 45%)", // 青
  "hsl(35 75% 55%)", // 橙
  "hsl(330 55% 60%)", // 品红
  "hsl(95 45% 45%)", // 橄榄绿
  "hsl(240 45% 62%)", // 靛
  "hsl(15 60% 58%)", // 砖红
];

/** 无来源 / 异常输入的中性回退色(不抛)。 */
const NEUTRAL = "hsl(215 15% 55%)";

/** FNV-1a 32 位:短字符串上分布够好,实现几行、无依赖、确定性。 */
function fnv1a(input: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    // 乘 16777619,用移位保持 32 位无符号
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

/**
 * 由来源标识派生 accent 色。空串 / 非字符串 → 中性回退色。
 * 同输入恒同输出;不同输入尽可能落到不同调色板项。
 */
export function sourceAccentColor(source: string | undefined): string {
  if (typeof source !== "string") return NEUTRAL;
  const trimmed = source.trim();
  if (trimmed.length === 0) return NEUTRAL;
  return PALETTE[fnv1a(trimmed) % PALETTE.length] ?? NEUTRAL;
}

/** 调色板容量(测试与文档用)。 */
export const SOURCE_ACCENT_PALETTE_SIZE = PALETTE.length;
