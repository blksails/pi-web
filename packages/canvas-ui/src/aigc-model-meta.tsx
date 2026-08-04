/**
 * aigc-model-meta — AIGC 模型选择器/设置面板共享的 provider 徽章与显示名逻辑。
 *
 * 单一事实源:`AigcQuickSettings`(选择器)与 `AigcModelTogglesField`(/settings 模型开关)复用同一套
 * provider 字母徽章(O/N/S/D)与 ` · <provider 名>` 后缀剥离规则,避免两处 PROVIDER_META 漂移。
 */
import * as React from "react";

/**
 * provider → 字母徽章元数据(无图标资源,取首字母表示)。首字母互不冲突(O/N/S/D/G/C)。
 * `name` 用于去掉 label 里冗余的 ` · <name>` 后缀 + 徽章 hover 提示。
 *
 * ⚠ **本表是徽章的准入闸门**:{@link ProviderBadge} 对表中没有的 provider 直接返回 null。
 * 新增 provider 若忘了在此登记,其模型在选择器里会表现为「纯文字、无色块、且保留冗余的
 * ` · xxx` 后缀」——因为 {@link displayNameOf} 依赖同一张表。ai-gateway 与 cloudflare
 * 两条通路曾因此漏登记。
 */
export const PROVIDER_META: Readonly<
  Record<string, { readonly letter: string; readonly name: string; readonly bg: string }>
> = {
  openrouter: { letter: "O", name: "OpenRouter", bg: "#6366f1" },
  newapi: { letter: "N", name: "NewAPI", bg: "#10b981" },
  sufy: { letter: "S", name: "Sufy", bg: "#f59e0b" },
  dashscope: { letter: "D", name: "DashScope", bg: "#0ea5e9" },
  "token-plan": { letter: "T", name: "Token Plan", bg: "#14b8a6" },
  // BlackSail 自建网关(BLKSAILS_GATEWAY_*)。取 G(Gateway)而非 A:后者易被读成
  // Anthropic/Aliyun。
  "ai-gateway": { letter: "G", name: "AI Gateway", bg: "#8b5cf6" },
  // Cloudflare AI Gateway(CLOUDFLARE_*),与上面的自建网关是**两条不同通路**。
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
  return n === norm(meta.name) || (providerId !== undefined && n === norm(providerId))
    ? label.slice(0, idx).trim()
    : label;
}

/** provider 字母徽章(无图标资源时的字母表示);未知 provider → 不渲染。 */
export function ProviderBadge({
  providerId,
}: {
  readonly providerId: string | undefined;
}): React.JSX.Element | null {
  const meta = providerId !== undefined ? PROVIDER_META[providerId] : undefined;
  if (meta === undefined) return null;
  return (
    <span
      aria-hidden
      title={meta.name}
      className="inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-[3px] text-[9px] font-semibold leading-none text-white"
      style={{ backgroundColor: meta.bg }}
    >
      {meta.letter}
    </span>
  );
}
