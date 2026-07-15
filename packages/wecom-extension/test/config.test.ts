import { describe, expect, it } from "vitest";
import { resolveWecomGatewayConfig } from "../src/config.js";

describe("resolveWecomGatewayConfig", () => {
  it("defaults baseUrl and channel", () => {
    const c = resolveWecomGatewayConfig({});
    expect(c.baseUrl).toBe("http://127.0.0.1:7930");
    expect(c.defaultChannelId).toBe("wecom");
  });

  it("honors PI_GATEWAY_BASE_URL", () => {
    const c = resolveWecomGatewayConfig({
      PI_GATEWAY_BASE_URL: "http://gw:7930/",
      PI_GATEWAY_CHANNEL_ID: "wecom-prod",
      PI_GATEWAY_TOKEN: "secret",
    });
    expect(c.baseUrl).toBe("http://gw:7930");
    expect(c.defaultChannelId).toBe("wecom-prod");
    expect(c.token).toBe("secret");
  });
});
