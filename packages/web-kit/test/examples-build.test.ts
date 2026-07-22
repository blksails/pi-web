/**
 * 构建 webext 示例的 `.pi/web`(agent-web-extension 任务 6.x)。
 *
 * 在 web-kit 自身的 vitest 中用真实 `buildWebExtension` 把 4 个代码示例打成 ESM +
 * manifest,写入各示例 `.pi/web/dist/`(供 e2e/node 加载,见 webext-build-load.e2e)。
 * 断言:manifest 合法、integrity 与产物一致、externals 保留(未内联 React)。
 */
import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildWebExtension } from "../build/build.js";
import { findBundledSingletons } from "../build/externals-guard.js";
import { computeIntegrity } from "../build/manifest-emit.js";
import { Buffer } from "node:buffer";

const repoRoot = resolve(fileURLToPath(new URL(".", import.meta.url)), "../../..");

const EXAMPLES = [
  { id: "webext-layout", name: "webext-layout-agent" },
  { id: "webext-renderer", name: "webext-renderer-agent" },
  { id: "webext-contrib", name: "webext-contrib-agent" },
  { id: "webext-artifact", name: "webext-artifact-agent" },
  { id: "webext-background", name: "webext-background-agent" },
  { id: "state-bridge", name: "state-bridge-agent" },
  { id: "webext-slots", name: "webext-slots-agent" },
  { id: "workbench-modules", name: "workbench-modules-agent" },
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
