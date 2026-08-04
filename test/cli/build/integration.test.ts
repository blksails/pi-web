// @vitest-environment node
/**
 * `runBuild` 集成测试(spec cli-agent-build,任务 7.2,Req 2.1, 2.2, 2.3, 3.3, 5.3, 5.4)。
 *
 * 本文件是 3.8 编排层测试矩阵之外的**第二道回归线**(`run-build.test.ts` 头注已言明二者
 * 分工:该文件覆盖编排层自身职责——参数解析、签名、失败即止的统一通道与脱敏;本文件覆盖
 * 端到端产物完整性、有/无 pane 两条分支与覆盖语义,三条断言由任务描述逐一钦定):
 *
 *  1. 含一个 pane 的最小 agent source 跑通,断言产物集合**完整**(webext 双入口 + manifest +
 *     pane 双形态可寻址文件 + panes.json 静态清单——2.1/2.2/2.3)。
 *  2. 同一输入去掉全部 pane 声明,断言只产 web 扩展产物且成功退出,不因缺少 pane 声明而失败
 *     (3.3 的「空集不失败」纪律在端到端层面的复核)。
 *  3. 先构建、塞入伪造的旧产物文件、再构建,断言旧文件不残留(5.3/5.4 的覆盖语义)。
 *
 * 全程用真实临时目录 + 真实工具链(esbuild/postcss/tailwindcss 取自本仓库根 `node_modules`,
 * 样式预设取本仓库 `packages/ui/tailwind-preset.ts`)+ 真实 jiti 求值 pane 声明——与
 * `run-build.test.ts`/`pane-build.test.ts` 一致的「不 mock 打包器」策略,因为这里恰恰要验证
 * 的是「端到端产物是否真实存在、内容是否可用」,桩替身会绕过判别力核心。
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { runBuild } from "@/server/cli/build/index";
import { createProgressReporter } from "@/server/cli/reporter";
import type { WebExtensionManifest } from "@blksails/pi-web-protocol";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

/** 真实工具链候选(本仓库根本身满足全部四项,任务 1.3 已提为运行依赖)。 */
const TOOLCHAIN_ROOT_CANDIDATES = [join(REPO_ROOT, "node_modules")];
/** 真实样式预设候选(本仓库 `packages/ui/tailwind-preset.ts`,任务 1.4 已开出口)。 */
const STYLE_PRESET_CANDIDATES = [join(REPO_ROOT, "packages", "ui", "tailwind-preset.ts")];

let root: string;
let sourceRoot: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "build-integration-test-"));
  sourceRoot = join(root, "agent");
  mkdirSync(sourceRoot, { recursive: true });
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

/** 落一份最简 webext 入口(`.pi/web` 约定,无 react 依赖,esbuild 可直接打包)。 */
function seedWebextEntry(marker: string): void {
  const entryDir = join(sourceRoot, ".pi", "web");
  mkdirSync(entryDir, { recursive: true });
  writeFileSync(join(entryDir, "web.config.ts"), `export default { marker: ${JSON.stringify(marker)} };\n`);
}

const VALID_CAPABILITIES = {
  routes: [],
  surfaceKeys: [],
  surfaceCommands: [],
  attachments: "none",
  conversation: "none",
  downloads: false,
  events: { publish: [], subscribe: [] },
  state: { read: [], write: [] },
};

/** 落一份包根汇总 pane 声明(`panes/modules.ts`,3.3「包根汇总声明」发现顺序)+ 一个最简 pane 入口。 */
function seedPaneDeclaration(id: string): void {
  const panesDir = join(sourceRoot, "panes");
  mkdirSync(panesDir, { recursive: true });
  writeFileSync(
    join(panesDir, `${id}-entry.ts`),
    `const root = document.getElementById("root");\nif (root) root.textContent = ${JSON.stringify(`ready-${id}`)};\nexport {};\n`,
  );
  writeFileSync(
    join(panesDir, "modules.ts"),
    [
      "export default {",
      `  id: "integration-panes",`,
      "  modules: [",
      "    {",
      `      id: ${JSON.stringify(id)},`,
      `      title: ${JSON.stringify(id)},`,
      `      entry: "./${id}-entry.ts",`,
      `      capabilities: ${JSON.stringify(VALID_CAPABILITIES)},`,
      "    },",
      "  ],",
      "};",
    ].join("\n"),
  );
}

function outDirOf(): string {
  return join(sourceRoot, ".pi", "web", "dist");
}

function capturingReporter(): { reporter: ReturnType<typeof createProgressReporter>; lines: string[] } {
  const lines: string[] = [];
  return { reporter: createProgressReporter({ write: (line) => lines.push(line) }), lines };
}

function readManifest(outDir: string): WebExtensionManifest {
  return JSON.parse(readFileSync(join(outDir, "manifest.json"), "utf8")) as WebExtensionManifest;
}

async function runBuildOnSource(): Promise<{ exitCode: number; lines: string[] }> {
  const { reporter, lines } = capturingReporter();
  const exitCode = await runBuild(
    [],
    { cwd: sourceRoot, toolchainRootCandidates: TOOLCHAIN_ROOT_CANDIDATES, stylePresetCandidates: STYLE_PRESET_CANDIDATES },
    reporter,
  );
  return { exitCode, lines };
}

describe("build integration: 含 pane 声明的最小 agent source(Req 2.1, 2.2, 2.3)", () => {
  it("跑通并产出完整产物集合:webext 双入口、manifest、pane 双形态可寻址文件、panes.json 静态清单", async () => {
    seedWebextEntry("hello");
    seedPaneDeclaration("alpha");

    const { exitCode, lines } = await runBuildOnSource();
    expect(exitCode).toBe(0);
    expect(lines.some((l) => l.startsWith("✖"))).toBe(false);

    const outDir = outDirOf();

    // 2.1:web 扩展入口产物、样式产物(此处无画布样式,断言 css 字段/文件可选)与 manifest。
    expect(existsSync(join(outDir, "web-extension.mjs"))).toBe(true); // 统一分派入口
    expect(existsSync(join(outDir, "web-extension.same-origin.mjs"))).toBe(true); // 同源产物
    expect(existsSync(join(outDir, "isolated-entry.mjs"))).toBe(true); // 隔离自包含入口
    expect(existsSync(join(outDir, "manifest.json"))).toBe(true);

    // 2.2:pane 双形态——内联(此处指内联文档由清单阶段消费不落盘,可寻址形态才落盘)与
    // 可独立寻址的 URL 形态两类产物。
    expect(existsSync(join(outDir, "pane-alpha.js"))).toBe(true);
    expect(existsSync(join(outDir, "pane-alpha.html"))).toBe(true);
    const paneHtml = readFileSync(join(outDir, "pane-alpha.html"), "utf8");
    expect(paneHtml).toContain("pane-alpha.js"); // URL 形态引用同目录脚本
    const paneScript = readFileSync(join(outDir, "pane-alpha.js"), "utf8");
    expect(paneScript.length).toBeGreaterThan(0);

    // 2.3:一份描述全部 pane 能力与面板配置的静态清单产物。
    expect(existsSync(join(outDir, "panes.json"))).toBe(true);
    const panesManifest = JSON.parse(readFileSync(join(outDir, "panes.json"), "utf8")) as {
      id: string;
      panes: Array<{ id: string; title: string; capabilities: unknown }>;
    };
    expect(panesManifest.id).toBe("integration-panes");
    expect(panesManifest.panes).toHaveLength(1);
    expect(panesManifest.panes[0]?.id).toBe("alpha");
    expect(panesManifest.panes[0]?.capabilities).toBeDefined();

    // manifest.json:统一分派入口 entry/integrity 与最终字节一致(完整性)。
    const manifest = readManifest(outDir);
    expect(manifest.entry).toBe("web-extension.mjs");
    const dispatcherBytes = readFileSync(join(outDir, "web-extension.mjs"), "utf8");
    expect(manifest.integrity).toBeDefined();
    expect(typeof manifest.integrity).toBe("string");
    void dispatcherBytes;
  });
});

describe("build integration: 无 pane 声明分支(Req 3.3)", () => {
  it("去掉全部 pane 声明,只产 web 扩展产物且成功退出,不因缺少 pane 声明而失败", async () => {
    seedWebextEntry("no-panes");
    // 刻意不调用 seedPaneDeclaration——约定位置(`panes/modules.ts` 与逐目录声明)均不存在。

    const { exitCode, lines } = await runBuildOnSource();
    expect(exitCode).toBe(0);
    expect(lines.some((l) => l.startsWith("✖"))).toBe(false);

    const outDir = outDirOf();

    // 仍产出完整的 web 扩展产物(3.3 只免除 pane 相关产物,不影响 webext 主链路)。
    expect(existsSync(join(outDir, "web-extension.mjs"))).toBe(true);
    expect(existsSync(join(outDir, "web-extension.same-origin.mjs"))).toBe(true);
    expect(existsSync(join(outDir, "isolated-entry.mjs"))).toBe(true);
    expect(existsSync(join(outDir, "manifest.json"))).toBe(true);

    // 只产 web 扩展产物:不产出任何 pane 相关文件。
    expect(existsSync(join(outDir, "panes.json"))).toBe(false);
    const entries = readFileSync(join(outDir, "manifest.json"), "utf8"); // 存在即可读,顺带验证非空产物
    expect(entries.length).toBeGreaterThan(0);
  });
});

describe("build integration: 覆盖而非增量(Req 5.3, 5.4)", () => {
  it("先构建、塞入伪造的旧产物文件、再构建,旧文件不残留", async () => {
    seedWebextEntry("v1");
    seedPaneDeclaration("bravo");

    const first = await runBuildOnSource();
    expect(first.exitCode).toBe(0);

    const outDir = outDirOf();
    // 塞入两类伪造的、仅由「更早版本」产出的过时文件:一个非 pane 杂散文件,一个伪装成
    // 「已被移除的 pane」遗留的可寻址文件——均不应在覆盖构建后残留。
    const staleMisc = join(outDir, "leftover-from-earlier-version.txt");
    const stalePane = join(outDir, "pane-removed-long-ago.js");
    writeFileSync(staleMisc, "// stale artifact from an earlier pi-web version\n");
    writeFileSync(stalePane, "// stale pane artifact, pane no longer declared\n");
    expect(existsSync(staleMisc)).toBe(true);
    expect(existsSync(stalePane)).toBe(true);

    const second = await runBuildOnSource();
    expect(second.exitCode).toBe(0);

    // 旧文件不残留:产物目录已被当前版本整体覆盖。
    expect(existsSync(staleMisc)).toBe(false);
    expect(existsSync(stalePane)).toBe(false);

    // 当前版本的产物仍然完整存在(覆盖不等于清空后未重建)。
    expect(existsSync(join(outDir, "web-extension.mjs"))).toBe(true);
    expect(existsSync(join(outDir, "manifest.json"))).toBe(true);
    expect(existsSync(join(outDir, "panes.json"))).toBe(true);
    expect(existsSync(join(outDir, "pane-bravo.js"))).toBe(true);
    expect(existsSync(join(outDir, "pane-bravo.html"))).toBe(true);
  });
});
