/**
 * online-source-id(desktop-online-source-runnable 任务 1.1)—— `sourceId@channel` 形态判别。
 *
 * ★ 该判别在 `identify()` 中**优先级最高**(source-type.ts:105,先于 builtin:/git:/本地目录),
 * 误判即劫持本地源解析 → Req 8.1 回归。故不命中用例是本文件的主体,而非陪衬。
 */
import { describe, it, expect } from "vitest";
import {
  isOnlineSourceRef,
  parseOnlineSourceRef,
  formatOnlineSourceRef,
} from "../../src/agent-source/online-source-id.js";

describe("isOnlineSourceRef — 线上源形态判别", () => {
  it("命中 `sourceId@channel` 形态", () => {
    expect(isOnlineSourceRef("acme/canvas@stable")).toBe(true);
    expect(isOnlineSourceRef("acme/canvas@beta")).toBe(true);
    // 单段 id(无斜杠)同样合法 —— registry 不强制作用域前缀。
    expect(isOnlineSourceRef("canvas@stable")).toBe(true);
  });

  describe("不得劫持其他源形态(Req 8.1 回归护栏)", () => {
    it("本地路径一律不命中", () => {
      expect(isOnlineSourceRef("/abs/agent")).toBe(false);
      expect(isOnlineSourceRef("./agent")).toBe(false);
      expect(isOnlineSourceRef("../sibling")).toBe(false);
      expect(isOnlineSourceRef("~/agents/x")).toBe(false);
      // 含 @ 的本地路径是真实存在的形态(如 pnpm 作用域目录),必须让路。
      expect(isOnlineSourceRef("/abs/pkg@1.0.0")).toBe(false);
      expect(isOnlineSourceRef("./node_modules/@scope/pkg")).toBe(false);
    });

    it("URL / git / builtin 形态不命中", () => {
      expect(isOnlineSourceRef("https://host/user/repo@ref")).toBe(false);
      expect(isOnlineSourceRef("ssh://git@host/repo")).toBe(false);
      expect(isOnlineSourceRef("git:host/user/repo@ref")).toBe(false);
      expect(isOnlineSourceRef("builtin:default-agent")).toBe(false);
    });

    it("`@` 数量或位置不合法时不命中", () => {
      expect(isOnlineSourceRef("acme/canvas")).toBe(false); // 无 @
      expect(isOnlineSourceRef("acme/canvas@")).toBe(false); // channel 空
      expect(isOnlineSourceRef("@stable")).toBe(false); // sourceId 空
      expect(isOnlineSourceRef("a@b@c")).toBe(false); // 多个 @
    });

    it("空与空白不命中", () => {
      expect(isOnlineSourceRef("")).toBe(false);
      expect(isOnlineSourceRef("   ")).toBe(false);
      expect(isOnlineSourceRef("  @  ")).toBe(false);
    });

    it("含路径穿越或空字节的输入不命中", () => {
      expect(isOnlineSourceRef("../../etc/passwd@stable")).toBe(false);
      expect(isOnlineSourceRef("a/../b@stable")).toBe(false);
      expect(isOnlineSourceRef("a\0b@stable")).toBe(false);
    });
  });
});

describe("parseOnlineSourceRef — 解析", () => {
  it("拆出 sourceId 与 channel", () => {
    expect(parseOnlineSourceRef("acme/canvas@stable")).toEqual({
      sourceId: "acme/canvas",
      channel: "stable",
    });
  });

  it("不合法形态返回 undefined(与判别一致)", () => {
    expect(parseOnlineSourceRef("/abs/pkg@1.0.0")).toBeUndefined();
    expect(parseOnlineSourceRef("acme/canvas")).toBeUndefined();
    expect(parseOnlineSourceRef("a@b@c")).toBeUndefined();
  });
});

describe("formatOnlineSourceRef — 回写", () => {
  it("与 parse 互为逆运算", () => {
    const s = "acme/canvas@stable";
    const ref = parseOnlineSourceRef(s);
    expect(ref).toBeDefined();
    expect(formatOnlineSourceRef(ref!)).toBe(s);
  });
});
