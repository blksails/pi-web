/**
 * version 单测:protocolVersion 承载 + 不兼容协商(Req 7.1,7.2,7.3)。
 */
import { describe, expect, it } from "vitest";
import { protocolVersion } from "@blksails/pi-web-protocol";
import { checkVersion, isCompatible } from "../../src/http/version.js";
import { PROTOCOL_VERSION_HEADER } from "../../src/http/error-map.js";

describe("version handshake", () => {
  it("uses @blksails/pi-web-protocol as the single source", () => {
    expect(protocolVersion).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it("same MAJOR is compatible", () => {
    const major = protocolVersion.split(".")[0];
    expect(isCompatible(`${major}.9.9`)).toBe(true);
  });

  it("different MAJOR is incompatible", () => {
    const major = Number(protocolVersion.split(".")[0]);
    expect(isCompatible(`${major + 1}.0.0`)).toBe(false);
  });

  it("no declared version → passes (undefined)", () => {
    const req = new Request("http://x/sessions");
    expect(checkVersion(req)).toBeUndefined();
  });

  it("incompatible declared version → 426", () => {
    const major = Number(protocolVersion.split(".")[0]);
    const req = new Request("http://x/sessions", {
      headers: { [PROTOCOL_VERSION_HEADER]: `${major + 1}.0.0` },
    });
    const res = checkVersion(req);
    expect(res?.status).toBe(426);
  });
});
