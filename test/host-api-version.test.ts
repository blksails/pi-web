/**
 * 宿主 web-kit 版本自述的一致性护栏(#33)。
 *
 * 缺陷背景:`server/bootstrap.ts` 曾用 `env.NEXT_PUBLIC_PI_WEB_KIT_VERSION ?? "0.1.0"`,
 * 而 `@blksails/pi-web-kit` 实际早已到 0.5.0。生产未设该 env ⇒ 宿主自称 0.1.0,与真实
 * 版本脱节,并使「填对版本」与「填错版本」的后果相反(见 extension-gate 的实现注释)。
 *
 * 修复把版本对齐从「人的纪律」变成「机制」:构建期从 `packages/web-kit/package.json`
 * 读出并经 `__PI_WEB_KIT_VERSION__` 内联。**本文件是该机制的护栏** —— 一旦有人改回
 * 硬编码、或两侧 define 失效导致注入丢失,这里立刻红。
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { resolveHostApiVersion } from "@/server/bootstrap";

const webKitVersion: string = JSON.parse(
  readFileSync(join(process.cwd(), "packages/web-kit/package.json"), "utf8"),
).version;

describe("宿主 web-kit 版本自述(#33)", () => {
  it("★ 无 env 覆盖时,宿主自述版本必须等于 web-kit 包的真实版本", () => {
    // 这条断言的价值不在"当前值是多少",而在"两者必须永远相等" ——
    // 版本脱节正是 #33 的病因,而脱节是静默的:不会有任何报错,只会让扩展莫名其妙被拒。
    expect(resolveHostApiVersion({} as NodeJS.ProcessEnv)).toBe(webKitVersion);
  });

  it("版本号形如 x.y.z(注入值不是占位符或空串)", () => {
    expect(webKitVersion).toMatch(/^\d+\.\d+\.\d+/);
    expect(resolveHostApiVersion({} as NodeJS.ProcessEnv)).toMatch(/^\d+\.\d+\.\d+/);
  });

  it("env 仍可覆盖(应急/特殊部署),但只是覆盖、不再是默认值来源", () => {
    const env = { NEXT_PUBLIC_PI_WEB_KIT_VERSION: "9.9.9" } as unknown as NodeJS.ProcessEnv;
    expect(resolveHostApiVersion(env)).toBe("9.9.9");
  });

  it("空串 env 视同未设置,回落到注入的真实版本", () => {
    const env = { NEXT_PUBLIC_PI_WEB_KIT_VERSION: "  " } as unknown as NodeJS.ProcessEnv;
    expect(resolveHostApiVersion(env)).toBe(webKitVersion);
  });
});
