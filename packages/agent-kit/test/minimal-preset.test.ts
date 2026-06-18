import { describe, expect, it } from "vitest";
import { defineMinimalAgent, minimalAgentPreset } from "../src/index.js";

describe("minimalAgentPreset", () => {
  it("declares the three close fields (noTools/allowExtensions/skills, Req 1.2/1.3/1.4)", () => {
    expect(minimalAgentPreset.noTools).toBe("all");
    expect(minimalAgentPreset.allowExtensions).toEqual([]);
    expect(typeof minimalAgentPreset.skills).toBe("function");
  });
});

describe("defineMinimalAgent", () => {
  it("preserves the three close fields by default (Req 4.1)", () => {
    const def = defineMinimalAgent();
    expect(def.noTools).toBe("all");
    expect(def.allowExtensions).toEqual([]);
    expect(typeof def.skills).toBe("function");
  });

  it("keeps author overrides while preserving close semantics (Req 4.1/4.4)", () => {
    const model = { provider: "anthropic", modelId: "claude-opus-4-5" } as const;
    const def = defineMinimalAgent({ model });
    expect(def.model).toEqual(model);
    expect(def.noTools).toBe("all");
    expect(def.allowExtensions).toEqual([]);
    expect(typeof def.skills).toBe("function");
  });
});
