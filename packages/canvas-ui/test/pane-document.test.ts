// @vitest-environment node
/**
 * canvas pane 样式层重构的判别式测试(spec cli-agent-build 任务 2.3,Req 4.5)。
 *
 * 三条各自独立可证伪:
 *  1. `resolveCanvasCss()` 只消费调用方注入的 `presetPath`,不按仓库物理路径猜测/回落
 *     ——用一份与真实 `packages/ui/tailwind-preset.ts` 完全无关的假预设证明。
 *  2. 样式内容扫描以显式 `packageRoot` 为界,不因入口(此测试甚至不传入口)而扩散到
 *     包根之外的目录——用「包根内命中、包根外不命中」的两个 marker 类互证。
 *  3. `buildCanvasPaneDocument()` 直接消费调用方预先算好的 `css`,不重新跑样式管线
 *     ——用可被字面识别的 marker 字符串证明「一次解析、多 pane 复用」。
 *
 * 实际跑真实 esbuild + postcss + tailwindcss(与仓内既有 build 测试同策略,不打桩)。
 */
import { describe, expect, it } from "vitest";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildCanvasPaneDocument,
  canvasContentGlobs,
  resolveCanvasCss,
} from "../build/pane-document.js";

const TEST_DIR = dirname(fileURLToPath(import.meta.url));
const FIXTURES = resolve(TEST_DIR, "fixtures", "pane-document");
const FIXTURE_PRESET_PATH = resolve(FIXTURES, "preset.fixture.ts");
const PKG_A_ROOT = resolve(FIXTURES, "pkg-a");
const ENTRY = resolve(FIXTURES, "entry.tsx");

describe("canvasContentGlobs(纯函数)", () => {
  it("以 packageRoot 为扫描基准,而非任何入口路径", () => {
    const globs = canvasContentGlobs(PKG_A_ROOT);
    // 只扫 `src/`(与 `panes/`)而非包根:包根下有 node_modules,`**/*.ts` 会把整棵依赖树
    // 拖进 tailwind 内容扫描(tailwind 自身会警告 accidentally matching all of node_modules)。
    expect(globs[0]).toBe(resolve(PKG_A_ROOT, "src", "**", "*.{ts,tsx}"));
    // 不应出现任何来自 entry/dirname(entry) 的痕迹——本函数根本不接收 entry 参数。
    expect(globs.some((g) => g.includes("dep-outside"))).toBe(false);
  });

  it("透传 extraContent(自带插件的 source 需要它)", () => {
    const extra = resolve(FIXTURES, "dep-outside", "**", "*.tsx");
    const globs = canvasContentGlobs(PKG_A_ROOT, [extra]);
    expect(globs.at(-1)).toBe(extra);
  });
});

describe("resolveCanvasCss()", () => {
  it("消费注入的 presetPath,不按仓库物理路径猜测预设", async () => {
    const css = await resolveCanvasCss({
      presetPath: FIXTURE_PRESET_PATH,
      packageRoot: PKG_A_ROOT,
    });
    // fixture 预设的独有色值(#123456 → tailwind 转成 rgb 分量 18 52 86)只会在
    // 「真的加载了这份注入路径」时才会出现在产出里。
    expect(css).toContain(".bg-fixture-marker");
    expect(css).toContain("18 52 86");
  });

  it("扫描范围锚定 packageRoot,入口位于依赖目录深处也不扩散到依赖树", async () => {
    const css = await resolveCanvasCss({
      presetPath: FIXTURE_PRESET_PATH,
      packageRoot: PKG_A_ROOT,
    });
    // packageRoot(pkg-a)内的组件命中。
    expect(css).toContain("701701px");
    // packageRoot 之外(模拟依赖目录)的组件不命中——即便它与 pkg-a 同级、路径并不遥远。
    expect(css).not.toContain("900900px");
  });

  it("同一次调用可被多个 pane 复用,产出逐字节相同", async () => {
    const [cssA, cssB] = await Promise.all([
      resolveCanvasCss({ presetPath: FIXTURE_PRESET_PATH, packageRoot: PKG_A_ROOT }),
      resolveCanvasCss({ presetPath: FIXTURE_PRESET_PATH, packageRoot: PKG_A_ROOT }),
    ]);
    expect(cssA).toBe(cssB);
  });
});

describe("buildCanvasPaneDocument()", () => {
  it("直接消费传入的 css,不重新跑样式管线", async () => {
    const marker = `/*pane-css-reuse-marker-${Math.random().toString(36).slice(2)}*/`;
    const [doc1, doc2] = await Promise.all([
      buildCanvasPaneDocument({ entry: ENTRY, title: "pane-1", css: marker }),
      buildCanvasPaneDocument({ entry: ENTRY, title: "pane-2", css: marker }),
    ]);
    // 若函数内部重新计算样式(而非直接拼装传入值),字面 marker 不会原样出现在产出里。
    expect(doc1).toContain(marker);
    expect(doc2).toContain(marker);
    expect(doc1).toContain("pane-1");
    expect(doc2).toContain("pane-2");
  });

  it("多个 pane 复用同一次 resolveCanvasCss() 结果时拿到相同样式内容", async () => {
    const css = await resolveCanvasCss({
      presetPath: FIXTURE_PRESET_PATH,
      packageRoot: PKG_A_ROOT,
    });
    const [doc1, doc2] = await Promise.all([
      buildCanvasPaneDocument({ entry: ENTRY, title: "pane-1", css }),
      buildCanvasPaneDocument({ entry: ENTRY, title: "pane-2", css }),
    ]);
    const styleOf = (doc: string): string => doc.match(/<style>([\s\S]*?)<\/style>/)?.[1] ?? "";
    expect(styleOf(doc1)).toBe(styleOf(doc2));
    expect(styleOf(doc1)).toContain("701701px");
  });
});
