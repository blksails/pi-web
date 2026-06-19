import { describe, expect, it } from "vitest";
import {
  ArtifactMessageSchema,
  parseArtifactMessage,
} from "../../src/web-ext/artifact.js";

describe("ArtifactMessage", () => {
  it("accepts ready/resize/event/rpc", () => {
    expect(ArtifactMessageSchema.safeParse({ kind: "ready", manifestId: "acme" }).success).toBe(true);
    expect(ArtifactMessageSchema.safeParse({ kind: "resize", height: 320 }).success).toBe(true);
    expect(ArtifactMessageSchema.safeParse({ kind: "event", name: "save", data: { x: 1 } }).success).toBe(true);
    expect(
      ArtifactMessageSchema.safeParse({
        kind: "rpc",
        request: { correlationId: "c1", point: "custom", action: "execute", payload: {}, protocolVersion: "0.1.0" },
      }).success,
    ).toBe(true);
  });

  it("parseArtifactMessage returns undefined for malformed input", () => {
    expect(parseArtifactMessage({ kind: "bogus" })).toBeUndefined();
    expect(parseArtifactMessage({ kind: "resize", height: -1 })).toBeUndefined();
    expect(parseArtifactMessage(null)).toBeUndefined();
  });
});
