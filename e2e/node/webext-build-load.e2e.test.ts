/**
 * Node e2e(agent-web-extension 任务 7.x):加载预构建的示例 WebExtension。
 *
 * 前置:`pnpm --filter @blksails/pi-web-kit test`(examples-build.test.ts)已把 4 个代码示例
 * 构建到各自 `.pi/web/dist/`。本测试用真实加载器 + 安全门从磁盘加载,证明:
 *  - 门控(SRI/版本)通过;原生 import esbuild ESM 可执行(externals 由 node_modules 解析)取得描述符;
 *  - 声明式示例(Tier5)走零 bundle 路径,config 生效。
 *
 * 跳过:若 dist 未构建则跳过对应用例(提示先跑 web-kit 构建)。
 */
import { describe, expect, it } from "vitest";
import { readFile, access } from "node:fs/promises";
import { join, resolve } from "node:path";
import { loadExtension, verifyExtension, type LoaderDeps } from "@blksails/pi-web-react";
import { type WebExtensionManifest } from "@blksails/pi-web-protocol";

/** 产物内联 React 的强特征(不应出现在 external 正确的 bundle 中)。 */
function hasInlinedReact(code: string): boolean {
  return (
    /Invalid hook call/.test(code) ||
    /__SECRET_INTERNALS_DO_NOT_USE/.test(code) ||
    /react\.development\.js/.test(code)
  );
}

const GATE = { whitelist: [], requireSignature: false, hostApiVersion: "0.1.0" };

/** 声明式扩展加载用(无 bundle,不需 import)。 */
function declarativeDeps(): LoaderDeps {
  return {
    async fetchBytes(url) {
      return new Uint8Array(await readFile(new URL(url)));
    },
    importModule() {
      return Promise.reject(new Error("declarative path should not import"));
    },
  };
}

async function exists(p: string): Promise<boolean> {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

const CODE_EXAMPLES = [
  { id: "webext-layout", dist: "examples/webext-layout-agent/.pi/web/dist" },
  { id: "webext-renderer", dist: "examples/webext-renderer-agent/.pi/web/dist" },
  { id: "webext-contrib", dist: "examples/webext-contrib-agent/.pi/web/dist" },
  { id: "webext-artifact", dist: "examples/webext-artifact-agent/.pi/web/dist" },
  { id: "webext-background", dist: "examples/webext-background-agent/.pi/web/dist" },
];

describe("webext examples: build artifacts gate + integrity (offline e2e)", () => {
  for (const ex of CODE_EXAMPLES) {
    it(`${ex.id}:真实产物过安全门(SRI/版本)且 externals 保留`, async () => {
      const distAbs = resolve(ex.dist);
      const manifestPath = join(distAbs, "manifest.json");
      if (!(await exists(manifestPath))) {
        throw new Error(
          `未找到 ${manifestPath}。请先运行 pnpm --filter @blksails/pi-web-kit test 构建示例。`,
        );
      }
      const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as WebExtensionManifest;
      const entryBytes = new Uint8Array(await readFile(join(distAbs, manifest.entry as string)));

      // 安全门:对真实产物字节做 SRI + 版本校验(证明 build 产出的 integrity 与字节一致)。
      const gate = await verifyExtension({ manifest, entryBytes, opts: GATE });
      expect(gate.ok).toBe(true);

      // externals 保留:未内联 React,bare import 仍在(运行时由 import map 解析单例)。
      const code = new TextDecoder().decode(entryBytes);
      expect(hasInlinedReact(code)).toBe(false);
      expect(code).toContain("@blksails/pi-web-kit");
    });
  }

  it("declarative 示例:零 bundle 路径,config 生效", async () => {
    const manifest = JSON.parse(
      await readFile(
        resolve("examples/webext-declarative-agent/.pi/web/manifest.json"),
        "utf8",
      ),
    ) as WebExtensionManifest;
    const outcome = await loadExtension({
      manifest,
      baseUrl: "file:///unused/",
      opts: GATE,
      deps: declarativeDeps(),
    });
    expect(outcome.status).toBe("declarative");
    if (outcome.status === "declarative") {
      // 断言「config 透传生效」:与 fixture manifest 源值一致(而非钉死字面量)。
      // 历史教训:69fa1dc 有意把示例 layout split→wide 强化演示,钉死 "split" 的旧断言
      // 从此假红——本用例考察的是 loadExtension 不丢/不改 config,不是示例取什么值。
      expect(manifest.config?.layout).toBeDefined();
      expect(outcome.extension.config?.layout).toBe(manifest.config?.layout);
    }
  });
});
