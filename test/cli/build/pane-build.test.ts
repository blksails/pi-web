// @vitest-environment node
/**
 * `buildPaneArtifacts` 单测(spec cli-agent-build,任务 3.5,Req 2.2, 4.3)。
 *
 * 覆盖:双形态产物(6 个可寻址文件 + 一份内联文档映射)、输入顺序稳定、单例插件确实被注入
 * (与 `react-singleton.test.ts` 同策略,造两份物理副本证明收敛)、`canvasStyles` 开关的样式
 * 选择与缺失防护、打包失败的错误包装、两次构建字节一致(可复现)。
 *
 * 全程用真实临时目录 + 真实 esbuild 打包(不 mock 文件系统或打包器)——与本 spec
 * `pane-discovery.test.ts`/`react-singleton.test.ts` 一致的策略,判别力来自真实字节输出。
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { runInNewContext } from "node:vm";
import { buildPaneArtifacts } from "@/server/cli/build/pane-build";
import type { PaneModule } from "@/server/cli/build/pane-discovery";
import { BuildError } from "@/server/cli/build/errors";
import { PANE_BASE_CSS, bundlePaneEntry } from "@/packages/web-kit/build/pane-document";

let root: string;
let sourceRoot: string;
let outDir: string;

const validCapabilities: PaneModule["capabilities"] = {
  routes: [],
  surfaceKeys: [],
  surfaceCommands: [],
  attachments: "none",
  conversation: "none",
  downloads: false,
  events: { publish: [], subscribe: [] },
  state: { read: [], write: [] },
};

/** 在 `path` 落一个最简 pane 入口:把 `marker` 写进 `#root.textContent`。 */
function seedPaneEntry(path: string, marker: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(
    path,
    `const root = document.getElementById("root");\nif (root) root.textContent = ${JSON.stringify(marker)};\nexport {};\n`,
  );
}

function makeModule(overrides: Partial<PaneModule> & { id: string; entry: string }): PaneModule {
  return {
    title: overrides.id,
    capabilities: validCapabilities,
    ...overrides,
  };
}

/** 在沙箱里执行内联/URL 双形态之一的脚本字节,返回 `#root` 最终文本。 */
function runPaneScript(script: string): string | undefined {
  const rootEl: { textContent: string | undefined } = { textContent: undefined };
  const document = { getElementById: (id: string) => (id === "root" ? rootEl : null) };
  runInNewContext(script, { document, console });
  return rootEl.textContent;
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "pane-build-test-"));
  sourceRoot = join(root, "source");
  outDir = join(root, "dist");
  mkdirSync(sourceRoot, { recursive: true });
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("buildPaneArtifacts: 双形态产物(Req 2.2)", () => {
  it("三个 pane 的输入产出六个可寻址文件与一份内联文档映射", async () => {
    // 刻意用非字母序的 id,证明输出顺序跟随输入而非重新排序。
    const ids = ["charlie", "alpha", "bravo"];
    const modules = ids.map((id) => {
      const entry = join(sourceRoot, "panes", id, "entry.ts");
      seedPaneEntry(entry, `ready-${id}`);
      return makeModule({ id, title: `Pane ${id}`, entry });
    });

    const result = await buildPaneArtifacts(modules, { sourceRoot, outDir });

    expect(result.files).toHaveLength(6);
    expect(result.artifacts).toHaveLength(3);
    expect(Object.keys(result.documents)).toEqual(ids);

    // 顺序稳定:跟随输入顺序,每个 pane 先脚本后文档。
    expect(result.files).toEqual([
      join(outDir, "pane-charlie.js"),
      join(outDir, "pane-charlie.html"),
      join(outDir, "pane-alpha.js"),
      join(outDir, "pane-alpha.html"),
      join(outDir, "pane-bravo.js"),
      join(outDir, "pane-bravo.html"),
    ]);

    for (const id of ids) {
      const scriptPath = join(outDir, `pane-${id}.js`);
      const documentPath = join(outDir, `pane-${id}.html`);
      expect(existsSync(scriptPath)).toBe(true);
      expect(existsSync(documentPath)).toBe(true);

      const script = readFileSync(scriptPath, "utf8");
      expect(runPaneScript(script)).toBe(`ready-${id}`);

      // URL 形态:引用同名脚本文件,不内联代码。
      const urlDoc = readFileSync(documentPath, "utf8");
      expect(urlDoc).toContain(`<script src="pane-${id}.js"></script>`);
      expect(urlDoc).not.toContain(`ready-${id}`);
      expect(urlDoc).toContain(`<title>Pane ${id}</title>`);

      // 内联形态(不落盘):脚本字节原样内联,标题一致。
      const inlineDoc = result.documents[id];
      expect(inlineDoc).toContain(script);
      expect(inlineDoc).toContain(`<title>Pane ${id}</title>`);
      expect(inlineDoc).not.toContain(`<script src=`);
    }
  });

  it("两次构建产物字节一致(顺序稳定可复现)", async () => {
    const entry = join(sourceRoot, "panes", "solo", "entry.ts");
    seedPaneEntry(entry, "solo-ready");
    const modules = [makeModule({ id: "solo", title: "Solo", entry })];

    const first = await buildPaneArtifacts(modules, { sourceRoot, outDir });
    const firstScript = readFileSync(first.artifacts[0]!.scriptPath, "utf8");
    const firstDoc = readFileSync(first.artifacts[0]!.documentPath, "utf8");

    const second = await buildPaneArtifacts(modules, { sourceRoot, outDir });
    const secondScript = readFileSync(second.artifacts[0]!.scriptPath, "utf8");
    const secondDoc = readFileSync(second.artifacts[0]!.documentPath, "utf8");

    expect(second.files).toEqual(first.files);
    expect(second.documents).toEqual(first.documents);
    expect(secondScript).toBe(firstScript);
    expect(secondDoc).toBe(firstDoc);
  });
});

describe("buildPaneArtifacts: 单例插件确实被注入(Req 4.3)", () => {
  /**
   * 造一份可被 esbuild 识别为 CJS 的最小 react/react-dom 安装(与 `react-singleton.test.ts`
   * 同策略),但判别手段不同:`bundlePaneEntry` 恒 `minify: true`(通用层 `pane-document.ts`
   * 的固定选项),minify 会把 esbuild 内部 `__commonJS(...)` 标记的**标识符**重命名掉——
   * `externals-guard.ts` 的 `findSingletonOccurrences`/`assertSingletonOccursOnce`
   * 正是靠正则匹配这个标记名字,对**已 minify** 的真实 pane 产物必然报「0 份」而非「1 份」
   * (已实测复现:同样的 esbuild 配置,minify 前 `__commonJS(` 原样出现,minify 后被重命名为
   * 单字母标识符)。故本测试改用**字符串字面量断言**——minifier 不改写字符串字面量内容,
   * 两份安装的 `flavor` 取不相交的可读标记,直接数产物文本里出现了哪一份的标记,
   * 结论对是否 minify 都成立。
   */
  function seedRuntimeCopy(installRoot: string, pkgName: string, flavor: string): void {
    const pkgDir = join(installRoot, "node_modules", pkgName);
    mkdirSync(pkgDir, { recursive: true });
    writeFileSync(join(pkgDir, "package.json"), JSON.stringify({ name: pkgName, version: "1.0.0", main: "index.js" }));
    writeFileSync(join(pkgDir, "index.js"), `module.exports = { flavor: ${JSON.stringify(flavor)} };\n`);
  }

  const AGENT_REACT_MARKER = "agent-react-singleton-marker";
  const AGENT_REACT_DOM_MARKER = "agent-reactdom-singleton-marker";
  const HOST_REACT_MARKER = "host-react-singleton-marker";
  const HOST_REACT_DOM_MARKER = "host-reactdom-singleton-marker";

  function seedDualCopyFixture(): { entry: string; hostRoot: string } {
    const hostRoot = join(root, "host");
    mkdirSync(hostRoot, { recursive: true });
    seedRuntimeCopy(sourceRoot, "react", AGENT_REACT_MARKER);
    seedRuntimeCopy(sourceRoot, "react-dom", AGENT_REACT_DOM_MARKER);
    seedRuntimeCopy(hostRoot, "react", HOST_REACT_MARKER);
    seedRuntimeCopy(hostRoot, "react-dom", HOST_REACT_DOM_MARKER);
    writeFileSync(
      join(hostRoot, "host-module.js"),
      [
        `import React from "react";`,
        `import ReactDOM from "react-dom";`,
        `export function hostRuntime(){ return { React, ReactDOM }; }`,
      ].join("\n"),
    );
    const entry = join(sourceRoot, "panes", "canvas", "entry.js");
    mkdirSync(dirname(entry), { recursive: true });
    writeFileSync(
      entry,
      [
        `import React from "react";`,
        `import ReactDOM from "react-dom";`,
        `import { hostRuntime } from "../../../host/host-module.js";`,
        `const root = document.getElementById("root");`,
        `if (root) root.textContent = String(!!React && !!ReactDOM && !!hostRuntime);`,
        `export {};`,
      ].join("\n"),
    );
    return { entry, hostRoot };
  }

  it("基线(不经插件直接 bundlePaneEntry):agent 与宿主两份标记都出现,证明夹具确实复现了分裂", async () => {
    const { entry } = seedDualCopyFixture();
    const script = await bundlePaneEntry(entry);

    expect(script).toContain(AGENT_REACT_MARKER);
    expect(script).toContain(HOST_REACT_MARKER);
    expect(script).toContain(AGENT_REACT_DOM_MARKER);
    expect(script).toContain(HOST_REACT_DOM_MARKER);
  });

  it("经 buildPaneArtifacts(自动注入单例插件):只有 agent(sourceRoot)一份标记,宿主标记不出现", async () => {
    const { entry } = seedDualCopyFixture();
    const modules = [makeModule({ id: "canvas", title: "Canvas", entry })];

    const result = await buildPaneArtifacts(modules, { sourceRoot, outDir });
    const script = readFileSync(result.artifacts[0]!.scriptPath, "utf8");

    expect(script).toContain(AGENT_REACT_MARKER);
    expect(script).toContain(AGENT_REACT_DOM_MARKER);
    expect(script).not.toContain(HOST_REACT_MARKER);
    expect(script).not.toContain(HOST_REACT_DOM_MARKER);
  });
});

describe("buildPaneArtifacts: canvasStyles 开关(Req 2.2)", () => {
  it("canvasStyles:true 的 pane 叠加注入的画布样式,其余 pane 只用通用基线样式", async () => {
    const canvasEntry = join(sourceRoot, "panes", "gallery", "entry.ts");
    const plainEntry = join(sourceRoot, "panes", "plain", "entry.ts");
    seedPaneEntry(canvasEntry, "gallery-ready");
    seedPaneEntry(plainEntry, "plain-ready");
    const modules = [
      makeModule({ id: "gallery", title: "Gallery", entry: canvasEntry, canvasStyles: true }),
      makeModule({ id: "plain", title: "Plain", entry: plainEntry }),
    ];
    const canvasCssMarker = "/* canvas-css-marker */";

    const result = await buildPaneArtifacts(modules, { sourceRoot, outDir, canvasCss: canvasCssMarker });

    const galleryDoc = readFileSync(result.artifacts[0]!.documentPath, "utf8");
    const plainDoc = readFileSync(result.artifacts[1]!.documentPath, "utf8");
    expect(galleryDoc).toContain(canvasCssMarker);
    expect(result.documents.gallery).toContain(canvasCssMarker);

    expect(plainDoc).not.toContain(canvasCssMarker);
    expect(plainDoc).toContain(PANE_BASE_CSS);
    expect(result.documents.plain).not.toContain(canvasCssMarker);
  });

  it("canvasStyles:true 但未提供 canvasCss:BuildError 终止,不静默退化为无样式产物", async () => {
    const entry = join(sourceRoot, "panes", "gallery", "entry.ts");
    seedPaneEntry(entry, "gallery-ready");
    const modules = [makeModule({ id: "gallery", title: "Gallery", entry, canvasStyles: true })];

    await expect(buildPaneArtifacts(modules, { sourceRoot, outDir })).rejects.toMatchObject({
      stage: "pane",
      code: "BUILD_PANE_MISSING_CANVAS_CSS",
    });
  });
});

describe("buildPaneArtifacts: 打包失败的错误包装(design.md「Error Handling」)", () => {
  it("入口打包失败(无法解析的导入)包装为 BuildError,携带 entry 路径", async () => {
    const entry = join(sourceRoot, "panes", "broken", "entry.ts");
    mkdirSync(dirname(entry), { recursive: true });
    writeFileSync(entry, `import x from "definitely-not-installed-anywhere";\nexport default x;\n`);
    const modules = [makeModule({ id: "broken", title: "Broken", entry })];

    try {
      await buildPaneArtifacts(modules, { sourceRoot, outDir });
      expect.unreachable("应抛出 BuildError");
    } catch (e) {
      expect(e).toBeInstanceOf(BuildError);
      expect((e as BuildError).stage).toBe("pane");
      expect((e as BuildError).code).toBe("BUILD_PANE_BUNDLE_FAILED");
      expect((e as BuildError).path).toBe(entry);
    }
  });
});
