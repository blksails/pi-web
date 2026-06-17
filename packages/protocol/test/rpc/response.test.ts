import { describe, expect, it } from "vitest";
import { RpcResponseSchema } from "../../src/rpc/response.js";

describe("RpcResponseSchema", () => {
  it("parses a simple success response", () => {
    const r = { id: "1", type: "response", command: "prompt", success: true };
    expect(RpcResponseSchema.parse(r)).toEqual(r);
  });

  it("parses a success response carrying data", () => {
    const r = {
      type: "response",
      command: "export_html",
      success: true,
      data: { path: "/tmp/x.html" },
    };
    expect(RpcResponseSchema.parse(r)).toMatchObject({ data: { path: "/tmp/x.html" } });
  });

  it("parses a failure response", () => {
    const r = {
      type: "response",
      command: "anything",
      success: false,
      error: "boom",
    };
    expect(RpcResponseSchema.parse(r)).toMatchObject({ success: false, error: "boom" });
  });

  it("rejects a failure response missing error", () => {
    const res = RpcResponseSchema.safeParse({
      type: "response",
      command: "x",
      success: false,
    });
    expect(res.success).toBe(false);
  });

  it("rejects a wrong top-level type", () => {
    const res = RpcResponseSchema.safeParse({
      type: "event",
      command: "prompt",
      success: true,
    });
    expect(res.success).toBe(false);
  });
});
