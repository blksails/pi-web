/**
 * webext 浮层 caret 锚定单测(completion-cursor-anchor R6 延伸)。
 *
 * PiMentionPopover / PiAutocompletePopover 与 @/`/` 一致,经 useCaretAnchor 以
 * position:fixed 锚定光标(不再依赖外层全宽 absolute bottom-full 容器)。jsdom 无 layout,
 * 故只验证 position:fixed 与基本渲染/选中;像素由浏览器 e2e 覆盖。
 */
import { describe, it, expect, vi } from "vitest";
import * as React from "react";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { PiMentionPopover } from "../../src/controls/pi-mention-popover.js";
import { PiAutocompletePopover } from "../../src/controls/pi-autocomplete-popover.js";
import type { UiRpcClient } from "@blksails/pi-web-kit";

const uiRpc = {} as unknown as UiRpcClient;

describe("PiMentionPopover caret 锚定", () => {
  it("有候选时经 fixed 锚定渲染,点击候选替换 token", async () => {
    const onChange = vi.fn();
    const inputRef = React.createRef<HTMLTextAreaElement>();
    const contribution = {
      query: vi.fn(async () => [{ id: "u1", label: "alice" }]),
    };
    render(
      <div>
        <textarea ref={inputRef} defaultValue="hi @al" />
        <PiMentionPopover
          value="hi @al"
          onChange={onChange}
          contribution={contribution}
          uiRpc={uiRpc}
          inputRef={inputRef}
        />
      </div>,
    );
    await waitFor(() => {
      expect(
        document.querySelector("[data-pi-mention-popover]"),
      ).toBeInTheDocument();
    });
    const pop = document.querySelector(
      "[data-pi-mention-popover]",
    ) as HTMLElement;
    expect(pop.style.position).toBe("fixed");

    fireEvent.click(screen.getByText("@alice"));
    // mention 起点在 "hi " 之后(idx 3),替换为 "@alice "。
    expect(onChange).toHaveBeenCalledWith("hi @alice ");
  });
});

describe("PiAutocompletePopover caret 锚定", () => {
  it("激活且有候选时经 fixed 锚定渲染,点击替换为 insertText", async () => {
    const onChange = vi.fn();
    const inputRef = React.createRef<HTMLTextAreaElement>();
    const contribution = {
      complete: vi.fn(async () => [
        { label: "fix typo", insertText: "Fix the typo in README" },
      ]),
    };
    render(
      <div>
        <textarea ref={inputRef} defaultValue="fix" />
        <PiAutocompletePopover
          value="fix"
          onChange={onChange}
          contribution={contribution}
          uiRpc={uiRpc}
          cursor={3}
          inputRef={inputRef}
        />
      </div>,
    );
    await waitFor(() => {
      expect(document.querySelector("[data-pi-autocomplete]")).toBeInTheDocument();
    });
    const pop = document.querySelector("[data-pi-autocomplete]") as HTMLElement;
    expect(pop.style.position).toBe("fixed");

    fireEvent.click(screen.getByText("fix typo"));
    expect(onChange).toHaveBeenCalledWith("Fix the typo in README");
  });
});
