// @vitest-environment node
/**
 * panes-agent 的构建回归测试(spec cli-agent-build 任务 5.1 迁移)。
 *
 * 迁移前:直接调用示例自带的 `buildPanesAgent()`(`examples/panes-agent/build.ts`,已删除),
 * 该函数把每个 pane 编译出的脚本以字符串字面量内联进 `pane-documents.generated.ts`,再让
 * webext 主入口静态 import 它——bundle 内容断言(`create-artifact` 等)因此能在 `entryOut`
 * (webext 主入口)里直接命中。
 *
 * 迁移后:统一经 `runBuild`(`pi-web build` 的编排入口)构建。pane 现产出为独立可寻址的
 * `pane-<id>.js` / `pane-<id>.html`(Req 2.2),不再内联进 webext 主入口——原先针对
 * `entryOut` 的内容断言相应改为分别核对各自的 `pane-<id>.js`。
 */
import { describe, expect, it } from "vitest";
import { readFile, readdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Buffer } from "node:buffer";
import { computeIntegrity } from "../packages/web-kit/build/manifest-emit.js";
import { findBundledSingletons } from "../packages/web-kit/build/externals-guard.js";
import { runBuild } from "../server/cli/build/index.js";
import { createProgressReporter } from "../server/cli/reporter.js";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SOURCE_DIR = join(REPO_ROOT, "examples", "panes-agent");
/** 真实工具链候选(本仓库根本身满足全部四项,spec cli-agent-build 任务 1.3 已提为运行依赖)。 */
const TOOLCHAIN_ROOT_CANDIDATES = [join(REPO_ROOT, "node_modules")];
/** 真实样式预设候选(本仓库 `packages/ui/tailwind-preset.ts`,任务 1.4 已开出口)。 */
const STYLE_PRESET_CANDIDATES = [join(REPO_ROOT, "packages", "ui", "tailwind-preset.ts")];

describe("panes-agent web build（经 runBuild 统一编排）", () => {
  it("bundles five isolated React panes and keeps .pi runtime-only", async () => {
    const reporter = createProgressReporter({ write: () => {} });
    const exitCode = await runBuild(
      ["--panes", "panes-declaration.ts"],
      {
        cwd: SOURCE_DIR,
        toolchainRootCandidates: TOOLCHAIN_ROOT_CANDIDATES,
        stylePresetCandidates: STYLE_PRESET_CANDIDATES,
      },
      reporter,
    );
    expect(exitCode).toBe(0);

    const outDir = join(SOURCE_DIR, ".pi", "web", "dist");
    const manifest = JSON.parse(await readFile(join(outDir, "manifest.json"), "utf8")) as {
      readonly entry: string;
      readonly integrity: string;
      readonly targetApiVersion: string;
    };
    expect(manifest.targetApiVersion).toBe("^0.5.0");

    // 同源 ESM 产物(`buildWebExtension` 直出、经 isolated 阶段改名而来)不得内联单例。
    const sameOriginCode = await readFile(join(outDir, "web-extension.same-origin.mjs"), "utf8");
    expect(findBundledSingletons(sameOriginCode)).toHaveLength(0);

    // manifest.entry 指向统一分派入口,其完整性校验值须与最终字节逐字节一致(Req 2.5)。
    const dispatcherCode = await readFile(join(outDir, manifest.entry), "utf8");
    expect(manifest.integrity).toBe(computeIntegrity(Buffer.from(dispatcherCode, "utf8")));

    // 五个 pane 各自打成独立可寻址的脚本(Req 2.2)——内容断言分别核对各自文件,不再像旧
    // build.ts 那样把编译产物内联进 webext 主入口的字符串字面量里统一断言。
    const artifactCode = await readFile(join(outDir, "pane-artifact.js"), "utf8");
    expect(artifactCode).toContain("create-artifact");
    const canvasCode = await readFile(join(outDir, "pane-canvas.js"), "utf8");
    expect(canvasCode).toContain("canvas-checkerboard");
    expect(canvasCode).toContain("HOST_UNAVAILABLE");
    for (const id of ["files", "editor", "diff", "canvas", "artifact"]) {
      const code = await readFile(join(outDir, `pane-${id}.js`), "utf8");
      expect(code).toContain("pane:connected");
    }

    // 5 个 pane ×(脚本+文档)+ panes.json + 双入口(same-origin/isolated/dispatcher)+
    // manifest.json —— 产物集合完整(Req 2.1-2.4)。
    const distEntries = await readdir(outDir);
    expect(distEntries).toHaveLength(15);

    // `.pi/web/` 根下不残留任何构建中间产物——取代旧 `pane-documents.generated.ts`
    // (构建完即删)的既有纪律,新管线里连生成的必要都没有(不落盘在 outDir 之外)。
    const piWebEntries = await readdir(join(SOURCE_DIR, ".pi", "web"));
    expect(piWebEntries).toEqual(["dist"]);
  }, 20_000);
});
