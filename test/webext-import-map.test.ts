/**
 * `index.html` 的单例 import map 与 `WEBEXT_IMPORT_MAP` 的漂移守卫
 * (spec vite-spa-migration,Req 4.1)。
 *
 * SPA 下 import map 是**静态写死**在入口文档里的(浏览器只认首个 import 前的 import map,
 * 无法在运行时注入)。它必须与服务端单例端点的路径常量逐字一致 —— 不一致时代码 webext
 * 的裸 specifier 会解析失败,且失败发生在浏览器里、只有 e2e 能发现。此测试把它提前到单测。
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { WEBEXT_IMPORT_MAP } from "@/lib/app/webext-singletons";

function importMapFromIndexHtml(): unknown {
  const html = readFileSync(join(process.cwd(), "index.html"), "utf8");
  const m = html.match(
    /<script\s+type="importmap"\s*>([\s\S]*?)<\/script>/,
  );
  if (m === null) throw new Error("index.html 缺少 <script type=\"importmap\">");
  return JSON.parse(m[1] as string);
}

describe("webext import map", () => {
  it("index.html 的 import map 与 WEBEXT_IMPORT_MAP 逐字一致", () => {
    expect(importMapFromIndexHtml()).toEqual(WEBEXT_IMPORT_MAP);
  });

  it("四个裸 specifier 全部映射到单例端点", () => {
    const { imports } = WEBEXT_IMPORT_MAP;
    expect(Object.keys(imports).sort()).toEqual([
      "@blksails/pi-web-kit",
      "react",
      "react-dom",
      "react/jsx-runtime",
    ]);
    for (const url of Object.values(imports)) {
      expect(url.startsWith("/api/webext/singletons/")).toBe(true);
    }
  });
});
