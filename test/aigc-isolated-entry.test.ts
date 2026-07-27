/**
 * examples/aigc-agent · 隔离宿主产物自检。
 *
 * 隔离宿主(opaque-origin iframe 车道,如 pi-clouds cloud 的 pane-loader)对 dist entry 有两条
 * 硬要求,二者缺一即「加载成功但屏幕空白」——本测试把它们钉成确定性闸:
 *  ① **自包含**:iframe 是独立 realm,拿不到宿主单例桥,产物内不得残留裸 specifier(react 等);
 *  ② **自挂载**:entry 须自己 mount 到 loader 的 `#pane-root` 并建 guest 通道
 *     (webext 入口 `web.config.tsx` 导出的是描述符对象,不满足此条 —— 故另立 isolated 入口)。
 * 另验样式自注入:隔离形态的 HTML 是宿主第一方的 pane-loader,不含本源样式。
 *
 * 依赖 `pnpm build:example:aigc` 先产物(CI 中 build 步骤在 test 之前)。
 */
import { createHash } from "node:crypto";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const DIST = resolve(__dirname, "..", "examples", "aigc-agent", ".pi", "web", "dist");
const ISOLATED = resolve(DIST, "web-extension.isolated.mjs");
/** manifest.entry 指的分派器(按 realm 选下面两份之一);见 examples/aigc-agent/build.ts。 */
const DISPATCHER = resolve(DIST, "web-extension.mjs");
const EXTERNAL = resolve(DIST, "web-extension.external.mjs");

/** 取 ESM 里的裸 specifier(排除相对路径/绝对 URL)。 */
function bareSpecifiers(code: string): string[] {
  const out = new Set<string>();
  for (const m of code.matchAll(/\bfrom\s*"([^"]+)"/g)) {
    const s = m[1] ?? "";
    if (s === "" || s.startsWith(".") || s.startsWith("/") || s.includes("://")) continue;
    // 排除正则误伤:合法包名不含空格/花括号。
    if (/[\s{}[\]]/.test(s)) continue;
    out.add(s);
  }
  return [...out].sort();
}

describe("aigc 隔离宿主产物(web-extension.isolated.mjs)", () => {
  it("产物存在(需先跑 build:example:aigc)", () => {
    expect(existsSync(ISOLATED)).toBe(true);
  });

  it("① 自包含:无任何裸 specifier —— 独立 realm 内无 import map 可依", () => {
    expect(bareSpecifiers(readFileSync(ISOLATED, "utf8"))).toEqual([]);
  });

  it("② 自挂载:挂 loader 的 #pane-root,并读 loader 写入的 __PANE_ID__", () => {
    const code = readFileSync(ISOLATED, "utf8");
    expect(code).toContain("pane-root");
    expect(code).toContain("__PANE_ID__");
  });

  it("样式自注入:隔离形态的 HTML 由宿主提供,不含本源样式", () => {
    expect(readFileSync(ISOLATED, "utf8")).toContain("aigc-pane-styles");
  });

  it("对照:同源 external 版**仍**保持单例 external(不得被自包含化污染)", () => {
    const bare = bareSpecifiers(readFileSync(EXTERNAL, "utf8"));
    expect(bare).toContain("react");
    expect(bare).toContain("react-dom");
    expect(bare).toContain("@blksails/pi-web-kit");
  });

  it("分派器:manifest.entry 恒为 web-extension.mjs,内容按 realm 选另两份之一", () => {
    const manifest = JSON.parse(readFileSync(resolve(DIST, "manifest.json"), "utf8")) as {
      entry?: string;
      integrity?: string;
    };
    expect(manifest.entry).toBe("web-extension.mjs");
    const code = readFileSync(DISPATCHER, "utf8");
    // 判据只能是「import("react") 是否可解析」——同源宿主有 import map,隔离 realm 没有。
    expect(code).toContain('await import("react")');
    expect(code).toContain("./web-extension.external.mjs");
    expect(code).toContain("./web-extension.isolated.mjs");
  });

  it("分派器 SRI 与 manifest.integrity 一致 —— 否则同源宿主 verifyExtension 直接拒", () => {
    const manifest = JSON.parse(readFileSync(resolve(DIST, "manifest.json"), "utf8")) as {
      integrity?: string;
    };
    const digest = createHash("sha384").update(readFileSync(DISPATCHER)).digest("base64");
    expect(manifest.integrity).toBe(`sha384-${digest}`);
  });
});
