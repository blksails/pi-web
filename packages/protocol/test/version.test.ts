import { describe, expect, it } from "vitest";
import { protocolVersion } from "../src/version.js";

const SEMVER =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z-.]+)?(?:\+[0-9A-Za-z-.]+)?$/;

describe("protocolVersion", () => {
  it("is exported and defined", () => {
    expect(protocolVersion).toBeDefined();
    expect(typeof protocolVersion).toBe("string");
  });

  it("is a valid SemVer string", () => {
    expect(protocolVersion).toMatch(SEMVER);
  });
});
