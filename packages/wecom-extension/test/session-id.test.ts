import { describe, expect, it } from "vitest";
import { resolveSessionId } from "../src/session-id.js";

describe("resolveSessionId", () => {
  it("reads PI_WEB_SESSION_ID env", () => {
    expect(
      resolveSessionId(["node", "runner"], { PI_WEB_SESSION_ID: "sess-env" }),
    ).toBe("sess-env");
  });

  it("reads --session-id flag", () => {
    expect(
      resolveSessionId(["node", "x", "--session-id", "sess-arg"], {}),
    ).toBe("sess-arg");
  });

  it("reads --session-id=value form", () => {
    expect(resolveSessionId(["node", "--session-id=sess-eq"], {})).toBe("sess-eq");
  });

  it("returns undefined when missing", () => {
    expect(resolveSessionId(["node", "x"], {})).toBeUndefined();
  });
});
