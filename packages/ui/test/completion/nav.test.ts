/**
 * 补全键盘导航纯函数单测。
 */
import { describe, expect, it } from "vitest";
import {
  flattenSelectable,
  isSelectable,
  nextActiveIndex,
} from "../../src/completion/nav.js";
import type { CompletionItem } from "@blksails/pi-web-protocol";
import type { CompletionGroupView } from "../../src/completion/use-completion.js";

function item(id: string, kind: string, insertText?: string): CompletionItem {
  return {
    id,
    kind,
    label: id,
    ...(insertText !== undefined ? { insertText } : {}),
  } as CompletionItem;
}

describe("isSelectable", () => {
  it("占位项(insertText 空串)不可选", () => {
    expect(isSelectable(item("x", "file", ""))).toBe(false);
    expect(isSelectable(item("y", "file", "@file:y"))).toBe(true);
    expect(isSelectable(item("z", "file"))).toBe(true); // 无 insertText 视为可选
  });
});

describe("flattenSelectable", () => {
  it("跨组拍平并保持顺序、过滤占位项", () => {
    const groups: CompletionGroupView[] = [
      { kind: "file", items: [item("a", "file"), item("trunc", "file", "")] },
      { kind: "attachment", items: [item("b", "attachment")] },
    ];
    const flat = flattenSelectable(groups);
    expect(flat.map((i) => i.id)).toEqual(["a", "b"]);
  });

  it("空组返回空", () => {
    expect(flattenSelectable([])).toEqual([]);
  });
});

describe("nextActiveIndex", () => {
  it("向下环绕", () => {
    expect(nextActiveIndex(0, 3, 1)).toBe(1);
    expect(nextActiveIndex(2, 3, 1)).toBe(0);
  });
  it("向上环绕", () => {
    expect(nextActiveIndex(0, 3, -1)).toBe(2);
    expect(nextActiveIndex(1, 3, -1)).toBe(0);
  });
  it("空集返回 0", () => {
    expect(nextActiveIndex(0, 0, 1)).toBe(0);
  });
});
