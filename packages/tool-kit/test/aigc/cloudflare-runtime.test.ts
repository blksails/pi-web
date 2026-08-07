/**
 * Cloudflare 运行时凭据：无 .env.local、凭 aigc.json / env bag 启用。
 * 驱动 shipped resolveCloudflareRuntimeEnv + isCloudflareConfigured。
 */
import { describe, expect, it } from "vitest";
import {
  isCloudflareConfigured,
  mergeCloudflareRuntimeEnv,
  cloudflareEnvFromAigcConfig,
  CLOUDFLARE_REQUIRED_ENV,
} from "../../src/aigc/providers/cloudflare.js";
import {
  resolveCloudflareRuntimeEnv,
  cloudflareSpawnEnvFragment,
  isCloudflareConfiguredAtRuntime,
  readAigcConfigFile,
} from "../../src/aigc/cloudflare-runtime.js";

const FULL_ENV = {
  CLOUDFLARE_ACCOUNT_ID: "acct",
  CLOUDFLARE_AIG_GATEWAY_ID: "gw",
  CLOUDFLARE_API_TOKEN: "tok",
};

const FULL_JSON = {
  cloudflareAccountId: "acct-file",
  cloudflareGatewayId: "gw-file",
  cloudflareApiToken: "tok-file",
};

describe("cloudflareEnvFromAigcConfig", () => {
  it("maps camelCase aigc.json fields to CLOUDFLARE_* env names", () => {
    expect(cloudflareEnvFromAigcConfig(FULL_JSON)).toEqual({
      CLOUDFLARE_ACCOUNT_ID: "acct-file",
      CLOUDFLARE_AIG_GATEWAY_ID: "gw-file",
      CLOUDFLARE_API_TOKEN: "tok-file",
    });
  });

  it("ignores blank / missing", () => {
    expect(cloudflareEnvFromAigcConfig({ cloudflareAccountId: "  " })).toEqual({});
    expect(cloudflareEnvFromAigcConfig(undefined)).toEqual({});
  });
});

describe("mergeCloudflareRuntimeEnv — env wins over file", () => {
  it("fills missing env keys from aigc.json", () => {
    const merged = mergeCloudflareRuntimeEnv({}, FULL_JSON);
    expect(isCloudflareConfigured(merged)).toBe(true);
    expect(merged.CLOUDFLARE_ACCOUNT_ID).toBe("acct-file");
  });

  it("keeps non-empty process env over file", () => {
    const merged = mergeCloudflareRuntimeEnv(
      { CLOUDFLARE_ACCOUNT_ID: "from-env", CLOUDFLARE_AIG_GATEWAY_ID: "", CLOUDFLARE_API_TOKEN: "" },
      FULL_JSON,
    );
    expect(merged.CLOUDFLARE_ACCOUNT_ID).toBe("from-env");
    expect(merged.CLOUDFLARE_AIG_GATEWAY_ID).toBe("gw-file");
    expect(merged.CLOUDFLARE_API_TOKEN).toBe("tok-file");
  });
});

describe("resolveCloudflareRuntimeEnv + isCloudflareConfiguredAtRuntime", () => {
  it("(a) three credentials via runtime config only → configured", () => {
    const bag = resolveCloudflareRuntimeEnv({
      env: {},
      aigcConfig: FULL_JSON,
    });
    expect(isCloudflareConfigured(bag)).toBe(true);
    expect(isCloudflareConfiguredAtRuntime({ env: {}, aigcConfig: FULL_JSON })).toBe(true);
  });

  it("(b) any missing → not configured", () => {
    for (const key of Object.keys(FULL_JSON) as (keyof typeof FULL_JSON)[]) {
      const partial = { ...FULL_JSON };
      delete partial[key];
      expect(
        isCloudflareConfiguredAtRuntime({ env: {}, aigcConfig: partial }),
        `missing ${key}`,
      ).toBe(false);
    }
  });

  it("process env alone still works (no file)", () => {
    expect(
      isCloudflareConfiguredAtRuntime({ env: FULL_ENV, aigcConfig: null }),
    ).toBe(true);
  });

  it("spawn fragment only emits non-empty CLOUDFLARE_* keys", () => {
    const frag = cloudflareSpawnEnvFragment({ env: {}, aigcConfig: FULL_JSON });
    expect(Object.keys(frag).sort()).toEqual([...CLOUDFLARE_REQUIRED_ENV].sort());
    expect(frag.CLOUDFLARE_API_TOKEN).toBe("tok-file");
  });

  it("readAigcConfigFile fail-soft on missing file", () => {
    expect(
      readAigcConfigFile("/no/such/agent-dir", () => {
        throw new Error("ENOENT");
      }),
    ).toBeUndefined();
  });

  it("readAigcConfigFile parses JSON via injected readFile", () => {
    const cfg = readAigcConfigFile("/tmp/agent", () => JSON.stringify(FULL_JSON));
    expect(cfg?.cloudflareAccountId).toBe("acct-file");
  });
});
