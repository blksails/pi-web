/**
 * aigc-model-meta — AIGC 模型选择器/设置面板共享的 provider 徽章与显示名逻辑。
 *
 * 单一事实源:`AigcQuickSettings`(选择器)与 `AigcModelTogglesField`(/settings 模型开关)复用同一套
 * provider 字母徽章(O/N/S/D)与 ` · <provider 名>` 后缀剥离规则,避免两处 PROVIDER_META 漂移。
 */
import * as React from "react";

/**
 * provider → 字母徽章元数据(无图标资源,取首字母表示)。首字母互不冲突(O/N/S/D)。
 * `name` 用于去掉 label 里冗余的 ` · <name>` 后缀 + 徽章 hover 提示。
 */
export const PROVIDER_META: Readonly<
  Record<string, { readonly letter: string; readonly name: string; readonly bg: string }>
> = {
  openrouter: { letter: "O", name: "OpenRouter", bg: "#6366f1" },
  newapi: { letter: "N", name: "NewAPI", bg: "#10b981" },
  sufy: { letter: "S", name: "Sufy", bg: "#f59e0b" },
  dashscope: { letter: "D", name: "DashScope", bg: "#0ea5e9" },
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
  return suffix.toLowerCase() === meta.name.toLowerCase() ? label.slice(0, idx).trim() : label;
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
