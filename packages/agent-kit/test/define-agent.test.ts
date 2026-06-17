import { describe, expect, it } from "vitest";
import { defineAgent } from "../src/index.js";
import type { AgentDefinition } from "../src/index.js";

describe("defineAgent", () => {
  it("returns the exact same reference (identity, Req 1.2)", () => {
    const def: AgentDefinition = {
      model: { provider: "anthropic", modelId: "claude-opus-4-5" },
      systemPrompt: "You are helpful.",
    };
    const result = defineAgent(def);
    expect(result).toBe(def);
  });

  it("does not mutate the input or add fields (no runtime side effects)", () => {
    const def: AgentDefinition = { tools: ["read", "bash"] };
    const before = JSON.stringify(def);
    const result = defineAgent(def);
    expect(JSON.stringify(result)).toBe(before);
    expect(Object.keys(result)).toEqual(["tools"]);
  });

  it("accepts a full definition covering every documented field", () => {
    const def = defineAgent({
      model: { provider: "anthropic", modelId: "claude-opus-4-5" },
      thinkingLevel: "high",
      tools: ["read"],
      excludeTools: ["bash"],
      noTools: "builtin",
      customTools: [],
      systemPrompt: () => "prompt",
      extensions: ["./ext.js"],
      skills: (base) => base,
      promptTemplates: (base) => base,
      contextFiles: (base) => base,
      scopedModels: [
        {
          model: { provider: "anthropic", modelId: "claude-opus-4-5" },
          thinkingLevel: "low",
        },
      ],
    });
    expect(def.thinkingLevel).toBe("high");
  });
});
