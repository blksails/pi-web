import { describe, expect, it } from "vitest";
import { readFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Buffer } from "node:buffer";
import { fileURLToPath } from "node:url";
import { buildWebExtension } from "../build/build.js";
import { computeIntegrity } from "../build/manifest-emit.js";
import { findBundledSingletons } from "../build/externals-guard.js";
import { WebExtensionManifestSchema } from "@pi-web/protocol";

const fixtureDir = fileURLToPath(new URL("./fixtures/ext-a", import.meta.url));

describe("buildWebExtension (集成)", () => {
  it("把 fixture 打成 ESM + manifest,react/web-kit 保持 external,integrity 一致", async () => {
    const out = await mkdtemp(join(tmpdir(), "webext-build-"));
    try {
      const result = await buildWebExtension({
        id: "ext-a",
        targetApiVersion: "^0.1.0",
        entryDir: fixtureDir,
        outDir: out,
        capabilities: ["slots"],
      });

      // manifest 合法
      expect(WebExtensionManifestSchema.safeParse(result.manifest).success).toBe(true);

      // 产物存在且未内联 react(externals 生效)
      const code = await readFile(result.entryOut, "utf8");
      expect(findBundledSingletons(code)).toHaveLength(0);
      // external 保留为 import 语句(react / web-kit 不被打入)
      expect(code).toMatch(/from\s*["']react["']|from\s*["']react\/jsx-runtime["']/);
      expect(code).toContain("@pi-web/web-kit");

      // integrity 与产物字节一致
      const recomputed = computeIntegrity(Buffer.from(code, "utf8"));
      expect(result.manifest.integrity).toBe(recomputed);
    } finally {
      await rm(out, { recursive: true, force: true });
    }
  });
});
