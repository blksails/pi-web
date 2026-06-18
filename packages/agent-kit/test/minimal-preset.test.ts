import { describe, expect, it } from "vitest";
import type { ToolDefinition } from "../src/index.js";
import { defineMinimalAgent, minimalAgentPreset } from "../src/index.js";

describe("minimalAgentPreset", () => {
  it("declares the three close fields (noTools/allowExtensions/skills, Req 1.2/1.3/1.4)", () => {
    expect(minimalAgentPreset.noTools).toBe("all");
    expect(minimalAgentPreset.allowExtensions).toEqual([]);
    expect(typeof minimalAgentPreset.skills).toBe("function");
  });

  it("skills override returns empty skills while passing diagnostics through (Req 1.3)", () => {
    // Non-empty sentinel skills + a sentinel diagnostics reference. The shapes
    // are opaque to the override (it only re-emits diagnostics), so cast the
    // sentinels to the SDK's expected parameter type.
    const skills = [{ name: "sentinel-skill" }] as never;
    const diagnostics = [{ kind: "sentinel-diagnostic" }] as never;

    // skills is a function on the preset (guarded by the test above); invoke it.
    const result = (minimalAgentPreset.skills as NonNullable<typeof minimalAgentPreset.skills>)({
      skills,
      diagnostics,
    });

    expect(result.skills).toEqual([]);
    // Same diagnostics reference is returned untouched (identity, not a copy).
    expect(result.diagnostics).toBe(diagnostics);
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

  it("preserves model/systemPrompt/customTools overrides alongside close semantics (Req 4.1/4.2)", () => {
    const model = { provider: "anthropic", modelId: "claude-opus-4-5" } as const;
    const systemPrompt = "You are a minimal helper.";
    const customTools: ToolDefinition[] = [];
    const def = defineMinimalAgent({ model, systemPrompt, customTools });

    // Author-provided fields are preserved.
    expect(def.model).toEqual(model);
    expect(def.systemPrompt).toBe(systemPrompt);
    // customTools is preserved by reference (close semantics never touch it).
    expect(def.customTools).toBe(customTools);

    // All three close semantics remain intact.
    expect(def.noTools).toBe("all");
    expect(typeof def.skills).toBe("function");
    expect(def.allowExtensions).toEqual([]);
  });

  it("allowExtensions override replaces the preset whitelist (Req 4.4)", () => {
    const def = defineMinimalAgent({ allowExtensions: ["foo"] });

    // Whitelist override wins over the preset's [].
    expect(def.allowExtensions).toEqual(["foo"]);

    // Other close semantics are unchanged.
    expect(def.noTools).toBe("all");
    expect(typeof def.skills).toBe("function");
  });
});
