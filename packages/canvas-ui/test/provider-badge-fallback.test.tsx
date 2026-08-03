/**
 * ProviderBadge — 兜底渲染(multi-gateway-providers 任务 5.4;Req 7.1/11.7 相邻缺口)。
 *
 * PROVIDER_META 是徽章的准入闸门(见 aigc-model-meta.test.ts 头注释),但使用者在
 * 设置面板新增的自定义 provider 标识不可能预先登记进这张手工维护的静态表。此前
 * `ProviderBadge` 对表外 provider 直接返回 `null`,使这些 provider 的模型在图像/视觉
 * 清单里退化成「纯文字、无色块」。本文件锁定改动后的行为:表外 provider 渲染中性色
 * 兜底徽章,而不是消失。
 *
 * 变异判据:把 `ProviderBadge` 里的 `meta?.letter ?? fallbackLetterFor(providerId)` 改回
 * `if (meta === undefined) return null;` → 下面第二条用例查不到任何徽章元素,转红。
 */
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { ProviderBadge } from "../src/aigc-model-meta.js";

function findByTitle(container: HTMLElement, title: string): HTMLElement | null {
  return container.querySelector(`[title="${title}"]`);
}

describe("ProviderBadge — 未登记 provider 的兜底展示", () => {
  it("providerId === undefined → 不渲染任何东西", () => {
    const { container } = render(<ProviderBadge providerId={undefined} />);
    expect(container.innerHTML).toBe("");
  });

  it("已知 provider(在 PROVIDER_META 中)→ 沿用登记的字母 + 品牌色(回归)", () => {
    const { container } = render(<ProviderBadge providerId="openrouter" />);
    const badge = findByTitle(container, "OpenRouter");
    expect(badge?.textContent).toBe("O");
    expect(badge?.style.backgroundColor.length).toBeGreaterThan(0);
  });

  it("未登记的自定义 provider → 渲染中性色兜底徽章(不是 null),字母取标识首字符", () => {
    const known = render(<ProviderBadge providerId="openrouter" />);
    const knownBg = findByTitle(known.container, "OpenRouter")?.style.backgroundColor;

    const { container } = render(<ProviderBadge providerId="my-custom-provider" />);
    // title 回退为 providerId 本身(没有登记的展示名可用)。
    const badge = findByTitle(container, "my-custom-provider");
    expect(badge).not.toBeNull();
    expect(badge?.textContent).toBe("M");
    // 兜底色与已登记品牌色不同(同一渲染引擎下的同格式对比,否则会被误认成某个已知 provider)。
    expect(badge?.style.backgroundColor).not.toBe(knownBg);
    expect(badge?.style.backgroundColor.length).toBeGreaterThan(0);
  });

  it("标识不含任何字母数字(极端输入)→ 退化为 '•',不崩溃", () => {
    const { container } = render(<ProviderBadge providerId="---" />);
    expect(findByTitle(container, "---")?.textContent).toBe("•");
  });
});
