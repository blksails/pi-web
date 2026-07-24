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
 *   3) 运行时声明夹具 webext-runtime-declarative(纯声明 manifest,无 entry / 无签名);
 *   4) 运行时 slots 夹具 webext-slots-runtime(任务 6.4,第三方 slots 源本地全链 e2e):
 *      与构建期静态 import 车道的 webext-slots-agent 同构(18 槽全集),但**不进
 *      `lib/app/webext-registry.ts` 注册表**,只经 /api/webext/resolve 运行时车道生效;
 *      同一把测试签名私钥签发(webext-runtime-code 已用它建立 whitelist 信任,复用无需
 *      新增白名单条目);
 *   5) 安全门降级夹具(任务 6.4):webext-slots-runtime-tampered(正常签名,entry 字节
 *      构建后被篡改 → 浏览器原生 SRI 校验拒绝执行)与 webext-slots-runtime-badsig
 *      (manifest 用非白名单私钥签名 → 服务端验签拒绝下发),均验证宿主壳降级不崩壳。
 *
 * ⚠ 签名密钥对与 `test/build-runtime-code-fixture.test.ts` 保持一致(仅签此测试夹具,非真实凭据);
 *   公钥须同步为 playwright.config.ts 的 PI_WEB_EXT_WHITELIST。
 */
import { resolve } from "node:path";
import { mkdir, writeFile, appendFile } from "node:fs/promises";
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

// 坏签名降级夹具专用私钥(任务 6.4):刻意**不**加入 playwright.config.ts 的
// PI_WEB_EXT_WHITELIST,用于验证服务端 WebextTrustService 对未受信公钥的拒绝路径。
// 非真实凭据,与 TEST_SIGN_PRIVATE_KEY 无关联,仅本仓测试使用。
const UNTRUSTED_SIGN_PRIVATE_KEY =
  "MC4CAQAwBQYDK2VwBCIEIG0q16iqrv/oaTFHHeqL9Plk4KActgx9HN8TgLZ5nIzW";

/** 运行时声明夹具 manifest(纯声明,无 entry / 无签名)。resolve 端点直接读此文件。 */
const RUNTIME_DECLARATIVE_MANIFEST = {
  id: "webext-runtime-declarative",
  targetApiVersion: "^0.5.0",
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
      targetApiVersion: "^0.5.0",
      entryDir: dir,
      outDir: resolve(dir, "dist"),
    });
  }
}

async function buildRuntimeCodeFixture(): Promise<void> {
  const dir = resolve("examples/webext-runtime-code-agent/.pi/web");
  await buildWebExtension({
    id: "webext-runtime-code",
    targetApiVersion: "^0.5.0",
    entryDir: dir,
    outDir: resolve(dir, "dist"),
    signKey: TEST_SIGN_PRIVATE_KEY,
  });
}

/**
 * 运行时 slots 夹具(任务 6.4):显式传 capabilities(build 不解析 web.config.tsx 里的
 * `defineWebExtension({ capabilities })` 运行时声明,须调用方显式传入,见 6.1 学习)+
 * 复用 webext-runtime-code 的测试签名私钥,产出带 entry + SRI + 签名的 manifest,
 * 只能经运行时车道(resolve → dist → import)加载,不进构建期静态 import 注册表。
 */
async function buildRuntimeSlotsFixture(): Promise<void> {
  const dir = resolve("examples/webext-slots-runtime-agent/.pi/web");
  await buildWebExtension({
    id: "webext-slots-runtime",
    targetApiVersion: "^0.5.0",
    entryDir: dir,
    outDir: resolve(dir, "dist"),
    capabilities: ["slots", "config"],
    signKey: TEST_SIGN_PRIVATE_KEY,
  });
}

/**
 * 篡改降级夹具(任务 6.4):正常构建 + 正常签名(manifest.json 的 SRI 摘要对应
 * 构建时的原始字节),随后在 entry `.mjs` 文件末尾追加污染字节,使其实际内容与
 * manifest 里记的 SRI 摘要不再匹配——manifest 本身仍是合法签名,所以服务端验签
 * 会放行(rejectedReason 不触发),真正的拒绝发生在浏览器 fetch 该 entry 时的
 * 原生 `integrity` 校验(SRI 是「浏览器验」,而非服务端验,详见 design 面⑤ 安全门)。
 */
async function buildRuntimeSlotsTamperedFixture(): Promise<void> {
  const dir = resolve("examples/webext-slots-runtime-tampered-agent/.pi/web");
  const result = await buildWebExtension({
    id: "webext-slots-runtime-tampered",
    targetApiVersion: "^0.5.0",
    entryDir: dir,
    outDir: resolve(dir, "dist"),
    capabilities: ["slots", "config"],
    signKey: TEST_SIGN_PRIVATE_KEY,
  });
  await appendFile(result.entryOut, "\n// tampered-by-e2e-fixture-setup\n", "utf8");
}

/**
 * 坏签名降级夹具(任务 6.4):正常构建,但用一把不在 PI_WEB_EXT_WHITELIST 里的私钥签名。
 * manifest 本身格式合法、签名自洽(签名与公钥匹配),但服务端 WebextTrustService 按
 * 白名单公钥校验时找不到匹配项 → resolve 端点应返回 `{found:true, rejectedReason}`。
 */
async function buildRuntimeSlotsBadSigFixture(): Promise<void> {
  const dir = resolve("examples/webext-slots-runtime-badsig-agent/.pi/web");
  await buildWebExtension({
    id: "webext-slots-runtime-badsig",
    targetApiVersion: "^0.5.0",
    entryDir: dir,
    outDir: resolve(dir, "dist"),
    capabilities: ["slots", "config"],
    signKey: UNTRUSTED_SIGN_PRIVATE_KEY,
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
  await buildRuntimeSlotsFixture();
  await buildRuntimeSlotsTamperedFixture();
  await buildRuntimeSlotsBadSigFixture();
  await writeRuntimeDeclarativeFixture();
}
