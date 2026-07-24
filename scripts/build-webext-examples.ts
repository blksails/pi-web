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
  const panes = await buildPanesAgent();
  console.log(`[built] panes → ${panes.entryOut} (${panes.manifest.integrity})`);
}

void main().catch((err: unknown) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exitCode = 1;
});
