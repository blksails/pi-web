import { describe, expect, it } from "vitest";
import { fileURLToPath, pathToFileURL } from "node:url";
import { runInNewContext } from "node:vm";
import type { Plugin } from "esbuild";
import {
  bundlePaneEntry,
  buildPaneCsp,
  buildPaneDocument,
  PANE_BASE_CSS,
  PANE_CSP,
  renderPaneDocument,
  renderPaneUrlDocument,
} from "../build/pane-document.js";

const fixture = (name: string): string =>
  fileURLToPath(new URL(`./fixtures/pane-entry/${name}`, import.meta.url));

/** 在带最小 `document` 桩的沙箱里执行 IIFE bundle,返回 `#root` 最终文本(验证「脚本可执行」)。 */
function runPaneScript(script: string): string | undefined {
  const root: { textContent: string | undefined } = { textContent: undefined };
  const document = {
    getElementById: (id: string) => (id === "root" ? root : null),
  };
  runInNewContext(script, { document, console });
  return root.textContent;
}

const virtualPaneFlagPlugin: Plugin = {
  name: "virtual-pane-flag",
  setup(build) {
    build.onResolve({ filter: /^virtual:pane-flag$/ }, (args) => ({
      path: args.path,
      namespace: "virtual-pane-flag",
    }));
    build.onLoad({ filter: /.*/, namespace: "virtual-pane-flag" }, () => ({
      contents: "export default 42;",
      loader: "ts",
    }));
  },
};

describe("buildPaneCsp", () => {
  it("默认输出与既有 PANE_CSP 字面量逐字节一致(回归钉)", () => {
    expect(buildPaneCsp()).toBe(
      "default-src 'none'; img-src blob: data: http: https:; style-src 'unsafe-inline'; script-src 'unsafe-inline'",
    );
    expect(PANE_CSP).toBe(buildPaneCsp());
  });

  it("scriptSrc 覆盖只替换 script-src,其余指令不变", () => {
    const csp = buildPaneCsp({ scriptSrc: ["'self'"] });
    expect(csp).toContain("script-src 'self'");
    expect(csp).toContain("img-src blob: data: http: https:");
    expect(csp).toContain("style-src 'unsafe-inline'");
    expect(csp).not.toContain("script-src 'unsafe-inline'");
  });

  it("connectSrc / mediaSrc 未提供时不声明对应指令,提供时追加", () => {
    expect(buildPaneCsp()).not.toContain("connect-src");
    expect(buildPaneCsp()).not.toContain("media-src");
    const csp = buildPaneCsp({ connectSrc: ["https://api.example.com"], mediaSrc: ["blob:"] });
    expect(csp).toContain("connect-src https://api.example.com");
    expect(csp).toContain("media-src blob:");
  });
});

describe("renderPaneDocument / renderPaneUrlDocument", () => {
  it("内联形态把脚本原样塞进 <script>,默认 CSP 为内联策略", () => {
    const html = renderPaneDocument("t", "console.log(1)", PANE_BASE_CSS);
    expect(html).toContain("<script>console.log(1)</script>");
    expect(html).not.toContain('script-src="self"');
    expect(html).toMatch(/script-src 'unsafe-inline'/);
  });

  it("URL 形态引用外部脚本、不内联代码,默认 CSP 含自身来源许可", () => {
    const html = renderPaneUrlDocument("t", "pane-x.js", PANE_BASE_CSS);
    expect(html).toContain('<script src="pane-x.js"></script>');
    expect(html).not.toContain("console.log");
    expect(html).toMatch(/script-src 'self'/);
  });

  it("csp 参数可覆盖两种形态各自的默认值", () => {
    const inline = renderPaneDocument("t", "1", PANE_BASE_CSS, "default-src 'none'");
    const url = renderPaneUrlDocument("t", "p.js", PANE_BASE_CSS, "default-src 'none'");
    expect(inline).toContain(`content="default-src 'none'"`);
    expect(url).toContain(`content="default-src 'none'"`);
  });
});

describe("bundlePaneEntry", () => {
  it("接受裸字符串入口(向后兼容既有调用方)", async () => {
    const script = await bundlePaneEntry(fixture("basic-entry.ts"));
    expect(runPaneScript(script)).toBe("pane-ready");
  });

  it("接受 file: URL 入口,产出与字符串形态字节一致", async () => {
    const path = fixture("basic-entry.ts");
    const byString = await bundlePaneEntry(path);
    const byUrl = await bundlePaneEntry(pathToFileURL(path));
    expect(byUrl).toBe(byString);
  });

  it("define 参数注入编译期常量;不注入时执行抛错,注入后按值渲染", async () => {
    const entry = fixture("define-entry.ts");
    await expect(async () => runPaneScript(await bundlePaneEntry(entry))).rejects.toThrow(
      /__PANE_LABEL__/,
    );

    const script = await bundlePaneEntry({
      entry,
      define: { __PANE_LABEL__: '"hello-define"' },
    });
    expect(runPaneScript(script)).toBe("hello-define");
  });

  it("plugins 参数注入 esbuild 插件;不注入时打包失败,注入后打包成功", async () => {
    const entry = fixture("plugin-entry.ts");
    await expect(bundlePaneEntry(entry)).rejects.toThrow();

    const script = await bundlePaneEntry({ entry, plugins: [virtualPaneFlagPlugin] });
    expect(runPaneScript(script)).toBe("42");
  });

  it("external 参数追加外置清单;不追加时打包失败,追加后打包成功", async () => {
    const entry = fixture("external-entry.ts");
    await expect(bundlePaneEntry(entry)).rejects.toThrow();

    const script = await bundlePaneEntry({ entry, external: ["not-a-real-package"] });
    expect(typeof script).toBe("string");
    expect(script.length).toBeGreaterThan(0);
  });
});

describe("buildPaneDocument", () => {
  it("接受 URL 入口(既有 string 形态签名同时保留)", async () => {
    const html = await buildPaneDocument({
      entry: pathToFileURL(fixture("basic-entry.ts")),
      title: "URL 入口",
    });
    expect(html).toContain("<title>URL 入口</title>");
  });
});

describe("同一入口的内联/URL 双形态构建", () => {
  it("两份文档均可独立打开且脚本可执行;URL 形态的策略含自身来源许可", async () => {
    const script = await bundlePaneEntry(fixture("basic-entry.ts"));
    const css = PANE_BASE_CSS;

    const inlineDoc = renderPaneDocument("双形态", script, css);
    const urlDoc = renderPaneUrlDocument("双形态", "pane-basic.js", css);

    // 结构上都是独立可打开的完整文档。
    for (const doc of [inlineDoc, urlDoc]) {
      expect(doc.startsWith("<!doctype html>")).toBe(true);
      expect(doc).toContain("<title>双形态</title>");
      expect(doc).toMatch(/Content-Security-Policy/);
    }

    // 内联形态自带脚本字节,可直接执行。
    expect(inlineDoc).toContain(script);
    expect(runPaneScript(script)).toBe("pane-ready");

    // URL 形态不内联代码,只引用同一份脚本产物;策略放行自身来源。
    expect(urlDoc).not.toContain(script);
    expect(urlDoc).toContain('<script src="pane-basic.js"></script>');
    expect(urlDoc).toMatch(/script-src 'self'/);
  });
});
