/**
 * `isEntryModule` — 进程入口判定。
 *
 * 回归依据:改造前判定写成 `import.meta.url === \`file://${process.argv[1]}\``,字符串拼接
 * 不做 percent 编码,路径含空格或在 Windows 上一律不相等 → `main()` 静默不执行,进程零
 * 输出以 0 退出。直接跑 `src/runner/runner.ts` 是被文档化且被 it/e2e 使用的入口形态,
 * 故该失败面真实存在。
 */
import { describe, expect, it } from "vitest";
import { pathToFileURL } from "node:url";
import { isEntryModule } from "../../src/runner/runner.js";

describe("isEntryModule", () => {
  it("普通路径:自身即入口 → true", () => {
    const p = "/tmp/pi/runner.ts";
    expect(isEntryModule(pathToFileURL(p).href, p)).toBe(true);
  });

  it("★含空格的路径仍判定为入口(拼接式实现在此假阴性)", () => {
    const p = "/Users/a b/pi/runner.ts";
    expect(isEntryModule(pathToFileURL(p).href, p)).toBe(true);
    // 证明旧实现确实会漏判,而非本用例在自证同义反复。
    expect(`file://${p}`).not.toBe(pathToFileURL(p).href);
  });

  it("★含非 ASCII 的路径仍判定为入口", () => {
    const p = "/Users/用户/pi/runner.ts";
    expect(isEntryModule(pathToFileURL(p).href, p)).toBe(true);
  });

  it("被别的模块 import 时(argv[1] 是另一个文件)→ false", () => {
    const self = pathToFileURL("/tmp/pi/runner.ts").href;
    expect(isEntryModule(self, "/tmp/pi/vitest-entry.js")).toBe(false);
  });

  it("argv[1] 缺席或为空 → false", () => {
    const self = pathToFileURL("/tmp/pi/runner.ts").href;
    expect(isEntryModule(self, undefined)).toBe(false);
    expect(isEntryModule(self, "")).toBe(false);
  });
});
