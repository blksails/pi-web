/**
 * 结构性断言：Cloudflare 凭据与 materials 基址不必在 pack 时 string-fold 进 payload。
 * 驱动 shipped 函数：仅 runtime bag / 注入 config 即可启用。
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { isCloudflareConfiguredAtRuntime } from "../../src/aigc/cloudflare-runtime.js";
import { fileURLToPath } from "node:url";

// test/aigc/ → package root packages/tool-kit
const ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "../..");

describe("runtime-not-bake: Cloudflare", () => {
  it("enables with only runtime aigcConfig injection (no process CLOUDFLARE_* at start)", () => {
    const emptyProcess: Record<string, string | undefined> = {};
    // 模拟 pack 后 process 上没有 CLOUDFLARE_*（release 桌面常态）
    for (const k of [
      "CLOUDFLARE_ACCOUNT_ID",
      "CLOUDFLARE_AIG_GATEWAY_ID",
      "CLOUDFLARE_API_TOKEN",
    ]) {
      expect(emptyProcess[k]).toBeUndefined();
    }
    expect(
      isCloudflareConfiguredAtRuntime({
        env: emptyProcess,
        aigcConfig: {
          cloudflareAccountId: "runtime-acct",
          cloudflareGatewayId: "runtime-gw",
          cloudflareApiToken: "runtime-tok",
        },
      }),
    ).toBe(true);
  });

  it("cloudflare-runtime source does not hardcode production token literals", () => {
    const src = readFileSync(
      join(ROOT, "src/aigc/cloudflare-runtime.ts"),
      "utf8",
    );
    expect(src).not.toMatch(/cfoat_/);
    expect(src).not.toMatch(/CLOUDFLARE_API_TOKEN\s*=\s*["'][^"']+["']/);
  });
});
