/**
 * Playwright globalSetup:构建浏览器 e2e 依赖的 webext 示例产物(`.pi/web/dist`)。
 *
 * 背景(e2e-triage 根因):`examples/*​/.pi/web/dist` 是 **gitignored 构建产物**(根 .gitignore
 * 的 `dist/` 匹配任意层级),fresh worktree / CI checkout 中缺失;且既有 `scripts/build-webext-examples.ts`
 * 未被任何构建流水线(build:dist)调用,更未覆盖两个「运行时加载」夹具。缺产物时:
 *   - webext-full / webext-layout 等加载 6 个代码示例的用例找不到 dist;
 *   - webext-runtime-install 的运行时声明/代码夹具经 `/api/webext/resolve` 解析返回 found:false。
 *
 * 本 setup 在 e2e 启动前**幂等重建**全部所需产物,使浏览器 e2e 自足可复现:
 *   1) 6 个代码示例(构建期注册表车道,无需签名);
 *   2) 运行时代码夹具 webext-runtime-code(用测试专用私钥 Ed25519 签名 —— 其公钥经
 *      playwright.config 的 PI_WEB_EXT_WHITELIST 在服务端受信,解锁 resolve 验签车道);
 *   3) 运行时声明夹具 webext-runtime-declarative(纯声明 manifest,无 entry / 无签名)。
 *
 * ⚠ 签名密钥对与 `test/build-runtime-code-fixture.test.ts` 保持一致(仅签此测试夹具,非真实凭据);
 *   公钥须同步为 playwright.config.ts 的 PI_WEB_EXT_WHITELIST。
 */
import { resolve } from "node:path";
import { mkdir, writeFile } from "node:fs/promises";
import { buildWebExtension } from "../packages/web-kit/build/build.js";

/** 6 个代码示例(构建期注册表车道):id 与 `scripts/build-webext-examples.ts` 对齐。 */
const CODE_EXAMPLES: ReadonlyArray<{ name: string; id: string }> = [
  { name: "webext-layout", id: "webext-layout" },
  { name: "webext-renderer", id: "webext-renderer" },
  { name: "webext-contrib", id: "webext-contrib" },
  { name: "webext-artifact", id: "webext-artifact" },
  { name: "webext-background", id: "webext-background" },
  { name: "plugin-code-review", id: "code-review" },
];

// 测试专用签名密钥对(非真实凭据)。PUB 同步于 playwright.config.ts 的 PI_WEB_EXT_WHITELIST
// 与 test/build-runtime-code-fixture.test.ts。
const TEST_SIGN_PRIVATE_KEY =
  "MC4CAQAwBQYDK2VwBCIEINshygrsGx9uv1OWZ3aCO3c2oGRoqb3zeqhFl4Y1qzwj";

/** 运行时声明夹具 manifest(纯声明,无 entry / 无签名)。resolve 端点直接读此文件。 */
const RUNTIME_DECLARATIVE_MANIFEST = {
  id: "webext-runtime-declarative",
  targetApiVersion: "^0.1.0",
  capabilities: ["config"],
  config: {
    documentTitle: "Runtime Declarative · pi-web",
    theme: {
      "--primary": "262 83% 58%",
      "--accent": "262 90% 96%",
      "--ring": "262 83% 58%",
    },
    layout: "wide",
    empty: {
      title: "运行时声明式 webext · 动态加载",
      subtitle:
        "本扩展不在构建期注册表，经 /api/webext/resolve 运行时加载生效。",
    },
  },
};

async function buildCodeExampleDists(): Promise<void> {
  for (const { name, id } of CODE_EXAMPLES) {
    const dir = resolve(`examples/${name}-agent/.pi/web`);
    await buildWebExtension({
      id,
      targetApiVersion: "^0.1.0",
      entryDir: dir,
      outDir: resolve(dir, "dist"),
    });
  }
}

async function buildRuntimeCodeFixture(): Promise<void> {
  const dir = resolve("examples/webext-runtime-code-agent/.pi/web");
  await buildWebExtension({
    id: "webext-runtime-code",
    targetApiVersion: "^0.1.0",
    entryDir: dir,
    outDir: resolve(dir, "dist"),
    signKey: TEST_SIGN_PRIVATE_KEY,
  });
}

async function writeRuntimeDeclarativeFixture(): Promise<void> {
  const dist = resolve("examples/webext-runtime-declarative-agent/.pi/web/dist");
  await mkdir(dist, { recursive: true });
  await writeFile(
    resolve(dist, "manifest.json"),
    JSON.stringify(RUNTIME_DECLARATIVE_MANIFEST, null, 2),
    "utf8",
  );
}

export default async function globalSetup(): Promise<void> {
  await buildCodeExampleDists();
  await buildRuntimeCodeFixture();
  await writeRuntimeDeclarativeFixture();
}
