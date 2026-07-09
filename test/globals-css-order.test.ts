/**
 * `src/globals.css` 的 at-rule 顺序守卫。
 *
 * CSS 规范要求 `@import` 排在所有其它语句之前。旧宿主的 postcss 链容忍 `@tailwind` 在前,
 * Vite 不:postcss 报 "@import must precede all other statements" 并**直接丢弃**那些 @import。
 *
 * 后果是静默的 —— 构建照常成功,只在日志里留一行警告,而 shadcn 主题变量与 canvas 领域样式
 * 整个不进产物。页面还能用,只是完全没有主题。此测试把它钉死在单测层。
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const CSS = readFileSync(join(process.cwd(), "src/globals.css"), "utf8");

/** 按出现顺序取出顶层 at-rule 名(忽略注释与空行)。 */
function atRules(css: string): string[] {
  return [...css.matchAll(/^@([a-z-]+)/gm)].map((m) => m[1] as string);
}

describe("globals.css at-rule 顺序", () => {
  it("所有 @import 都排在第一个 @tailwind 之前", () => {
    const rules = atRules(CSS);
    const firstTailwind = rules.indexOf("tailwind");
    expect(firstTailwind, "应存在 @tailwind 指令").toBeGreaterThanOrEqual(0);

    const lastImport = rules.lastIndexOf("import");
    expect(lastImport, "应存在 @import").toBeGreaterThanOrEqual(0);
    expect(
      lastImport,
      "@import 必须先于 @tailwind,否则 postcss 会静默丢弃它们",
    ).toBeLessThan(firstTailwind);
  });

  it("仍然引入了 ui 与 canvas-ui 两个样式包", () => {
    expect(CSS).toContain("@blksails/pi-web-ui/styles.css");
    expect(CSS).toContain("@blksails/pi-web-canvas-ui/styles.css");
  });

  it("被引入的样式包确实定义了 shadcn 主题 token", () => {
    const ui = readFileSync(join(process.cwd(), "packages/ui/src/styles.css"), "utf8");
    for (const token of ["--background", "--foreground", "--primary", "--radius"]) {
      expect(ui, `ui/styles.css 应定义 ${token}`).toContain(`${token}:`);
    }
  });
});
