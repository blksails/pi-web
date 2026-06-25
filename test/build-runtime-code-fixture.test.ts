// @vitest-environment node
/**
 * 构建 + 签名「代码 webext 运行时加载」夹具(webext-package-install 任务 5.3 前置)。
 *
 * 把 examples/webext-runtime-code-agent/.pi/web 打成签名 .mjs + manifest,供运行时车道
 * e2e 加载。签名用 **测试专用** Ed25519 私钥(下方常量),其对应公钥在 e2e 服务端经
 * PI_WEB_EXT_WHITELIST 受信。该私钥仅签名此测试夹具,非任何真实凭据。
 */
import { describe, expect, it } from "vitest";
import { resolve } from "node:path";
import { readFile } from "node:fs/promises";
import { Buffer } from "node:buffer";
import { buildWebExtension } from "../packages/web-kit/build/build.js";
import { computeIntegrity } from "../packages/web-kit/build/manifest-emit.js";

// 测试专用签名密钥对(非真实凭据)。PUB 同步配置于 e2e 的 PI_WEB_EXT_WHITELIST。
const TEST_SIGN_PRIVATE_KEY =
  "MC4CAQAwBQYDK2VwBCIEINshygrsGx9uv1OWZ3aCO3c2oGRoqb3zeqhFl4Y1qzwj";
export const TEST_SIGN_PUBLIC_KEY =
  "+YygXrhbbHsoc1U+pHZIUdNBE+4Qb9kK3oWMCCnEUY0=";

describe("构建代码 webext 运行时夹具", () => {
  it("打包 + Ed25519 签名 → dist(entry/integrity/signature 齐全)", async () => {
    const dir = resolve(
      __dirname,
      "../examples/webext-runtime-code-agent/.pi/web",
    );
    const result = await buildWebExtension({
      id: "webext-runtime-code",
      targetApiVersion: "^0.1.0",
      entryDir: dir,
      outDir: resolve(dir, "dist"),
      signKey: TEST_SIGN_PRIVATE_KEY,
    });
    expect(result.manifest.id).toBe("webext-runtime-code");
    expect(result.manifest.entry).toBeDefined();
    expect(result.manifest.integrity).toBeDefined();
    expect(result.manifest.signature).toBeDefined();

    const code = await readFile(result.entryOut, "utf8");
    expect(result.manifest.integrity).toBe(
      computeIntegrity(Buffer.from(code, "utf8")),
    );
    // externals 保留(未内联 React)。
    expect(code).toContain("@blksails/pi-web-kit");
  });
});
