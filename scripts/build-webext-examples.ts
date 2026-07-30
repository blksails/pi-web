/**
 * 构建 webext 示例的 `.pi/web`(agent-web-extension 任务 6.x)。
 *
 * 用真实 `pi-web build`(@blksails/pi-web-kit/build)把 4 个代码示例打成 ESM + manifest,
 * 产物写入各示例 `.pi/web/dist/`(仓库内,bare specifier 由仓库 node_modules 解析)。
 * 声明式示例(webext-declarative)无需构建(manifest.json 内联 config)。
 *
 * 运行:`node --import jiti/register scripts/build-webext-examples.ts`
 */
import { resolve } from "node:path";
import { buildWebExtension } from "@blksails/pi-web-kit/build";
import { buildPanesAgent } from "../examples/panes-agent/build.js";
import { buildAigcCanvasAgent } from "../examples/aigc-canvas-agent/build.js";
import { buildSurfaceDemoAgent } from "../examples/surface-demo-agent/build.js";
import { buildStateBridgeAgent } from "../examples/state-bridge-agent/build.js";

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
  // 自带 pane 文档构建的示例(esbuild 打 iframe srcDoc + 内联 CSS),各自有 build.ts。
  const panes = await buildPanesAgent();
  console.log(`[built] panes → ${panes.entryOut} (${panes.manifest.integrity})`);
  const aigcCanvas = await buildAigcCanvasAgent();
  console.log(`[built] aigc-canvas → ${aigcCanvas.entryOut} (${aigcCanvas.manifest.integrity})`);
  // surface-demo 迁 pane 后同样需要构建期打 srcDoc(spec panes-only-right-panel 任务 2.2)。
  const surfaceDemo = await buildSurfaceDemoAgent();
  console.log(`[built] surface-demo → ${surfaceDemo.entryOut} (${surfaceDemo.manifest.integrity})`);
  // state-bridge 是新增共享状态通道的唯一真实消费者(spec panes-only-right-panel 任务 3.1)。
  const stateBridge = await buildStateBridgeAgent();
  console.log(`[built] state-bridge → ${stateBridge.entryOut} (${stateBridge.manifest.integrity})`);
}

void main().catch((err: unknown) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exitCode = 1;
});
