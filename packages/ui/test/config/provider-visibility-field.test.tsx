/**
 * ProviderVisibilityField 组件测试(provider-visibility-config 任务 3.1)。
 *
 * 重点守三件容易悄悄坏掉的事:
 *  1. 取数**带筛选参数** —— 零参数会走回旧 chatOptions() 路径,清单恒空(实测坑);
 *  2. 开关与勾选正确写回值,且改回全可见时**删键**(零侵入判据得以重新成立);
 *  3. 两处确认提示确实拦得住(Req 2.5 / 4.5)。
 */
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import {
  ProviderVisibilityField,
  __setProviderVisibilityFetchImpl,
  __resetProviderVisibilityFetchImpl,
  type ProviderVisibilityMap,
} from "../../src/config/provider-visibility-field.js";
import type { FieldDescriptor } from "@blksails/pi-web-protocol";

const DESCRIPTOR: FieldDescriptor = {
  key: "visibility",
  kind: "record",
  widget: "providerVisibility",
  label: "Provider 与模型展示",
  required: false,
};

function makeFetch(): ReturnType<typeof vi.fn> {
  return vi.fn(async (url: string) => {
    if (url.includes("output=image")) {
      return new Response(
        JSON.stringify({
          models: [{ provider: "sufy", id: "sufy-image", name: "Sufy Image", source: "self" }],
        }),
        { status: 200 },
      );
    }
    return new Response(
      JSON.stringify({
        models: [
          { provider: "openrouter", id: "gpt-4o", name: "GPT-4o", source: "self" },
          { provider: "openrouter", id: "claude-3", name: "Claude 3", source: "self" },
          { provider: "my-provider", id: "m1", name: "M1", source: "custom" },
        ],
      }),
      { status: 200 },
    );
  });
}

function renderField(
  value: ProviderVisibilityMap | undefined,
  onChange: (next: unknown) => void,
): void {
  render(
    <ProviderVisibilityField
      descriptor={DESCRIPTOR}
      value={value}
      onChange={onChange}
      path={["visibility"]}
      errors={{}}
    />,
  );
}

afterEach(() => {
  __resetProviderVisibilityFetchImpl();
  vi.restoreAllMocks();
});

describe("ProviderVisibilityField", () => {
  beforeEach(() => {
    __setProviderVisibilityFetchImpl(makeFetch() as unknown as typeof fetch);
  });

  it("★ 取数带筛选参数(零参数会让清单恒空,是已实测的坑)", async () => {
    const fetchSpy = makeFetch();
    __setProviderVisibilityFetchImpl(fetchSpy as unknown as typeof fetch);
    renderField({}, () => {});

    await waitFor(() => expect(screen.getByText("openrouter")).toBeInTheDocument());
    const urls = fetchSpy.mock.calls.map((c) => String(c[0]));
    expect(urls.some((u) => u.includes("output=text"))).toBe(true);
    expect(urls.some((u) => u.includes("output=image"))).toBe(true);
    // 任何一次请求都不得是零参数形态
    expect(urls.every((u) => u.includes("output="))).toBe(true);
  });

  it("列出全部 provider 并标明来源档(Req 1.1/1.2)", async () => {
    renderField({}, () => {});
    await waitFor(() => expect(screen.getByText("openrouter")).toBeInTheDocument());
    expect(screen.getByText("sufy")).toBeInTheDocument();
    expect(screen.getByText("my-provider")).toBeInTheDocument();
    expect(screen.getAllByText("内置注册")).toHaveLength(2);
    expect(screen.getByText("使用者自定义")).toBeInTheDocument();
  });

  it("明示作用范围仅为展示(Req 3.1)", async () => {
    renderField({}, () => {});
    await waitFor(() => expect(screen.getByText("openrouter")).toBeInTheDocument());
    expect(screen.getByText(/已有会话与工具照常可用/)).toBeInTheDocument();
  });

  it("关闭 provider 时确认后写回 hidden(Req 2.5)", async () => {
    const onChange = vi.fn();
    vi.spyOn(globalThis, "confirm").mockReturnValue(true);
    renderField({}, onChange);
    await waitFor(() => expect(screen.getByText("openrouter")).toBeInTheDocument());

    await userEvent.click(
      document.querySelector('[data-pi-provider-toggle="openrouter"]') as HTMLElement,
    );
    expect(onChange).toHaveBeenCalledWith({ openrouter: { hidden: true } });
  });

  it("确认被拒绝时不写回(Req 2.5 的拦截确实生效)", async () => {
    const onChange = vi.fn();
    vi.spyOn(globalThis, "confirm").mockReturnValue(false);
    renderField({}, onChange);
    await waitFor(() => expect(screen.getByText("openrouter")).toBeInTheDocument());

    await userEvent.click(
      document.querySelector('[data-pi-provider-toggle="openrouter"]') as HTMLElement,
    );
    expect(onChange).not.toHaveBeenCalled();
  });

  it("改回可见时删键而非留空壳(使零侵入判据重新成立)", async () => {
    const onChange = vi.fn();
    renderField({ openrouter: { hidden: true } }, onChange);
    await waitFor(() => expect(screen.getByText("openrouter")).toBeInTheDocument());

    // 从隐藏改回可见不需要确认
    await userEvent.click(
      document.querySelector('[data-pi-provider-toggle="openrouter"]') as HTMLElement,
    );
    expect(onChange).toHaveBeenCalledWith({});
  });

  it("被隐藏的 provider 仍列出并标明状态,以便改回来(Req 1.4)", async () => {
    renderField({ sufy: { hidden: true } }, () => {});
    await waitFor(() => expect(screen.getByText("sufy")).toBeInTheDocument());
    expect(screen.getByText("已隐藏")).toBeInTheDocument();
  });

  it("展开后逐模型勾选写回 hiddenModels(Req 4.1/4.2)", async () => {
    const onChange = vi.fn();
    renderField({}, onChange);
    await waitFor(() => expect(screen.getByText("openrouter")).toBeInTheDocument());

    await userEvent.click(
      document.querySelector('[data-pi-provider-row="openrouter"]') as HTMLElement,
    );
    await userEvent.click(document.querySelector('[data-pi-model-toggle="gpt-4o"]') as HTMLElement);
    expect(onChange).toHaveBeenCalledWith({ openrouter: { hiddenModels: ["gpt-4o"] } });
  });

  it("按名称筛选收敛长清单(Req 4.6)", async () => {
    renderField({}, () => {});
    await waitFor(() => expect(screen.getByText("openrouter")).toBeInTheDocument());
    await userEvent.click(
      document.querySelector('[data-pi-provider-row="openrouter"]') as HTMLElement,
    );
    expect(screen.getByText("GPT-4o")).toBeInTheDocument();
    expect(screen.getByText("Claude 3")).toBeInTheDocument();

    await userEvent.type(document.querySelector("[data-pi-model-filter]") as HTMLElement, "claude");
    await waitFor(() => expect(screen.queryByText("GPT-4o")).not.toBeInTheDocument());
    expect(screen.getByText("Claude 3")).toBeInTheDocument();
  });

  it("勾掉最后一个模型时要求确认(Req 4.5)", async () => {
    const onChange = vi.fn();
    const confirmSpy = vi.spyOn(globalThis, "confirm").mockReturnValue(false);
    // sufy 只有一个模型,勾掉它即"全部勾光"
    renderField({}, onChange);
    await waitFor(() => expect(screen.getByText("sufy")).toBeInTheDocument());

    await userEvent.click(document.querySelector('[data-pi-provider-row="sufy"]') as HTMLElement);
    await userEvent.click(
      document.querySelector('[data-pi-model-toggle="sufy-image"]') as HTMLElement,
    );
    expect(confirmSpy).toHaveBeenCalled();
    expect(onChange).not.toHaveBeenCalled();
  });

  it("★ 目录里已不再返回、但配置里已隐藏的 provider 仍列出,以便改回可见(Req 1.4)", async () => {
    // 真实数据流:本控件取数走 /api/config/models,而那正是被可见性过滤的出口 ——
    // 隐藏后目录不再返回它。若不据配置补回该行,使用者就再也点不回来(单向门)。
    // 这个缺陷 stub 恒返回全集的测试抓不到,是浏览器 e2e 抓到的,故在此补守卫。
    const onChange = vi.fn();
    __setProviderVisibilityFetchImpl(
      vi.fn(async (url: string) =>
        url.includes("output=image")
          ? new Response(JSON.stringify({ models: [] }), { status: 200 })
          : new Response(
              JSON.stringify({
                models: [
                  { provider: "openrouter", id: "gpt-4o", name: "GPT-4o", source: "self" },
                ],
              }),
              { status: 200 },
            ),
      ) as unknown as typeof fetch,
    );
    // sufy 已被隐藏,故目录里没有它
    renderField({ sufy: { hidden: true } }, onChange);

    await waitFor(() => expect(screen.getByText("openrouter")).toBeInTheDocument());
    expect(screen.getByText("sufy")).toBeInTheDocument();
    expect(screen.getByText("已隐藏")).toBeInTheDocument();

    // 且点得回来
    await userEvent.click(document.querySelector('[data-pi-provider-toggle="sufy"]') as HTMLElement);
    expect(onChange).toHaveBeenCalledWith({});
  });

  it("取数失败时呈现可辨识的失败态,而非空清单(Req 1.3)", async () => {
    __setProviderVisibilityFetchImpl(
      vi.fn(async () => new Response("boom", { status: 500 })) as unknown as typeof fetch,
    );
    renderField({ openrouter: { hidden: true } }, () => {});
    await waitFor(() =>
      expect(document.querySelector("[data-pi-provider-visibility-error]")).toBeTruthy(),
    );
  });
});
