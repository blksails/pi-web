/**
 * aigc-model-meta — AIGC 模型选择器/设置面板共享的 provider 徽章与显示名逻辑。
 *
 * 单一事实源:`AigcQuickSettings`(选择器)与 `AigcModelTogglesField`(/settings 模型开关)复用同一套
 * provider 字母徽章(O/N/S/D)与 ` · <provider 名>` 后缀剥离规则,避免两处 PROVIDER_META 漂移。
 */
import * as React from "react";

/**
 * provider → 字母徽章元数据(无图标资源,取首字母表示)。首字母互不冲突(O/N/S/D/G/B/C)。
 * `name` 用于去掉 label 里冗余的 ` · <name>` 后缀 + 徽章 hover 提示。
 *
 * ⚠ **本表是徽章的准入闸门**:{@link ProviderBadge} 对表中没有的 provider 直接返回 null。
 * 新增 provider 若忘了在此登记,其模型在选择器里会表现为「纯文字、无色块、且保留冗余的
 * ` · xxx` 后缀」——因为 {@link displayNameOf} 依赖同一张表。ai-gateway 与 cloudflare
 * 两条通路曾因此漏登记。
 */
export const PROVIDER_META: Readonly<
  Record<
    string,
    {
      readonly letter: string;
      readonly name: string;
      readonly bg: string;
      /**
       * 该 provider 在**存量 label 后缀**里可能出现的其它写法。{@link displayNameOf} 用它
       * 判定后缀是否冗余。归一改名(`ai-gateway` → `blksails-ai`)之后,静态目录里的 label
       * 仍写着旧名,不列别名的话后缀剥不掉。
       */
      readonly aliases?: readonly string[];
    }
  >
> = {
  openrouter: { letter: "O", name: "OpenRouter", bg: "#6366f1" },
  newapi: { letter: "N", name: "NewAPI", bg: "#10b981" },
  sufy: { letter: "S", name: "Sufy", bg: "#f59e0b" },
  dashscope: { letter: "D", name: "DashScope", bg: "#0ea5e9" },
  // 网关**实例**的缺省 id(单实例配置 AI_GATEWAY_BASE_URL 时合成出来的那个)。它指向
  // 「部署方配置的那台网关」,具体是谁取决于 env——所以名字只能是通用的 AI Gateway。
  // 取 G(Gateway)而非 A:后者易被读成 Anthropic/Aliyun。
  "ai-gateway": { letter: "G", name: "AI Gateway", bg: "#8b5cf6" },
  // BlackSail 自建网关的图像通路。image 侧存量标识 `ai-gateway` 被归一成这个 id
  // (multi-gateway-providers 任务 4.0 `LEGACY_PROVIDER_ID_MAP`),正是为了与上面那个
  // 「缺省实例」区分开——两者曾同名,导致隐藏其一会连带干掉另一条通路的模型。
  "blksails-ai": {
    letter: "B",
    name: "BlackSail AI",
    bg: "#14b8a6",
    aliases: ["ai-gateway", "AI Gateway"],
  },
  // Cloudflare AI Gateway(CLOUDFLARE_*),与上面两条都是**不同通路**。
  // 用 Cloudflare 官方品牌橙 #f6821f:与 sufy 的琥珀 #f59e0b 邻近但更饱和偏红,
  // 且字母不同(C/S),不至混淆。
  cloudflare: { letter: "C", name: "Cloudflare", bg: "#f6821f" },
};

/**
 * 去掉 label 末尾冗余的 ` · <provider 名>` 后缀 —— 仅当后缀与该 model 的 provider 名匹配
 * (大小写不敏感)时移除,由徽章代表;保留如 ` · token plan` 这类非 provider 名的有意义区分。
 */
export function displayNameOf(label: string, providerId: string | undefined): string {
  const meta = providerId !== undefined ? PROVIDER_META[providerId] : undefined;
  if (meta === undefined) return label;
  const idx = label.lastIndexOf(" · ");
  if (idx < 0) return label;
  const suffix = label.slice(idx + 3).trim();
  // 归一化后比较,并同时接受 provider **id**:label 后缀有的写展示名(" · NewAPI"),
  // 有的直接写 id(" · ai-gateway")。不归一化的话后者匹配不上 name "AI Gateway",
  // 徽章已代表 provider 却仍拖着冗余后缀。
  const norm = (s: string): string => s.toLowerCase().replace(/[\s_-]+/g, "");
  const n = norm(suffix);
  const accepted = [meta.name, providerId ?? "", ...(meta.aliases ?? [])].map(norm);
  return accepted.includes(n) ? label.slice(0, idx).trim() : label;
}

/**
 * 未登记 provider 的兜底徽章外观(灰色 + id 首字母)—— 不依赖 {@link PROVIDER_META}
 * (multi-gateway-providers 任务 5.4;Req 7.1/11.7 相邻缺口):自定义 provider 的标识是
 * 使用者在设置面板里现填的,不可能预先登记进这张手工维护的静态表(登记进去的是「产品
 * 已知的少数几个内置 provider」)。此前 {@link ProviderBadge} 对表外 provider 直接返回
 * `null`,使自定义 provider 的模型在图像/视觉清单里退化成「纯文字、无色块」—— 与本表头
 * 注释警告的"忘了登记"是同一症状,但这里不是遗漏登记(不可能穷举使用者的自定义标识),
 * 是徽章机制本身需要一条不查表也能画的兜底路径。用固定中性色(不挑战既有品牌色语义),
 * 字母取标识首个字母(非字母数字时退化为 "•"),使徽章仍是"有一块色 + 一个记号"而非空白。
 */
const FALLBACK_BADGE_BG = "#64748b"; // slate-500:中性,不与 PROVIDER_META 任何品牌色雷同。

function fallbackLetterFor(providerId: string): string {
  const m = /[a-zA-Z0-9]/.exec(providerId);
  return m !== null ? m[0]!.toUpperCase() : "•";
}

/**
 * provider 字母徽章(无图标资源时的字母表示)。
 * `providerId === undefined`(压根没有 provider 可标)→ 不渲染;
 * `providerId` 有值但不在 {@link PROVIDER_META}(自定义 / 尚未登记的 provider)→ 兜底徽章,
 * 不再是 `null`(见上方兜底说明)。
 */
export function ProviderBadge({
  providerId,
}: {
  readonly providerId: string | undefined;
}): React.JSX.Element | null {
  if (providerId === undefined) return null;
  const meta = PROVIDER_META[providerId];
  const letter = meta?.letter ?? fallbackLetterFor(providerId);
  const bg = meta?.bg ?? FALLBACK_BADGE_BG;
  const title = meta?.name ?? providerId;
  return (
    <span
      aria-hidden
      title={title}
      className="inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-[3px] text-[9px] font-semibold leading-none text-white"
      style={{ backgroundColor: bg }}
    >
      {letter}
    </span>
  );
}
