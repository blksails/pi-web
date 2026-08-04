/**
 * 构建 webext 示例的 `.pi/web`(agent-web-extension 任务 6.x)。
 *
 * 在 web-kit 自身的 vitest 中用真实 `buildWebExtension` 把 4 个代码示例打成 ESM +
 * manifest,写入各示例 `.pi/web/dist/`(供 e2e/node 加载,见 webext-build-load.e2e)。
 * 断言:manifest 合法、integrity 与产物一致、externals 保留(未内联 React)。
 *
 * 下方 `pane 化示例迁移回归` 一节是 spec cli-agent-build 任务 5.1 的迁移回归基线
 * (design.md「Testing Strategy / Integration Tests」第 5 条):原本各自携带 `build.ts`
 * 的 6 个 pane 化示例已改经 `runBuild`(`pi-web build` 的编排入口)统一构建,断言与本文件
 * 既有的代码示例断言同构——manifest 合法性 / integrity 一致 / 运行时库未内联三条
 * (Req 6.2, 2.7)。
 */
import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildWebExtension } from "../build/build.js";
import { findBundledSingletons } from "../build/externals-guard.js";
import { computeIntegrity } from "../build/manifest-emit.js";
import { Buffer } from "node:buffer";

const repoRoot = resolve(fileURLToPath(new URL(".", import.meta.url)), "../../..");

/**
 * ★ `runBuild`/`createProgressReporter` 来自 `server/cli/build/**`——那是**上层**编排代码
 * (依赖本包,而非被本包依赖,`structure.md` 的依赖方向铁律)。`packages/web-kit/tsconfig.json`
 * 的 `rootDir: "."` 会拒绝任何静态相对 import 把该目录树以外的 `.ts` 文件拉进本包的编译
 * 单元(`tsc -p tsconfig.json --noEmit` 报 `TS6059`,经实测复现)。改成运行期动态 `import()`
 * 并按下方最小接口断言形状,避免把 `server/cli/index.ts` 的整棵依赖图拉进本包的类型检查
 * 范围,同时仍能在 vitest(运行期,不受 `rootDir` 约束)里跑真实的 `runBuild`。
 */
interface RunBuildModule {
  runBuild(
    argv: readonly string[],
    deps: { readonly cwd: string; readonly toolchainRootCandidates: readonly string[]; readonly stylePresetCandidates: readonly string[] },
    reporter: unknown,
  ): Promise<number>;
}
interface ReporterModule {
  createProgressReporter(options?: { readonly write?: (line: string) => void }): unknown;
}
// ★ 特意声明成宽化的 `string`(非字面量类型)——字面量说明符会被 `tsc` 静态解析并把目标
// 文件连同其整棵依赖图拉进本包的编译单元(即便只是 `import()` 表达式,`rootDir` 检查依然
// 触发,实测复现)。宽化后 `tsc` 无法静态解析说明符,只在**运行期**(vitest,不受 `rootDir`
// 约束)真正加载它。
const runBuildSpecifier: string = "../../../server/cli/build/index.js";
const reporterSpecifier: string = "../../../server/cli/reporter.js";
async function loadRunBuild(): Promise<RunBuildModule["runBuild"]> {
  const mod = (await import(runBuildSpecifier)) as unknown as RunBuildModule;
  return mod.runBuild;
}
async function loadCreateProgressReporter(): Promise<ReporterModule["createProgressReporter"]> {
  const mod = (await import(reporterSpecifier)) as unknown as ReporterModule;
  return mod.createProgressReporter;
}

/**
 * ★ 本列表只含**源码直接放在 `.pi/web` 下**的示例。
 *
 * 迁到 pane 形态的 source(state-bridge / surface-demo / aigc-canvas 系)源码在 `web/`、
 * 各有自己的 `build.ts`(要先把 pane 文档打成内联 srcDoc),故不走这条通用构建路径 ——
 * 它们由 `scripts/build-webext-examples.ts` 统一构建并在那里验证。
 */
const EXAMPLES = [
  { id: "webext-layout", name: "webext-layout-agent" },
  { id: "webext-renderer", name: "webext-renderer-agent" },
  { id: "webext-contrib", name: "webext-contrib-agent" },
  { id: "webext-artifact", name: "webext-artifact-agent" },
  { id: "webext-background", name: "webext-background-agent" },
  { id: "webext-slots", name: "webext-slots-agent" },
];

describe("webext 示例构建", () => {
  for (const ex of EXAMPLES) {
    it(`builds ${ex.id} → dist(externals 保留, integrity 一致)`, async () => {
      const dir = resolve(repoRoot, "examples", ex.name, ".pi/web");
      const result = await buildWebExtension({
        id: ex.id,
        targetApiVersion: "^0.1.0",
        entryDir: dir,
        outDir: resolve(dir, "dist"),
      });
      expect(result.manifest.id).toBe(ex.id);
      const code = await readFile(result.entryOut, "utf8");
      expect(findBundledSingletons(code)).toHaveLength(0);
      expect(code).toContain("@blksails/pi-web-kit");
      expect(result.manifest.integrity).toBe(
        computeIntegrity(Buffer.from(code, "utf8")),
      );
    });
  }

});

/**
 * pane 化示例迁移回归(spec cli-agent-build 任务 5.1)。
 *
 * 各示例的 pane 声明经 `--panes` 显式路径传入(见各自 `panes-modules.ts` /
 * `panes-declaration.ts` 头注);统一分派入口(`manifest.entry` 指向的
 * `web-extension.mjs`)取代了旧 `buildWebExtension` 直出的同源产物文件名——真正的
 * 「同源 ESM、未内联 React」断言改核对被改名保留的 `web-extension.same-origin.mjs`
 * (design.md「统一分派入口的产出」)。
 */
/**
 * `extId` 是迁移前各 build.ts 里硬编码的 webext id。★ 这条断言不可省：迁移到 runBuild
 * 后 id 缺省会从**注册表包 id**派生（带命名空间斜杠），而 id 是 CSS scoping 的命名空间
 * 根（`pw-<id>-`）。第一次迁移时这条断言被整条删掉，六个示例的 id 因此全部悄悄改变，
 * 其中 aigc-canvas 拿到了含斜杠的非法 CSS 标识符 —— 只因该示例恰好无 CSS 才没炸。
 */
const PANE_EXAMPLES: readonly {
  readonly dirName: string;
  readonly panesPath: string;
  readonly extId: string;
}[] = [
  { dirName: "panes-agent", panesPath: "panes-declaration.ts", extId: "panes" },
  { dirName: "aigc-canvas-agent", panesPath: "panes-declaration.ts", extId: "aigc-canvas" },
  { dirName: "surface-demo-agent", panesPath: "panes-modules.ts", extId: "surface-demo" },
  { dirName: "state-bridge-agent", panesPath: "panes-modules.ts", extId: "state-bridge" },
  { dirName: "aigc-canvas-nosurface-agent", panesPath: "panes-modules.ts", extId: "aigc-canvas-nosurface" },
  { dirName: "canvas-plugin-stickers", panesPath: "panes-modules.ts", extId: "canvas-plugin-stickers" },
];

/** 真实工具链候选(本仓库根本身满足全部四项,spec cli-agent-build 任务 1.3 已提为运行依赖)。 */
const toolchainRootCandidates = [join(repoRoot, "node_modules")];
/** 真实样式预设候选(本仓库 `packages/ui/tailwind-preset.ts`,任务 1.4 已开出口)。 */
const stylePresetCandidates = [join(repoRoot, "packages", "ui", "tailwind-preset.ts")];

describe("pane 化示例构建(经 runBuild 统一编排)", () => {
  for (const example of PANE_EXAMPLES) {
    it(`builds ${example.dirName} → dist(manifest 合法、integrity 一致、externals 保留)`, async () => {
      const sourceDir = resolve(repoRoot, "examples", example.dirName);
      const createProgressReporter = await loadCreateProgressReporter();
      const runBuild = await loadRunBuild();
      const reporter = createProgressReporter({ write: () => {} });
      const exitCode = await runBuild(
        ["--panes", example.panesPath, "--id", example.extId],
        { cwd: sourceDir, toolchainRootCandidates, stylePresetCandidates },
        reporter,
      );
      expect(exitCode).toBe(0);

      const outDir = join(sourceDir, ".pi", "web", "dist");
      const manifest = JSON.parse(await readFile(join(outDir, "manifest.json"), "utf8")) as {
        readonly id: string;
        readonly entry: string;
        readonly integrity: string;
        readonly entries?: readonly { readonly path: string; readonly integrity: string; readonly realm: string }[];
      };

      // id 必须与迁移前一致（回归守卫，见 PANE_EXAMPLES 注释）。
      expect(manifest.id).toBe(example.extId);

      const dispatcherCode = await readFile(join(outDir, manifest.entry), "utf8");
      expect(manifest.integrity).toBe(computeIntegrity(Buffer.from(dispatcherCode, "utf8")));

      // ★ 逐入口完整性：只有 `entry`+`integrity` 时，SRI 覆盖的仅是分派器那两行对所有
      // 扩展都一样的字节，等于退化成常量。这里要求每个 realm 的 integrity 各自与其
      // **真实字节**一致，且两者互不相同。
      expect(manifest.entries).toBeDefined();
      const entries = manifest.entries ?? [];
      expect(entries.map((e) => e.realm).sort()).toEqual(["isolated", "same-origin"]);
      for (const entry of entries) {
        const bytes = await readFile(join(outDir, entry.path), "utf8");
        expect(entry.integrity).toBe(computeIntegrity(Buffer.from(bytes, "utf8")));
      }
      expect(entries[0]?.integrity).not.toBe(entries[1]?.integrity);

      const sameOriginCode = await readFile(join(outDir, "web-extension.same-origin.mjs"), "utf8");
      expect(findBundledSingletons(sameOriginCode)).toHaveLength(0);
      expect(sameOriginCode).toContain("@blksails/pi-web-kit");
    });
  }
});
