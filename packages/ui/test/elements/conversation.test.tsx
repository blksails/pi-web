import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, act } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { Conversation } from "../../src/elements/conversation.js";

/**
 * jsdom 不实现真实布局,scrollTop/scrollHeight/clientHeight 默认都是 0。
 * 这里提供一组工具在受测的滚动容器上注入受控的滚动几何,从而驱动三态:
 *  - 贴底:scrollTop + clientHeight >= scrollHeight - threshold
 *  - 离底:scrollTop + clientHeight <  scrollHeight - threshold
 */
function getScroller(): HTMLElement {
  const el = document.querySelector("[data-pi-conversation-viewport]");
  if (el === null) throw new Error("conversation viewport not found");
  return el as HTMLElement;
}

function setScrollGeometry(
  el: HTMLElement,
  geo: { scrollTop: number; clientHeight: number; scrollHeight: number },
): void {
  Object.defineProperty(el, "clientHeight", {
    configurable: true,
    get: () => geo.clientHeight,
  });
  Object.defineProperty(el, "scrollHeight", {
    configurable: true,
    get: () => geo.scrollHeight,
  });
  // scrollTop 可写,直接赋值即可。
  el.scrollTop = geo.scrollTop;
}

function fireScroll(el: HTMLElement): void {
  act(() => {
    el.dispatchEvent(new Event("scroll"));
  });
}

describe("Conversation 自动滚动元件", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    // jsdom 未实现 Element.scrollTo;提供本地 no-op polyfill 以便 spy 可挂载。
    if (typeof HTMLElement.prototype.scrollTo !== "function") {
      Object.defineProperty(HTMLElement.prototype, "scrollTo", {
        configurable: true,
        writable: true,
        value: function scrollTo(): void {
          /* no-op for jsdom */
        },
      });
    }
  });

  it("贴底时新内容到达自动滚动到底 (Req 7.1)", () => {
    const { rerender } = render(
      <Conversation>
        <div style={{ height: 100 }}>m1</div>
      </Conversation>,
    );
    const el = getScroller();
    // 初始贴底:scrollTop(0) + clientHeight(100) >= scrollHeight(100)
    setScrollGeometry(el, { scrollTop: 0, clientHeight: 100, scrollHeight: 100 });
    fireScroll(el);

    const scrollToBottom = vi.fn();
    // 监听新内容到达后的滚动行为:scrollTo / scrollTop 赋值。
    const scrollToSpy = vi
      .spyOn(el, "scrollTo")
      .mockImplementation(((...args: unknown[]) => {
        scrollToBottom(...args);
      }) as typeof el.scrollTo);

    // 新内容到达:scrollHeight 增长。
    act(() => {
      setScrollGeometry(el, {
        scrollTop: 0,
        clientHeight: 100,
        scrollHeight: 300,
      });
      rerender(
        <Conversation>
          <div style={{ height: 300 }}>m1 m2</div>
        </Conversation>,
      );
    });

    // 贴底状态下应自动滚动到底(经 scrollTo 或直接设置 scrollTop 到底)。
    const scrolledToBottom =
      scrollToSpy.mock.calls.length > 0 || el.scrollTop === 300 - 100;
    expect(scrolledToBottom).toBe(true);
    // 贴底时不应显示"回到底部"按钮。
    expect(
      screen.queryByRole("button", { name: /回到底部|scroll to bottom/i }),
    ).not.toBeInTheDocument();
  });

  it("离底时停止自动滚动并显示回到底部按钮(带 aria-label)(Req 7.2)", () => {
    const { rerender } = render(
      <Conversation>
        <div style={{ height: 300 }}>m1</div>
      </Conversation>,
    );
    const el = getScroller();
    // 用户向上滚动离底:scrollTop(0) + clientHeight(100) < scrollHeight(300)
    setScrollGeometry(el, { scrollTop: 0, clientHeight: 100, scrollHeight: 300 });
    fireScroll(el);

    // 离底应出现"回到底部"按钮且带 aria-label。
    const btn = screen.getByRole("button", {
      name: /回到底部|scroll to bottom/i,
    });
    expect(btn).toBeInTheDocument();
    expect(btn).toHaveAttribute("aria-label");

    // 离底时新内容到达不应强制滚动到底(不调用 scrollTo)。
    const scrollToSpy = vi
      .spyOn(el, "scrollTo")
      .mockImplementation((() => undefined) as typeof el.scrollTo);
    act(() => {
      setScrollGeometry(el, {
        scrollTop: 0,
        clientHeight: 100,
        scrollHeight: 600,
      });
      rerender(
        <Conversation>
          <div style={{ height: 600 }}>m1 m2</div>
        </Conversation>,
      );
    });
    expect(scrollToSpy).not.toHaveBeenCalled();
  });

  it("点击回到底部:平滑滚动到底并恢复自动滚动 (Req 7.3)", async () => {
    const user = userEvent.setup();
    render(
      <Conversation>
        <div style={{ height: 300 }}>m1</div>
      </Conversation>,
    );
    const el = getScroller();
    setScrollGeometry(el, { scrollTop: 0, clientHeight: 100, scrollHeight: 300 });
    fireScroll(el);

    const scrollToSpy = vi
      .spyOn(el, "scrollTo")
      .mockImplementation((() => undefined) as typeof el.scrollTo);

    const btn = screen.getByRole("button", {
      name: /回到底部|scroll to bottom/i,
    });
    await user.click(btn);

    // 平滑滚动到底:scrollTo 被调用,且 behavior 为 smooth、目标为底部。
    expect(scrollToSpy).toHaveBeenCalled();
    const lastCall = scrollToSpy.mock.calls[scrollToSpy.mock.calls.length - 1];
    const arg = lastCall?.[0] as ScrollToOptions | undefined;
    expect(arg?.behavior).toBe("smooth");
    expect(arg?.top).toBe(300 - 100);

    // 点击后,模拟滚动事件回到贴底,按钮应消失(恢复自动滚动)。
    act(() => {
      setScrollGeometry(el, {
        scrollTop: 200,
        clientHeight: 100,
        scrollHeight: 300,
      });
      el.dispatchEvent(new Event("scroll"));
    });
    expect(
      screen.queryByRole("button", { name: /回到底部|scroll to bottom/i }),
    ).not.toBeInTheDocument();
  });

  it("渲染滚动容器与 children", () => {
    render(
      <Conversation className="custom-x">
        <div data-testid="child">hello</div>
      </Conversation>,
    );
    expect(screen.getByTestId("child")).toBeInTheDocument();
    const el = getScroller();
    expect(el).toBeInTheDocument();
  });
});
