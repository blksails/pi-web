/**
 * agent-sources-list — AgentSourcePicker 源列表子视图与选取(Req 5.1–5.5, 6.4)。
 *
 * 覆盖:列表渲染、点击项以其 source 触发 onSubmit、加载失败保留手输框、空态、
 * 创建中(loading)禁用列表点击、未启用门控时不显示列表。
 */
import { afterEach, describe, it, expect, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { AgentSourcePicker } from "../../src/chat/agent-source-picker.js";
import type {
  ListAgentSourcesRequest,
  ListAgentSourcesResponse,
} from "@blksails/pi-web-protocol";

afterEach(cleanup);

const list =
  (res: ListAgentSourcesResponse) =>
  (_req: ListAgentSourcesRequest): Promise<ListAgentSourcesResponse> =>
    Promise.resolve(res);

const twoSources: ListAgentSourcesResponse = {
  sources: [
    { id: "/a", source: "/a", name: "Alpha", kind: "dir", origin: "scan", mode: "custom" },
    { id: "/b", source: "/b", name: "Beta", kind: "dir", origin: "registry", mode: "cli" },
  ],
};

describe("AgentSourcePicker — source list", () => {
  it("启用门控 + 注入数据源 → 渲染列表项(Req 5.1)", async () => {
    render(
      <AgentSourcePicker
        onSubmit={() => {}}
        enableSourceList
        listAgentSources={list(twoSources)}
      />,
    );
    await waitFor(() => expect(screen.getByText("Alpha")).toBeTruthy());
    expect(screen.getByText("Beta")).toBeTruthy();
    expect(document.querySelector("[data-agent-source-list]")).toBeTruthy();
  });

  it("点击列表项 → 以该项 source 触发 onSubmit(Req 5.2)", async () => {
    const onSubmit = vi.fn();
    const { container } = render(
      <AgentSourcePicker
        onSubmit={onSubmit}
        enableSourceList
        listAgentSources={list(twoSources)}
      />,
    );
    await waitFor(() => expect(screen.getByText("Alpha")).toBeTruthy());
    const items = container.querySelectorAll("[data-agent-source-item]");
    fireEvent.click(items[0]!);
    expect(onSubmit).toHaveBeenCalledWith("/a");
  });

  it("加载失败 → 显示错误但保留手输框(Req 5.3)", async () => {
    render(
      <AgentSourcePicker
        onSubmit={() => {}}
        enableSourceList
        listAgentSources={() => Promise.reject(new Error("boom"))}
      />,
    );
    await waitFor(() =>
      expect(document.querySelector("[data-agent-source-list-error]")).toBeTruthy(),
    );
    // 手输框仍存在。
    expect(document.querySelector("[data-agent-source-input]")).toBeTruthy();
  });

  it("空列表 → 空态提示且保留手输框(Req 5.4)", async () => {
    render(
      <AgentSourcePicker
        onSubmit={() => {}}
        enableSourceList
        listAgentSources={list({ sources: [] })}
      />,
    );
    await waitFor(() =>
      expect(document.querySelector("[data-agent-source-list-empty]")).toBeTruthy(),
    );
    expect(document.querySelector("[data-agent-source-input]")).toBeTruthy();
  });

  it("loading(创建中)→ 列表项禁用,点击不触发 onSubmit(Req 5.5)", async () => {
    const onSubmit = vi.fn();
    const { container } = render(
      <AgentSourcePicker
        onSubmit={onSubmit}
        loading
        enableSourceList
        listAgentSources={list(twoSources)}
      />,
    );
    await waitFor(() => expect(screen.getByText("Alpha")).toBeTruthy());
    const item = container.querySelector("[data-agent-source-item]") as HTMLButtonElement;
    expect(item.disabled).toBe(true);
    fireEvent.click(item);
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("注入 onToggleFavorite → 列表项显示星标,点击触发 toggle(sidebar-launcher-rail Req 4.1)", async () => {
    const onToggleFavorite = vi.fn();
    const { container } = render(
      <AgentSourcePicker
        onSubmit={() => {}}
        enableSourceList
        listAgentSources={list(twoSources)}
        favoriteSources={new Set(["/a"])}
        onToggleFavorite={onToggleFavorite}
      />,
    );
    await waitFor(() => expect(screen.getByText("Alpha")).toBeTruthy());
    const toggles = container.querySelectorAll("[data-agent-source-favorite-toggle]");
    expect(toggles).toHaveLength(2);
    // /a 已收藏 → 高亮态。
    expect(toggles[0]!.getAttribute("data-favorited")).toBe("true");
    expect(toggles[1]!.getAttribute("data-favorited")).toBe("false");
    fireEvent.click(toggles[1]!);
    expect(onToggleFavorite).toHaveBeenCalledWith(
      expect.objectContaining({ source: "/b" }),
    );
  });

  it("未注入 onToggleFavorite → 不显示星标(向后兼容 agent-sources-list)", async () => {
    render(
      <AgentSourcePicker
        onSubmit={() => {}}
        enableSourceList
        listAgentSources={list(twoSources)}
      />,
    );
    await waitFor(() => expect(screen.getByText("Alpha")).toBeTruthy());
    expect(document.querySelector("[data-agent-source-favorite-toggle]")).toBeNull();
  });

  it("variant=dialog → shadcn Dialog(portal 渲染,内置关闭 X),点关闭触发 onClose", async () => {
    const onClose = vi.fn();
    render(
      <AgentSourcePicker
        onSubmit={() => {}}
        variant="dialog"
        onClose={onClose}
        enableSourceList
        listAgentSources={list(twoSources)}
      />,
    );
    // Radix Dialog 经 portal 渲染到 body;对话框容器带 data-agent-source-dialog。
    expect(document.querySelector("[data-agent-source-dialog]")).toBeTruthy();
    // 列表仍在对话框内可用。
    await waitFor(() => expect(screen.getByText("Alpha")).toBeTruthy());
    // 点内置关闭 X(Radix DialogClose,aria-label="Close")→ onOpenChange(false) → onClose。
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("variant=dialog → 按 Esc 触发 onClose(Radix 提供)", async () => {
    const onClose = vi.fn();
    render(
      <AgentSourcePicker
        onSubmit={() => {}}
        variant="dialog"
        onClose={onClose}
        enableSourceList
        listAgentSources={list(twoSources)}
      />,
    );
    await waitFor(() => expect(screen.getByText("Alpha")).toBeTruthy());
    fireEvent.keyDown(document.body, { key: "Escape", code: "Escape" });
    expect(onClose).toHaveBeenCalled();
  });

  it("列表项渲染 title(优先于 name)、description 与图片/首字母 avatar", async () => {
    const rich: ListAgentSourcesResponse = {
      sources: [
        {
          id: "/img",
          source: "/img",
          name: "img-name",
          kind: "dir",
          origin: "scan",
          mode: "custom",
          title: "Image Agent",
          description: "has avatar url",
          avatar: "https://example.com/a.png",
        },
        {
          id: "/txt",
          source: "/txt",
          name: "Zeta",
          kind: "dir",
          origin: "registry",
          mode: "cli",
        },
      ],
    };
    const { container } = render(
      <AgentSourcePicker
        onSubmit={() => {}}
        enableSourceList
        listAgentSources={list(rich)}
      />,
    );
    await waitFor(() => expect(screen.getByText("Image Agent")).toBeTruthy());
    // title 优先展示。
    const titles = container.querySelectorAll("[data-agent-source-title]");
    expect(titles[0]!.textContent).toBe("Image Agent");
    expect(titles[1]!.textContent).toBe("Zeta"); // 无 title 回退 name
    // 图片 avatar 渲染为 <img>。
    const avatars = container.querySelectorAll("[data-agent-source-avatar]");
    expect(avatars[0]!.tagName).toBe("IMG");
    expect(avatars[0]!.getAttribute("src")).toBe("https://example.com/a.png");
    // 无 avatar → 首字母兜底(Zeta → Z)。
    expect(avatars[1]!.textContent).toBe("Z");
    // 描述展示。
    expect(screen.getByText("has avatar url")).toBeTruthy();
  });

  it("默认只展示 9 个源,其余折叠;「显示全部」展开、「收起」收回", async () => {
    // 12 个源 → 默认渲染前 9,底部出现展开按钮。
    const many: ListAgentSourcesResponse = {
      sources: Array.from({ length: 12 }, (_, i) => ({
        id: `/s${i}`,
        source: `/s${i}`,
        name: `Source ${i}`,
        kind: "dir" as const,
        origin: "scan" as const,
        mode: "custom" as const,
      })),
    };
    render(
      <AgentSourcePicker
        onSubmit={() => {}}
        enableSourceList
        listAgentSources={list(many)}
      />,
    );
    await waitFor(() => expect(screen.getByText("Source 0")).toBeTruthy());
    // 默认只 9 个。
    expect(document.querySelectorAll("[data-agent-source-item]")).toHaveLength(9);
    const more = document.querySelector("[data-agent-source-list-more]")!;
    expect(more.getAttribute("aria-expanded")).toBe("false");
    // 显示全部 → 12 个。
    fireEvent.click(more);
    await waitFor(() =>
      expect(document.querySelectorAll("[data-agent-source-item]").length).toBe(12),
    );
    expect(more.getAttribute("aria-expanded")).toBe("true");
    // 收起 → 回到 9。
    fireEvent.click(more);
    expect(document.querySelectorAll("[data-agent-source-item]")).toHaveLength(9);
  });

  it("源不足 9 个 → 不显示「显示全部」按钮", async () => {
    render(
      <AgentSourcePicker
        onSubmit={() => {}}
        enableSourceList
        listAgentSources={list(twoSources)}
      />,
    );
    await waitFor(() => expect(screen.getByText("Alpha")).toBeTruthy());
    expect(document.querySelector("[data-agent-source-list-more]")).toBeNull();
  });

  it("默认 variant=page → 不渲染对话框外壳", () => {
    render(<AgentSourcePicker onSubmit={() => {}} />);
    expect(document.querySelector("[data-agent-source-dialog]")).toBeNull();
    expect(document.querySelector("[data-agent-source-picker]")).toBeTruthy();
  });

  it("dialog 内点击列表项 → onSubmit(item.source)(会话内换源)", async () => {
    const onSubmit = vi.fn();
    render(
      <AgentSourcePicker
        onSubmit={onSubmit}
        variant="dialog"
        onClose={() => {}}
        enableSourceList
        listAgentSources={list(twoSources)}
      />,
    );
    await waitFor(() => expect(screen.getByText("Alpha")).toBeTruthy());
    // Radix Dialog portal 到 body,用 document 查询。
    fireEvent.click(document.querySelectorAll("[data-agent-source-item]")[0]!);
    expect(onSubmit).toHaveBeenCalledWith("/a");
  });

  it("未启用门控 → 不显示列表,仅手输框(Req 6.4)", () => {
    render(
      <AgentSourcePicker
        onSubmit={() => {}}
        enableSourceList={false}
        listAgentSources={list(twoSources)}
      />,
    );
    expect(document.querySelector("[data-agent-source-list]")).toBeNull();
    expect(document.querySelector("[data-agent-source-input]")).toBeTruthy();
  });
});

describe("AgentSourcePicker — 桌面原生目录选择(desktop-directory-picker)", () => {
  const inputValue = (c: ParentNode): string =>
    (c.querySelector("[data-agent-source-input]") as HTMLInputElement).value;

  it("未注入 onBrowseDirectory(浏览器态)→ 不渲染浏览按钮(Req 1.2)", () => {
    const { container } = render(<AgentSourcePicker onSubmit={() => {}} />);
    expect(container.querySelector("[data-agent-source-browse]")).toBeNull();
  });

  it("注入 onBrowseDirectory(桌面态)→ 渲染浏览按钮(Req 1.1)", () => {
    const { container } = render(
      <AgentSourcePicker
        onSubmit={() => {}}
        onBrowseDirectory={() => Promise.resolve(undefined)}
      />,
    );
    expect(container.querySelector("[data-agent-source-browse]")).toBeTruthy();
  });

  it("选中目录 → 回填来源框且不触发 onSubmit(Req 2.3/1.4)", async () => {
    const onSubmit = vi.fn();
    const { container } = render(
      <AgentSourcePicker
        onSubmit={onSubmit}
        onBrowseDirectory={() => Promise.resolve("/Users/x/proj")}
      />,
    );
    fireEvent.click(container.querySelector("[data-agent-source-browse]")!);
    await waitFor(() => expect(inputValue(container)).toBe("/Users/x/proj"));
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("取消(resolve undefined)→ 保持来源框原值,不触发 onSubmit(Req 2.5)", async () => {
    const onSubmit = vi.fn();
    const { container } = render(
      <AgentSourcePicker
        onSubmit={onSubmit}
        defaultSource="./keep"
        onBrowseDirectory={() => Promise.resolve(undefined)}
      />,
    );
    fireEvent.click(container.querySelector("[data-agent-source-browse]")!);
    await waitFor(() =>
      expect(
        (container.querySelector("[data-agent-source-browse]") as HTMLButtonElement)
          .disabled,
      ).toBe(false),
    );
    expect(inputValue(container)).toBe("./keep");
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("失败(reject)→ 保持原值,不建会话,手输框仍可用(Req 5.1/5.2)", async () => {
    const onSubmit = vi.fn();
    const { container } = render(
      <AgentSourcePicker
        onSubmit={onSubmit}
        defaultSource="./keep"
        onBrowseDirectory={() => Promise.reject(new Error("boom"))}
      />,
    );
    fireEvent.click(container.querySelector("[data-agent-source-browse]")!);
    await waitFor(() =>
      expect(
        (container.querySelector("[data-agent-source-browse]") as HTMLButtonElement)
          .disabled,
      ).toBe(false),
    );
    expect(inputValue(container)).toBe("./keep");
    expect(onSubmit).not.toHaveBeenCalled();
    // 手输框仍可编辑并提交。
    const input = container.querySelector("[data-agent-source-input]") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "./typed" } });
    fireEvent.click(container.querySelector("[data-agent-source-submit]")!);
    expect(onSubmit).toHaveBeenCalledWith("./typed");
  });

  it("创建中(loading)→ 浏览按钮禁用(与提交一致)", () => {
    const { container } = render(
      <AgentSourcePicker
        onSubmit={() => {}}
        loading
        onBrowseDirectory={() => Promise.resolve("/x")}
      />,
    );
    expect(
      (container.querySelector("[data-agent-source-browse]") as HTMLButtonElement)
        .disabled,
    ).toBe(true);
  });
});

describe("AgentSourcePicker — refreshSignal(spec install-host-command,任务 4.2)", () => {
  it("refreshSignal 变化 → 重拉列表(免刷新反映 /install 装/卸 agent 源后的最新结果)", async () => {
    const listAgentSources = vi.fn(list(twoSources));
    const { rerender } = render(
      <AgentSourcePicker
        onSubmit={() => {}}
        enableSourceList
        listAgentSources={listAgentSources}
        refreshSignal={0}
      />,
    );
    await waitFor(() => expect(listAgentSources).toHaveBeenCalledTimes(1));
    rerender(
      <AgentSourcePicker
        onSubmit={() => {}}
        enableSourceList
        listAgentSources={listAgentSources}
        refreshSignal={1}
      />,
    );
    await waitFor(() => expect(listAgentSources).toHaveBeenCalledTimes(2));
  });

  it("refreshSignal 未提供/未变化 → 不重复拉取", async () => {
    const listAgentSources = vi.fn(list(twoSources));
    const { rerender } = render(
      <AgentSourcePicker
        onSubmit={() => {}}
        enableSourceList
        listAgentSources={listAgentSources}
      />,
    );
    await waitFor(() => expect(listAgentSources).toHaveBeenCalledTimes(1));
    rerender(
      <AgentSourcePicker
        onSubmit={() => {}}
        enableSourceList
        listAgentSources={listAgentSources}
      />,
    );
    expect(listAgentSources).toHaveBeenCalledTimes(1);
  });
});
