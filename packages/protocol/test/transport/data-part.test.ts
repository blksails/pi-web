import { describe, expect, it } from "vitest";
import { DataPartSchema } from "../../src/transport/data-part.js";

describe("DataPartSchema", () => {
  it("parses each pi-specific data-part type", () => {
    expect(
      DataPartSchema.parse({
        type: "data-pi-queue",
        data: { steering: ["a"], followUp: [] },
      }).type,
    ).toBe("data-pi-queue");
    expect(
      DataPartSchema.parse({
        type: "data-pi-compaction",
        data: { phase: "start", reason: "threshold" },
      }).type,
    ).toBe("data-pi-compaction");
    expect(
      DataPartSchema.parse({
        type: "data-pi-auto-retry",
        data: { phase: "start", attempt: 1 },
      }).type,
    ).toBe("data-pi-auto-retry");
    expect(
      DataPartSchema.parse({
        type: "data-pi-tool-partial",
        data: { toolCallId: "t1", toolName: "bash", partialResult: "out" },
      }).type,
    ).toBe("data-pi-tool-partial");
  });

  it("rejects an unknown type", () => {
    expect(DataPartSchema.safeParse({ type: "data-pi-unknown", data: {} }).success).toBe(
      false,
    );
  });

  it("rejects a known type with a malformed payload (field path)", () => {
    const res = DataPartSchema.safeParse({
      type: "data-pi-queue",
      data: { steering: "not-an-array", followUp: [] },
    });
    expect(res.success).toBe(false);
    if (!res.success) {
      expect(res.error.issues.some((i) => i.path.includes("steering"))).toBe(true);
    }
  });
});
