/**
 * 构建 webext 示例的 `.pi/web`(agent-web-extension 任务 6.x)。
 *
 * 纯代码 webext 示例(无 pane)直接用 `buildWebExtension` 打成 ESM + manifest,产物写入
 * 各示例 `.pi/web/dist/`(仓库内,bare specifier 由仓库 node_modules 解析)。
 *
 * pane 化示例(spec cli-agent-build 任务 5.1)统一经 `runBuild`(`pi-web build` 的编排入口)
 * 构建——不再静态引用各示例的构建入口函数(Req 6.1, 6.3),各自的 pane 声明经 `--panes`
 * 显式路径参数传入(见各示例 `panes-modules.ts` / `panes-declaration.ts` 头注)。
 * 声明式示例(webext-declarative)无需构建(manifest.json 内联 config)。
 *
 * 运行:`node --import jiti/register scripts/build-webext-examples.ts`
 */
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildWebExtension } from "@blksails/pi-web-kit/build";
import { runBuild } from "../server/cli/build/index.js";
import { createProgressReporter } from "../server/cli/reporter.js";
import { buildAigcAgent as buildAgicVideoAgent } from "../examples/agic-video-agent/build.js";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const EXAMPLES = [
  "webext-layout",
  "webext-renderer",
  "webext-contrib",
  "webext-artifact",
  "webext-background",
  "plugin-code-review",
] as const;

const idOf: Record<string, string> = {
  "webext-layout": "webext-layout",
  "webext-renderer": "webext-renderer",
  "webext-contrib": "webext-contrib",
  "webext-artifact": "webext-artifact",
  "webext-background": "webext-background",
  "plugin-code-review": "code-review",
};

/**
 * pane 化示例(spec cli-agent-build 任务 5.1):统一经 `runBuild` 编排,不再各自携带
 * 构建脚本。`panesPath` 是各示例 pane 声明模块相对其 source 根的路径,经 `--panes`
 * 显式传入——四个新声明(`panes-modules.ts`)与两个复用既有元信息的声明
 * (`panes-declaration.ts`,命名避开已被 agent 侧 `PaneAgentModule[]` 占用的
 * `panes-modules.ts`)均不落在约定发现路径(`<source>/panes/modules.ts`)上,
 * 因此都需要显式指定,不依赖自动发现。
 */
interface PaneExample {
  readonly dirName: string;
  readonly panesPath: string;
  /**
   * webext id。★ 必须显式钉住：`runBuild` 缺省会从 `pi-web.json` 的**注册表包 id**
   * 派生，而那是带命名空间的（`e2e/aigc-canvas-agent`），与迁移前各 build.ts 里硬编码
   * 的 webext id 不是一回事。id 是 CSS scoping 的命名空间根，变了即破坏既有样式作用域，
   * 也使 R6.2「产出与迁移前等价」不成立。这里的值逐个取自迁移前的 build.ts。
   */
  readonly extId: string;
}

const PANE_EXAMPLES: readonly PaneExample[] = [
  { dirName: "panes-agent", panesPath: "panes-declaration.ts", extId: "panes" },
  { dirName: "aigc-canvas-agent", panesPath: "panes-declaration.ts", extId: "aigc-canvas" },
  { dirName: "surface-demo-agent", panesPath: "panes-modules.ts", extId: "surface-demo" },
  { dirName: "state-bridge-agent", panesPath: "panes-modules.ts", extId: "state-bridge" },
  { dirName: "aigc-canvas-nosurface-agent", panesPath: "panes-modules.ts", extId: "aigc-canvas-nosurface" },
  { dirName: "canvas-plugin-stickers", panesPath: "panes-modules.ts", extId: "canvas-plugin-stickers" },
];

/** 真实工具链候选(本仓库根本身满足全部四项,spec cli-agent-build 任务 1.3 已提为运行依赖)。 */
const TOOLCHAIN_ROOT_CANDIDATES = [join(REPO_ROOT, "node_modules")];
/** 真实样式预设候选(本仓库 `packages/ui/tailwind-preset.ts`,任务 1.4 已开出口)。 */
const STYLE_PRESET_CANDIDATES = [join(REPO_ROOT, "packages", "ui", "tailwind-preset.ts")];

async function buildPaneExample(example: PaneExample): Promise<void> {
  const sourceDir = resolve(REPO_ROOT, "examples", example.dirName);
  const reporter = createProgressReporter();
  const exitCode = await runBuild(
    ["--panes", example.panesPath, "--id", example.extId],
    {
      cwd: sourceDir,
      toolchainRootCandidates: TOOLCHAIN_ROOT_CANDIDATES,
      stylePresetCandidates: STYLE_PRESET_CANDIDATES,
    },
    reporter,
  );
  if (exitCode !== 0) {
    throw new Error(`构建 ${example.dirName} 失败(runBuild 退出码 ${exitCode})`);
  }
}

async function main(): Promise<void> {
  for (const name of EXAMPLES) {
    const dir = resolve(`examples/${name}-agent/.pi/web`);
    const result = await buildWebExtension({
      id: idOf[name] as string,
      targetApiVersion: "^0.1.0",
      entryDir: dir,
      outDir: resolve(dir, "dist"),
    });
    // eslint-disable-next-line no-console
    console.log(`[built] ${name} → ${result.entryOut} (${result.manifest.integrity})`);
  }
  for (const example of PANE_EXAMPLES) {
    await buildPaneExample(example);
    // eslint-disable-next-line no-console
    console.log(`[built] ${example.dirName} → 经 runBuild 编排`);
  }
  const agicVideo = await buildAgicVideoAgent();
  console.log(`[built] agic-video-agent → ${agicVideo.entryOut} (专用 pane/隔离产物构建)`);
}

void main().catch((err: unknown) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exitCode = 1;
});
