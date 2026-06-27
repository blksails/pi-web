/**
 * PiCompletionPopover 交互单测(jsdom + Testing Library)。
 *
 * 覆盖键盘导航(↑↓/Enter/Esc)、查询刷新重置高亮、鼠标悬停同步、占位项不可选、选中经
 * onChange 写回并对 textarea setSelectionRange 复位光标(completion-cursor-anchor R3/R4)。
 * caret 像素定位依赖真实 layout,由浏览器 e2e 覆盖;此处用 jsdom 验证交互逻辑。
 */
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { act, cleanup, render, fireEvent } from "@testing-library/react";
import * as React from "react";
import { PiCompletionPopover } from "../../src/completion/pi-completion-popover.js";
import type {
  CompletionItem,
  CompletionResponse,
  CompletionTriggersResponse,
} from "@blksails/pi-web-protocol";
import type { CompletionClient } from "../../src/completion/use-completion.js";

function fileItem(id: string, insertText?: string): CompletionItem {
  return {
    id,
    kind: "file",
    label: id,
    insertText: insertText ?? `@file:${id}`,
  } as CompletionItem;
}

function makeClient(items: CompletionItem[]): CompletionClient {
  return {
    getCompletionTriggers: vi.fn(
      async (): Promise<CompletionTriggersResponse> => ({
        triggers: [{ trigger: "@", extract: "wordTail" }],
      }),
    ),
    getCompletion: vi.fn(
      async (): Promise<CompletionResponse> =>
        ({ items, groups: [] }) as unknown as CompletionResponse,
    ),
  };
}

/** 受控外壳:把 textarea 与浮层接线,模拟 PiChat 的 value/cursor/inputRef。 */
function Harness({
  client,
  initial = "@a",
}: {
  client: CompletionClient;
  initial?: string;
}): React.JSX.Element {
  const [value, setValue] = React.useState(initial);
  const inputRef = React.useRef<HTMLTextAreaElement | null>(null);
  return (
    <div>
      <textarea
        ref={inputRef}
        data-testid="ta"
        value={value}
        onChange={(e) => setValue(e.target.value)}
      />
      <PiCompletionPopover
        value={value}
        cursor={value.length}
        onChange={setValue}
        client={client}
        sessionId="s1"
        inputRef={inputRef}
      />
    </div>
  );
}

async function renderOpen(client: CompletionClient, initial = "@a") {
  const utils = render(<Harness client={client} initial={initial} />);
  // 等待 triggers + getCompletion 两段异步 microtask 落定并打开浮层。
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
  return utils;
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  // rAF 在 fake timers 下不自动触发;stub 为同步以验证选中后的光标复位。
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback): number => {
    cb(0);
    return 0;
  });
});
afterEach(() => {
  vi.runOnlyPendingTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  cleanup();
});

/** 推进 useCompletion 的 120ms 防抖 + 异步 fetch。 */
async function flush(): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(150);
    await Promise.resolve();
  });
}

describe("PiCompletionPopover 键盘导航", () => {
  it("打开后默认高亮首项;↓ 移到第二项,↑ 回到首项", async () => {
    const client = makeClient([fileItem("alpha"), fileItem("beta")]);
    const { container } = await renderOpen(client);
    await flush();

    const popover = container.querySelector("[data-pi-completion-popover]");
    expect(popover).not.toBeNull();
    const items = () =>
      Array.from(container.querySelectorAll("[data-pi-completion-item]"));
    expect(items()[0]?.getAttribute("aria-selected")).toBe("true");

    await act(async () => {
      fireEvent.keyDown(document, { key: "ArrowDown" });
    });
    expect(items()[1]?.getAttribute("aria-selected")).toBe("true");
    expect(items()[0]?.getAttribute("aria-selected")).toBe("false");

    await act(async () => {
      fireEvent.keyDown(document, { key: "ArrowUp" });
    });
    expect(items()[0]?.getAttribute("aria-selected")).toBe("true");
  });

  it("Enter 选中当前高亮 → onChange 写回 token + setSelectionRange 复位光标", async () => {
    const client = makeClient([fileItem("alpha"), fileItem("beta")]);
    const { getByTestId } = await renderOpen(client);
    await flush();
    const ta = getByTestId("ta") as HTMLTextAreaElement;
    const spy = vi.spyOn(ta, "setSelectionRange");

    // 下移到第二项再 Enter。
    await act(async () => {
      fireEvent.keyDown(document, { key: "ArrowDown" });
    });
    await act(async () => {
      fireEvent.keyDown(document, { key: "Enter" });
    });
    // 插入 "@file:beta " → value 含该 token。
    expect(ta.value).toMatch(/@file:beta\s/);
    // rAF 回调里复位光标。
    await act(async () => {
      vi.runOnlyPendingTimers();
      await Promise.resolve();
    });
    expect(spy).toHaveBeenCalled();
  });

  it("Esc 关闭浮层(不清空输入)", async () => {
    const client = makeClient([fileItem("alpha")]);
    const { container, getByTestId } = await renderOpen(client);
    await flush();
    expect(
      container.querySelector("[data-pi-completion-popover]"),
    ).not.toBeNull();

    await act(async () => {
      fireEvent.keyDown(document, { key: "Escape" });
    });
    expect(container.querySelector("[data-pi-completion-popover]")).toBeNull();
    // 输入未被清空。
    expect((getByTestId("ta") as HTMLTextAreaElement).value).toBe("@a");
  });

  it("鼠标悬停同步高亮", async () => {
    const client = makeClient([fileItem("alpha"), fileItem("beta")]);
    const { container } = await renderOpen(client);
    await flush();
    const items = Array.from(
      container.querySelectorAll("[data-pi-completion-item]"),
    );
    await act(async () => {
      fireEvent.mouseEnter(items[1]!);
    });
    expect(items[1]?.getAttribute("aria-selected")).toBe("true");
  });

  it("占位项(insertText 空串)不可选:点击不写回", async () => {
    const placeholder = fileItem("more", "");
    const client = makeClient([fileItem("alpha"), placeholder]);
    const { container, getByTestId } = await renderOpen(client);
    await flush();
    const ta = getByTestId("ta") as HTMLTextAreaElement;
    const before = ta.value;
    const placeholderEl = container.querySelector(
      '[data-pi-completion-item="more"]',
    );
    await act(async () => {
      fireEvent.click(placeholderEl!);
    });
    expect(ta.value).toBe(before); // 未写回
  });
});
