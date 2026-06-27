import { describe, expect, it } from "vitest";
import {
  RpcExtensionUIRequestSchema,
  RpcExtensionUIResponseSchema,
} from "../../src/rpc/extension-ui.js";

describe("RpcExtensionUIRequestSchema", () => {
  it("parses each method", () => {
    expect(
      RpcExtensionUIRequestSchema.parse({
        type: "extension_ui_request",
        id: "1",
        method: "select",
        title: "pick",
        options: ["a", "b"],
      }).method,
    ).toBe("select");
    expect(
      RpcExtensionUIRequestSchema.parse({
        type: "extension_ui_request",
        id: "2",
        method: "setStatus",
        statusKey: "k",
        statusText: undefined,
      }).method,
    ).toBe("setStatus");
  });

  it("rejects an unknown method", () => {
    expect(
      RpcExtensionUIRequestSchema.safeParse({
        type: "extension_ui_request",
        id: "1",
        method: "telepathy",
        title: "x",
      }).success,
    ).toBe(false);
  });

  it("rejects select missing options with field path", () => {
    const res = RpcExtensionUIRequestSchema.safeParse({
      type: "extension_ui_request",
      id: "1",
      method: "select",
      title: "x",
    });
    expect(res.success).toBe(false);
    if (!res.success) {
      expect(res.error.issues.some((i) => i.path.includes("options"))).toBe(true);
    }
  });

  // spec ctx-ui-custom-bridge:pi-web 扩展的 custom 方法(承载声明式组件描述)。
  it("parses method=custom with a serializable payload", () => {
    const parsed = RpcExtensionUIRequestSchema.parse({
      type: "extension_ui_request",
      id: "9",
      method: "custom",
      payload: { component: "demo-metric-card", props: { label: "x", value: 1 } },
    });
    expect(parsed.method).toBe("custom");
    if (parsed.method === "custom") {
      expect(parsed.payload.component).toBe("demo-metric-card");
    }
  });

  it("allows custom payload without props", () => {
    expect(
      RpcExtensionUIRequestSchema.safeParse({
        type: "extension_ui_request",
        id: "9",
        method: "custom",
        payload: { component: "demo-callout" },
      }).success,
    ).toBe(true);
  });

  it("rejects custom missing payload / empty component (field path)", () => {
    expect(
      RpcExtensionUIRequestSchema.safeParse({
        type: "extension_ui_request",
        id: "9",
        method: "custom",
      }).success,
    ).toBe(false);
    const res = RpcExtensionUIRequestSchema.safeParse({
      type: "extension_ui_request",
      id: "9",
      method: "custom",
      payload: { component: "" },
    });
    expect(res.success).toBe(false);
    if (!res.success) {
      expect(res.error.issues.some((i) => i.path.includes("component"))).toBe(true);
    }
  });
});

describe("RpcExtensionUIResponseSchema", () => {
  it("parses value / confirmed / cancelled variants", () => {
    expect(
      RpcExtensionUIResponseSchema.parse({
        type: "extension_ui_response",
        id: "1",
        value: "a",
      }),
    ).toMatchObject({ value: "a" });
    expect(
      RpcExtensionUIResponseSchema.parse({
        type: "extension_ui_response",
        id: "1",
        confirmed: true,
      }),
    ).toMatchObject({ confirmed: true });
    expect(
      RpcExtensionUIResponseSchema.parse({
        type: "extension_ui_response",
        id: "1",
        cancelled: true,
      }),
    ).toMatchObject({ cancelled: true });
  });

  it("rejects a response with wrong type", () => {
    expect(
      RpcExtensionUIResponseSchema.safeParse({ type: "x", id: "1", value: "a" })
        .success,
    ).toBe(false);
  });
});
