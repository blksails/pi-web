import { describe, expect, it } from "vitest";
import { RpcCommandSchema } from "../../src/rpc/command.js";

describe("RpcCommandSchema", () => {
  it("parses a valid prompt command", () => {
    const cmd = {
      id: "1",
      type: "prompt",
      message: "hi",
      streamingBehavior: "steer",
    };
    expect(RpcCommandSchema.parse(cmd)).toEqual(cmd);
  });

  it("parses commands without id and with extra typed fields", () => {
    expect(RpcCommandSchema.parse({ type: "abort" }).type).toBe("abort");
    expect(
      RpcCommandSchema.parse({ type: "set_model", provider: "anthropic", modelId: "x" }),
    ).toMatchObject({ type: "set_model" });
    expect(
      RpcCommandSchema.parse({ type: "set_thinking_level", level: "high" }),
    ).toMatchObject({ level: "high" });
  });

  it("rejects unknown command type (safeParse) with a field path", () => {
    const res = RpcCommandSchema.safeParse({ type: "nope" });
    expect(res.success).toBe(false);
  });

  it("rejects a prompt command missing required message", () => {
    const res = RpcCommandSchema.safeParse({ type: "prompt" });
    expect(res.success).toBe(false);
    if (!res.success) {
      expect(res.error.issues.some((i) => i.path.includes("message"))).toBe(true);
    }
  });

  it("rejects wrong field type", () => {
    const res = RpcCommandSchema.safeParse({ type: "prompt", message: 123 });
    expect(res.success).toBe(false);
  });
});
