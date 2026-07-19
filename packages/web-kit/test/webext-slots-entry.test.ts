/**
 * 面⑤ 路线 A(M2 任务 6.1)— `examples/webext-slots-agent`(18 槽 fixture)build 出带
 * `entry` 的 manifest,验收 Req 8.1-8.4:
 *   8.1 manifest 带 entry(.mjs)+ 逐文件 sha384 SRI + Ed25519 签名
 *   8.2 entry bundle 经 import map 单例复用宿主 React(不打包第二份 React)
 *   8.3 canonicalManifestBytes 排除 signature 字段
 *   8.4 18 槽 fixture 可 build 出带 entry manifest 作为路线 A 验收 fixture
 */
import { describe, expect, it } from "vitest";
import { readFile, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Buffer } from "node:buffer";
import { webcrypto } from "node:crypto";
import { buildWebExtension } from "../build/build.js";
import {
  computeIntegrity,
  generateSigningKeyPair,
} from "../build/manifest-emit.js";
import { findBundledSingletons } from "../build/externals-guard.js";
import {
  WebExtensionManifestSchema,
  canonicalManifestBytes,
  type WebExtensionManifest,
} from "@blksails/pi-web-protocol";

const repoRoot = resolve(fileURLToPath(new URL(".", import.meta.url)), "../../..");
const entryDir = resolve(repoRoot, "examples/webext-slots-agent/.pi/web");

async function verifySignatureRaw(
  manifest: WebExtensionManifest,
  publicKeyB64: string,
): Promise<boolean> {
  if (manifest.signature === undefined) return false;
  const { signature, ...rest } = manifest;
  const key = await webcrypto.subtle.importKey(
    "raw",
    Buffer.from(publicKeyB64, "base64"),
    { name: "Ed25519" },
    false,
    ["verify"],
  );
  return webcrypto.subtle.verify(
    { name: "Ed25519" },
    key,
    Buffer.from(signature, "base64"),
    new TextEncoder().encode(canonicalManifestBytes(rest)),
  );
}

describe("webext-slots-agent 编进带 entry 的 manifest(面⑤ 路线 A · 6.1)", () => {
  it("build 产出 entry + SRI + 签名,manifest 合法(Req 8.1, 8.4)", async () => {
    const out = await mkdtemp(join(tmpdir(), "webext-slots-entry-"));
    try {
      const { publicKey, privateKey } = await generateSigningKeyPair();
      const result = await buildWebExtension({
        id: "webext-slots",
        targetApiVersion: "^0.1.0",
        entryDir,
        outDir: out,
        capabilities: ["slots", "config"],
        signKey: privateKey,
      });

      expect(WebExtensionManifestSchema.safeParse(result.manifest).success).toBe(true);
      expect(result.manifest.entry).toBe("web-extension.mjs");
      expect(result.manifest.integrity).toMatch(/^sha384-/);
      expect(result.manifest.signature).toBeDefined();
      expect(result.manifest.capabilities).toEqual(["slots", "config"]);

      // SRI 与产物字节一致
      const code = await readFile(result.entryOut, "utf8");
      const recomputed = computeIntegrity(Buffer.from(code, "utf8"));
      expect(result.manifest.integrity).toBe(recomputed);

      // entry bundle 确实编进了 18 槽 fixture 的组件代码(而非空壳)
      expect(code).toContain("Ext Background");
      expect(code).toContain("Dialog Layer");
      expect(code).toContain("data-testid");

      // 签名可被对应公钥验证
      expect(await verifySignatureRaw(result.manifest, publicKey)).toBe(true);

      // manifest.json 落盘且与返回值一致
      const manifestOnDisk = JSON.parse(
        await readFile(join(out, "manifest.json"), "utf8"),
      );
      expect(manifestOnDisk).toEqual(result.manifest);
    } finally {
      await rm(out, { recursive: true, force: true });
    }
  });

  it("entry bundle 经 import map 外部化 react/web-kit,不打包第二份 React(Req 8.2)", async () => {
    const out = await mkdtemp(join(tmpdir(), "webext-slots-entry-"));
    try {
      const result = await buildWebExtension({
        id: "webext-slots",
        targetApiVersion: "^0.1.0",
        entryDir,
        outDir: out,
        capabilities: ["slots", "config"],
      });
      const code = await readFile(result.entryOut, "utf8");

      // externals 守卫:未检出 react/react-dom 内联特征
      expect(findBundledSingletons(code)).toHaveLength(0);
      // react 保持 external import(浏览器 import map 解析到宿主单例)
      expect(code).toMatch(/from\s*["']react\/jsx-runtime["']|from\s*["']react["']/);
      expect(code).toContain("@blksails/pi-web-kit");
    } finally {
      await rm(out, { recursive: true, force: true });
    }
  });

  it("篡改 entry 字节后 SRI 不再与 manifest.integrity 匹配(Req 10.2 的构建侧前置断言)", async () => {
    const out = await mkdtemp(join(tmpdir(), "webext-slots-entry-"));
    try {
      const result = await buildWebExtension({
        id: "webext-slots",
        targetApiVersion: "^0.1.0",
        entryDir,
        outDir: out,
        capabilities: ["slots", "config"],
      });

      // 模拟传输/落盘后被篡改
      const tampered = (await readFile(result.entryOut, "utf8")) + "\n// tampered";
      await writeFile(result.entryOut, tampered, "utf8");
      const tamperedIntegrity = computeIntegrity(Buffer.from(tampered, "utf8"));

      expect(tamperedIntegrity).not.toBe(result.manifest.integrity);
    } finally {
      await rm(out, { recursive: true, force: true });
    }
  });

  it("canonicalManifestBytes 排除 signature 字段(Req 8.3)", async () => {
    const out = await mkdtemp(join(tmpdir(), "webext-slots-entry-"));
    try {
      const { privateKey: keyA } = await generateSigningKeyPair();
      const { privateKey: keyB } = await generateSigningKeyPair();
      const resultA = await buildWebExtension({
        id: "webext-slots",
        targetApiVersion: "^0.1.0",
        entryDir,
        outDir: out,
        capabilities: ["slots", "config"],
        signKey: keyA,
      });
      const resultB = await buildWebExtension({
        id: "webext-slots",
        targetApiVersion: "^0.1.0",
        entryDir,
        outDir: out,
        capabilities: ["slots", "config"],
        signKey: keyB,
      });

      // 两把不同私钥 ⇒ 不同签名,但其余字段等价
      expect(resultA.manifest.signature).not.toBe(resultB.manifest.signature);

      const { signature: _sigA, ...restA } = resultA.manifest;
      const { signature: _sigB, ...restB } = resultB.manifest;
      // canonical 字节只由未签名字段决定,与 signature 无关
      expect(canonicalManifestBytes(restA)).toBe(canonicalManifestBytes(restB));
      expect(canonicalManifestBytes(resultA.manifest)).toBe(
        canonicalManifestBytes({ ...restA }),
      );
    } finally {
      await rm(out, { recursive: true, force: true });
    }
  });
});
