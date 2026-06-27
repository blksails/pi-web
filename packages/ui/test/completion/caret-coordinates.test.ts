/**
 * caret 像素坐标工具单测。
 *
 * jsdom 不执行布局(offsetTop/offsetLeft 恒 0),故此处只验证:SSR/无 el 守卫、返回结构
 * 契约、以及调用后无镜像 div 残留在 document.body。像素正确性由浏览器 e2e 覆盖。
 */
import { describe, expect, it } from "vitest";
import { getCaretCoordinates } from "../../src/completion/caret-coordinates.js";

describe("getCaretCoordinates", () => {
  it("无 el 返回零坐标", () => {
    expect(getCaretCoordinates(null, 0)).toEqual({ top: 0, left: 0, height: 0 });
    expect(getCaretCoordinates(undefined, 3)).toEqual({
      top: 0,
      left: 0,
      height: 0,
    });
  });

  it("返回 {top,left,height} 结构契约", () => {
    const el = document.createElement("textarea");
    el.value = "hello world";
    document.body.appendChild(el);
    const c = getCaretCoordinates(el, 5);
    expect(typeof c.top).toBe("number");
    expect(typeof c.left).toBe("number");
    expect(typeof c.height).toBe("number");
    document.body.removeChild(el);
  });

  it("调用后 document.body 无镜像 div 残留", () => {
    const el = document.createElement("textarea");
    el.value = "line1\nline2";
    document.body.appendChild(el);
    const before = document.body.childElementCount;
    getCaretCoordinates(el, 8);
    getCaretCoordinates(el, 0);
    expect(document.body.childElementCount).toBe(before);
    document.body.removeChild(el);
  });

  it("offset 越界不抛", () => {
    const el = document.createElement("textarea");
    el.value = "abc";
    document.body.appendChild(el);
    expect(() => getCaretCoordinates(el, 999)).not.toThrow();
    expect(() => getCaretCoordinates(el, -5)).not.toThrow();
    document.body.removeChild(el);
  });
});
