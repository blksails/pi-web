import { describe, expect, it } from "vitest";
import {
  UiRpcRequestSchema,
  UiRpcResponseSchema,
  UiRpcControlPayloadSchema,
} from "../../src/web-ext/ui-rpc.js";
import { SseFrameSchema, makeControlFrame } from "../../src/transport/sse-frame.js";

describe("UiRpc request/response", () => {
  it("accepts a valid request", () => {
    const r = UiRpcRequestSchema.safeParse({
      correlationId: "c1",
      point: "slash",
      action: "list",
      payload: { prefix: "/" },
      protocolVersion: "0.1.0",
    });
    expect(r.success).toBe(true);
  });

  it("rejects an unknown point", () => {
    const r = UiRpcRequestSchema.safeParse({
      correlationId: "c1",
      point: "telepathy",
      action: "list",
      payload: {},
      protocolVersion: "0.1.0",
    });
    expect(r.success).toBe(false);
  });

  it("response carries error when not ok", () => {
    const r = UiRpcResponseSchema.safeParse({
      correlationId: "c1",
      ok: false,
      error: { code: "TIMEOUT", message: "timed out" },
    });
    expect(r.success).toBe(true);
  });
});

describe("ui-rpc control frame", () => {
  it("is a valid SSE control frame via makeControlFrame", () => {
    const frame = makeControlFrame({
      control: "ui-rpc",
      response: { correlationId: "c1", ok: true, result: ["a", "b"] },
    });
    const r = SseFrameSchema.safeParse(frame);
    expect(r.success).toBe(true);
  });

  it("control payload schema validates ui-rpc shape", () => {
    expect(
      UiRpcControlPayloadSchema.safeParse({
        control: "ui-rpc",
        response: { correlationId: "c1", ok: true },
      }).success,
    ).toBe(true);
  });
});
