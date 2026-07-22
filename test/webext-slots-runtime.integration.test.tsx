// @vitest-environment node
/**
 * 面⑤ 路线 A(M2 任务 6.2)— 第三方 slots 代码扩展运行时全链加载 + 挂 SlotHost。
 *
 * 用 6.1 的构建产物(直接调 `buildWebExtension` 构建 `webext-slots-agent`,显式传
 * `capabilities:["slots","config"]`)模拟一个**第三方本地源**(不经构建期静态 import
 * 车道 `lib/app/webext-registry.ts`),走真实生产链路:
 *
 *   resolveWebext(真实 locateDist/readManifestJson/toBaseUrl + 真实 WebextTrustService
 *   服务端验签)→ 已背书 manifest + baseUrl → readDistFile(真实 dist 路由内核,同
 *   `handleWebextDist` 逻辑)取 entry 字节 → loadExtension(真实 SRI 门 + 真实浏览器侧
 *   `signaturePreVerified` 分支)→ 动态 `import()`(真实 ESM 模块,非 mock)→ 拿到运行时
 *   WebExtension 描述符 → `<SlotHost>` 挂进代表性槽区渲染。
 *
 * 覆盖 Req 9.1-9.4:
 *   9.1 manifest 带 entry → loadExtension 走 status:"loaded"。
 *   9.2 加载的 slots 组件渲染到宿主既有槽区挂载点(panelRight/headerLeft/footer/background)。
 *   9.3 全链经 resolveWebext + dist 读取(不经 webext-registry 静态 import 车道)。
 *   9.4 声明式-only 回归见既有 `test/webext-resolve.test.ts`(纯声明分支零改动,未受本任务触碰)。
 *
 * `@vitest-environment node`(而非项目根默认的 jsdom):esbuild(`buildWebExtension` 内核)
 * 启动时的 realm 自检 `new TextEncoder().encode("") instanceof Uint8Array` 在 jsdom 沙箱下
 * 失败(jsdom 的 Uint8Array 与 Node 原生 TextEncoder 产物不同源,非本任务可控);渲染验证改用
 * `react-dom/server` 的 `renderToStaticMarkup`(纯字符串输出,不需要 DOM/jsdom)。
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import * as React from "react";
import { mkdir, rm, writeFile, readFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { webcrypto } from "node:crypto";
import { Buffer } from "node:buffer";

import {
  loadExtension,
  type LoaderDeps,
  type GateOptions,
} from "@blksails/pi-web-react";
import { SlotHost } from "@blksails/pi-web-ui";
import type { WebExtension } from "@blksails/pi-web-kit";
import { canonicalManifestBytes, type WebExtensionManifest } from "@blksails/pi-web-protocol";

import {
  locateDist,
  readManifestJson,
  toBaseUrl,
  decodeDistDir,
  readDistFile,
} from "../lib/app/webext/locate-dist.js";
import { resolveWebext } from "../lib/app/webext/resolve-webext.js";
import { createTrustedPublisherRegistry } from "../lib/app/webext/trusted-publisher-registry.js";
import { createWebextTrustService } from "../lib/app/webext/webext-trust-service.js";

const repoRoot = path.resolve(__dirname, "..");
// 建在仓库树内(而非 os.tmpdir()):动态 import() 的裸 specifier(react / @blksails/pi-web-kit)
// 靠祖先目录 node_modules 解析,os.tmpdir() 与仓库树无关联会解析失败。
const THIRD_PARTY_SOURCE = path.join(repoRoot, ".tmp-webext-slots-runtime-src");

let manifest: WebExtensionManifest;
let baseUrl: string;
let distDir: string;
let manifestPath: string;
let originalManifestJson: string;
let resolveDeps: {
  locateDist: typeof locateDist;
  readManifestJson: typeof readManifestJson;
  toBaseUrl: typeof toBaseUrl;
  trust: ReturnType<typeof createWebextTrustService>;
};
let roguePublisherPriv: CryptoKey;

/** 解析 `/api/webext/dist/<enc>/<relFile>` → {distDir, relFile}(同 handleWebextDist 的路径切分)。 */
function parseDistUrl(url: string): { distDir: string; relFile: string } {
  const prefix = "/api/webext/dist/";
  if (!url.startsWith(prefix)) throw new Error(`unexpected dist url: ${url}`);
  const rest = url.slice(prefix.length);
  const slash = rest.indexOf("/");
  const enc = rest.slice(0, slash);
  const relFile = rest.slice(slash + 1);
  return { distDir: decodeDistDir(enc), relFile };
}

function realDeps(): LoaderDeps {
  return {
    async fetchBytes(url: string): Promise<Uint8Array> {
      const { distDir: d, relFile } = parseDistUrl(url);
      const found = await readDistFile(d, relFile);
      if (found === undefined) throw new Error(`dist file not found: ${url}`);
      return new Uint8Array(found.bytes);
    },
    async importModule(url: string): Promise<{ default: WebExtension }> {
      const { distDir: d, relFile } = parseDistUrl(url);
      const fileUrl = pathToFileURL(path.join(d, relFile)).href;
      // 真实动态 import(非 mock):生产 esbuild 产物是合法 ESM,可被原生 import() 执行。
      return import(/* @vite-ignore */ fileUrl) as Promise<{ default: WebExtension }>;
    },
  };
}

beforeAll(async () => {
  // 固定目录(非 mkdtemp 随机名)更贴合「已装第三方源」的稳定路径语义。
  await rm(THIRD_PARTY_SOURCE, { recursive: true, force: true });
  await mkdir(THIRD_PARTY_SOURCE, { recursive: true });

  // signKey 入参形状是 base64 pkcs8 私钥字符串(见 manifest-emit.ts signManifest);web-kit
  // 的 `generateSigningKeyPair` 帮助函数未经 `/build` 公开 barrel 导出,故本地按同一转换
  // 手法(webcrypto Ed25519 → pkcs8/raw base64)内联生成,与该函数等价。
  const subtle = webcrypto.subtle;
  const kp = (await subtle.generateKey({ name: "Ed25519" }, true, [
    "sign",
    "verify",
  ])) as CryptoKeyPair;
  const publicKeyB64 = Buffer.from(await subtle.exportKey("raw", kp.publicKey)).toString(
    "base64",
  );
  const privateKey = Buffer.from(
    await subtle.exportKey("pkcs8", kp.privateKey),
  ).toString("base64");

  const entryDir = path.resolve(repoRoot, "examples/webext-slots-agent/.pi/web");
  const outDir = path.join(THIRD_PARTY_SOURCE, ".pi", "web", "dist");
  const { buildWebExtension } = await import("@blksails/pi-web-kit/build");
  const result = await buildWebExtension({
    id: "webext-slots-agent-thirdparty",
    targetApiVersion: "^0.1.0",
    entryDir,
    outDir,
    capabilities: ["slots", "config"],
    signKey: privateKey,
  });
  expect(result.manifest.entry).toBe("web-extension.mjs");

  // 流氓发布者:私钥不进白名单,用于验签矩阵中「非白名单 key 签名」用例。
  const rogue = (await subtle.generateKey({ name: "Ed25519" }, true, [
    "sign",
    "verify",
  ])) as CryptoKeyPair;
  roguePublisherPriv = rogue.privateKey;

  // 真实服务端验签流水线:受信发布者白名单含刚生成的公钥,requireSignature:true(生产语义)。
  const registry = createTrustedPublisherRegistry({
    rootPublicKey: "",
    localAdd: [{ id: "test-publisher", publicKey: publicKeyB64 }],
  });
  const trust = createWebextTrustService({
    registry,
    requireSignature: true,
    isProduction: false,
  });
  resolveDeps = { locateDist, readManifestJson, toBaseUrl, trust };

  // 真实 resolveWebext:第三方源(THIRD_PARTY_SOURCE 是绝对路径,locateDist 按「本地源路径」
  // 候选命中,与 webext-registry 静态 import 车道完全无关,Req 9.3)。
  const resolved = await resolveWebext(THIRD_PARTY_SOURCE, resolveDeps);
  expect(resolved.found).toBe(true);
  expect(resolved.rejectedReason).toBeUndefined();
  expect(resolved.manifest).toBeDefined();
  expect(resolved.baseUrl).toBeDefined();

  manifest = resolved.manifest as unknown as WebExtensionManifest;
  baseUrl = resolved.baseUrl as string;
  distDir = path.resolve(outDir);
  manifestPath = path.join(distDir, "manifest.json");
  originalManifestJson = await readFile(manifestPath, "utf8");
}, 30_000);

afterAll(async () => {
  await rm(THIRD_PARTY_SOURCE, { recursive: true, force: true });
});

describe("第三方 slots 代码扩展:resolve → dist → loadExtension → import → SlotHost(Req 9.1-9.3)", () => {
  it("baseUrl 解码回真实 dist 目录(未经构建期静态 import 车道)", () => {
    const { distDir: decoded } = parseDistUrl(baseUrl + manifest.entry);
    expect(decoded).toBe(distDir);
  });

  it("loadExtension 走 status:'loaded'(代码扩展分支,Req 9.1)", async () => {
    // 浏览器侧门控:签名已服务端验(resolveWebext 已去 signature 并标记
    // signaturePreVerified),浏览器只需 SRI(与 lib/app/webext-load-client.ts
    // browserGateOptions 同构)。
    const opts: GateOptions = {
      whitelist: [],
      requireSignature: false,
      signaturePreVerified: true,
    };
    const outcome = await loadExtension({
      manifest,
      baseUrl,
      opts,
      deps: realDeps(),
    });
    expect(outcome.status).toBe("loaded");
    if (outcome.status !== "loaded") return;

    const ext = outcome.extension;
    expect(ext.manifestId).toBeTruthy();
    expect(ext.slots).toBeDefined();

    // 挂进宿主既有槽区(pi-chat.tsx / chat-app.tsx 挂载点同款 SlotHost),验代表性槽:
    // panelRight(右侧检视面板)、headerLeft(header 三区)、footer、background。SSR 到静态
    // 字符串(非需要 jsdom 的 render()),但走的是同一 SlotHost/ExtErrorBoundary 渲染路径。
    const html = renderToStaticMarkup(
      <div>
        <SlotHost ext={ext} slot="panelRight" />
        <SlotHost ext={ext} slot="headerLeft" />
        <SlotHost ext={ext} slot="footer" />
        <SlotHost ext={ext} slot="background" />
      </div>,
    );
    expect(html).toContain('data-testid="slot-panel-right"');
    expect(html).toContain("Panel Right");
    expect(html).toContain('data-testid="slot-header-left"');
    expect(html).toContain("Header L");
    expect(html).toContain('data-testid="slot-footer"');
    expect(html).toContain("Ext Footer");
    expect(html).toContain('data-testid="slot-background"');
    expect(html).toContain("Ext Background");
  });

  it("篡改 dist 字节后 SRI 不再匹配 → loadExtension 拒绝(安全门在运行时车道上生效)", async () => {
    const entryPath = path.join(distDir, manifest.entry as string);
    const original = await readFile(entryPath, "utf8");
    await writeFile(entryPath, original + "\n// tampered", "utf8");
    try {
      const opts: GateOptions = {
        whitelist: [],
        requireSignature: false,
        signaturePreVerified: true,
      };
      const outcome = await loadExtension({
        manifest,
        baseUrl,
        opts,
        deps: realDeps(),
      });
      expect(outcome.status).toBe("rejected");
    } finally {
      await writeFile(entryPath, original, "utf8");
    }
  });
});

/**
 * 任务 6.3 — 安全门贯通拒绝矩阵(Req 10.1-10.3)。在 6.2 已验证的真实
 * resolveWebext(服务端验签)+ loadExtension(浏览器侧 SRI)全链上,逐档篡改
 * manifest.json 本身(签名/integrity 字段),证明服务端验签门与 SRI 门各自独立拒绝、
 * 不误放行,且每次测试后原样恢复 manifest.json 不污染后续用例。
 */
describe("安全门拒绝矩阵:坏签名 / 非白名单 key / integrity 字段被篡改(Req 10.1-10.3)", () => {
  async function restoreManifest(): Promise<void> {
    await writeFile(manifestPath, originalManifestJson, "utf8");
  }

  it("签名由非白名单(流氓)私钥产出 → resolveWebext 服务端验签拒绝(Req 10.3)", async () => {
    const raw = JSON.parse(originalManifestJson) as WebExtensionManifest;
    // 剥离已背书态(vetted manifest 无 signature),还原成「未验签的作者产出物」形状后
    // 用流氓私钥重签,模拟发布链上被劫持成非白名单 key 签名的场景。
    const unsigned: Omit<WebExtensionManifest, "signature"> = {
      id: raw.id,
      targetApiVersion: raw.targetApiVersion,
      entry: raw.entry,
      integrity: raw.integrity,
      capabilities: raw.capabilities,
    };
    const data = new TextEncoder().encode(canonicalManifestBytes(unsigned));
    const forgedSig = Buffer.from(
      await webcrypto.subtle.sign({ name: "Ed25519" }, roguePublisherPriv, data),
    ).toString("base64");
    await writeFile(
      manifestPath,
      JSON.stringify({ ...unsigned, signature: forgedSig }),
      "utf8",
    );
    try {
      const resolved = await resolveWebext(THIRD_PARTY_SOURCE, resolveDeps);
      expect(resolved.found).toBe(true);
      expect(resolved.manifest).toBeUndefined();
      expect(resolved.rejectedReason).toBeDefined();
      expect(resolved.rejectedReason).toMatch(/签名|受信/);
    } finally {
      await restoreManifest();
    }
  });

  it("manifest 未签名(代码扩展要求签名)→ resolveWebext 拒绝(Req 10.1)", async () => {
    const raw = JSON.parse(originalManifestJson) as WebExtensionManifest;
    const unsigned = { ...raw };
    delete (unsigned as { signature?: string }).signature;
    await writeFile(manifestPath, JSON.stringify(unsigned), "utf8");
    try {
      const resolved = await resolveWebext(THIRD_PARTY_SOURCE, resolveDeps);
      expect(resolved.found).toBe(true);
      expect(resolved.manifest).toBeUndefined();
      expect(resolved.rejectedReason).toBeDefined();
    } finally {
      await restoreManifest();
    }
  });

  it("manifest.integrity 字段本身被篡改(字节未动,仅改声明值)→ 服务端验签环节因签名覆盖 integrity 而先行拒绝(Req 10.2)", async () => {
    // signature 覆盖 canonicalManifestBytes(含 integrity),篡改 integrity 但沿用旧签名
    // 会先在验签环节被拒(签名对不上新 integrity),体现「签名覆盖完整性声明」的设计。
    const raw = JSON.parse(originalManifestJson) as WebExtensionManifest;
    const tampered = { ...raw, integrity: "sha384-TAMPERED-INTEGRITY-FIELD" };
    await writeFile(manifestPath, JSON.stringify(tampered), "utf8");
    try {
      const resolved = await resolveWebext(THIRD_PARTY_SOURCE, resolveDeps);
      expect(resolved.found).toBe(true);
      expect(resolved.manifest).toBeUndefined();
      expect(resolved.rejectedReason).toBeDefined();
    } finally {
      await restoreManifest();
    }
  });

  it("恢复原始 manifest.json 后 resolveWebext 重新放行(证明矩阵用例未污染 fixture)", async () => {
    const resolved = await resolveWebext(THIRD_PARTY_SOURCE, resolveDeps);
    expect(resolved.found).toBe(true);
    expect(resolved.rejectedReason).toBeUndefined();
    expect(resolved.manifest).toBeDefined();
  });
});
