import { describe, expect, it } from "vitest";
import {
  ClearQueueLineSchema,
  ClearQueueResultLineSchema,
} from "../../src/web-ext/queue-line.js";
import { ClearQueueResponseSchema } from "../../src/transport/rest-dto.js";

describe("ClearQueueLine (server→runner 请求行)", () => {
  it("accepts a well-formed request line", () => {
    const r = ClearQueueLineSchema.safeParse({
      type: "piweb_clear_queue",
      id: "cq_1",
    });
    expect(r.success).toBe(true);
  });

  it("rejects wrong type or empty id", () => {
    expect(
      ClearQueueLineSchema.safeParse({ type: "piweb_state", id: "cq_1" }).success,
    ).toBe(false);
    expect(
      ClearQueueLineSchema.safeParse({ type: "piweb_clear_queue", id: "" }).success,
    ).toBe(false);
  });
});

describe("ClearQueueResultLine (runner→server 结果行)", () => {
  it("accepts steering + followUp arrays", () => {
    const r = ClearQueueResultLineSchema.safeParse({
      type: "piweb_clear_queue_result",
      id: "cq_1",
      steering: ["a", "b"],
      followUp: [],
    });
    expect(r.success).toBe(true);
  });

  it("rejects missing arrays or wrong type", () => {
    expect(
      ClearQueueResultLineSchema.safeParse({
        type: "piweb_clear_queue_result",
        id: "cq_1",
        steering: ["a"],
      }).success,
    ).toBe(false);
  });
});

describe("ClearQueueResponse (REST 响应体)", () => {
  it("accepts cleared queue payload", () => {
    const r = ClearQueueResponseSchema.safeParse({
      steering: ["x"],
      followUp: ["y", "z"],
    });
    expect(r.success).toBe(true);
  });

  it("rejects non-string entries", () => {
    expect(
      ClearQueueResponseSchema.safeParse({ steering: [1], followUp: [] }).success,
    ).toBe(false);
  });
});
