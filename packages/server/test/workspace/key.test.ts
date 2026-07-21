import { describe, expect, it } from "vitest";
import { assertWorkspaceKey, validateWorkspaceKey } from "../../src/workspace/key.js";
import { WorkspaceKeyError } from "../../src/workspace/types.js";

/**
 * host-contract-ports 任务 2.1 —— 键空间校验(Req 1.1-1.6)。
 *
 * ⚠ 这是**安全边界**用例:本地实现把键映射为真实路径,校验疏漏 = 路径穿越。
 * 故非法形态**穷举**而非抽样。
 */

/** 断言抛出的是键错误,且按 `code` 判别(不用 instanceof —— 见 types.ts 的说明)。 */
function expectKeyError(key: string): WorkspaceKeyError {
  let caught: unknown;
  try {
    validateWorkspaceKey(key);
  } catch (err) {
    caught = err;
  }
  expect(caught, `expected key ${JSON.stringify(key)} to be rejected`).toBeDefined();
  const e = caught as WorkspaceKeyError;
  expect(e.code).toBe("key");
  expect(e.key).toBe(key);
  return e;
}

describe("非法键:穷举(Req 1.1-1.4)", () => {
  it("空串被拒(Req 1.4)", () => {
    expectKeyError("");
  });

  it("绝对路径被拒(Req 1.2)", () => {
    for (const k of ["/settings.json", "/", "//a", "/a/b.json"]) {
      expectKeyError(k);
    }
  });

  it("相对段 . 与 .. 被拒 —— 含首/中/尾各位置(Req 1.1)", () => {
    for (const k of [
      "..",
      ".",
      "../secrets.json",
      "a/../../etc/passwd",
      "a/./b.json",
      "a/..",
      "a/b/..",
      "sources/../../x.json",
    ]) {
      expectKeyError(k);
    }
  });

  it("空段被拒:连续分隔符与尾随分隔符(Req 1.3)", () => {
    for (const k of ["a//b.json", "a/b//", "a/", "a/b/", "a///b"]) {
      expectKeyError(k);
    }
  });

  it("反斜杠被拒 —— 否则在 Windows 上构成第二条穿越通道(Req 1.3)", () => {
    for (const k of ["a\\b.json", "..\\secrets.json", "a\\..\\b", "\\abs"]) {
      expectKeyError(k);
    }
  });

  it("空字符被拒 —— 否则可截断底层系统调用的路径(Req 1.3)", () => {
    for (const k of ["a\0b.json", "settings.json\0", "\0"]) {
      expectKeyError(k);
    }
  });

  it("错误携带可读原因,便于定位是哪条规则拦下的", () => {
    expect(expectKeyError("..").reason).toContain("relative segment");
    expect(expectKeyError("/abs").reason).toContain("relative");
    expect(expectKeyError("a//b").reason).toContain("empty segment");
    expect(expectKeyError("a\\b").reason).toContain("backslash");
    expect(expectKeyError("a\0b").reason).toContain("NUL");
    expect(expectKeyError("").reason).toContain("non-empty");
  });
});

describe("合法键(Req 1.6)", () => {
  it("单段与多段相对键被接受", () => {
    for (const k of [
      "settings.json",
      "logging.json",
      "a/b.json",
      "sources/0123456789abcdef/settings.json",
      "attachments/att_xyz.att.json",
      "a/b/c/d/e.json",
      // 段内含点是合法的(只有整段等于 "." 或 ".." 才非法)。
      "a.b/c..d.json",
      "..hidden.json",
      "x..",
    ]) {
      expect(() => validateWorkspaceKey(k), `expected ${k} to be accepted`).not.toThrow();
    }
  });

  it("键大小写敏感:不做任何归一化(Req 1.5)", () => {
    // 两者都合法且互不相干 —— 本层不做大小写折叠,也不因此报错。
    expect(() => validateWorkspaceKey("Settings.json")).not.toThrow();
    expect(() => validateWorkspaceKey("settings.json")).not.toThrow();
    expect(assertWorkspaceKey("Settings.json")).toBe("Settings.json");
  });

  it("assert 变体原样返回键,便于表达式位置使用", () => {
    expect(assertWorkspaceKey("a/b.json")).toBe("a/b.json");
    expect(() => assertWorkspaceKey("../x")).toThrow();
  });
});
