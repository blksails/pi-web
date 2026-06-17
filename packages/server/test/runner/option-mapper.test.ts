import { describe, expect, it } from "vitest";
import type { ExtensionFactory } from "@earendil-works/pi-coding-agent";
import type { AgentDefinition } from "../../src/runner/agent-definition.js";
import {
  isModelRef,
  mapResourceLoaderOptions,
  mapSessionFields,
} from "../../src/runner/option-mapper.js";

describe("mapResourceLoaderOptions (resource-class fields, Req 3.1)", () => {
  it("maps systemPrompt string to a systemPromptOverride returning the value", () => {
    const { resourceLoaderOptions } = mapResourceLoaderOptions({
      systemPrompt: "be terse",
    });
    expect(typeof resourceLoaderOptions.systemPromptOverride).toBe("function");
    expect(resourceLoaderOptions.systemPromptOverride!("ignored")).toBe("be terse");
  });

  it("maps systemPrompt thunk by evaluating it once", () => {
    let calls = 0;
    const { resourceLoaderOptions } = mapResourceLoaderOptions({
      systemPrompt: () => {
        calls++;
        return "lazy";
      },
    });
    expect(calls).toBe(1);
    expect(resourceLoaderOptions.systemPromptOverride!(undefined)).toBe("lazy");
  });

  it("splits extensions into additionalExtensionPaths (strings) and extensionFactories (functions)", () => {
    const factory: ExtensionFactory = () => {};
    const { resourceLoaderOptions } = mapResourceLoaderOptions({
      extensions: ["./a.js", factory, "./b.js"],
    });
    expect(resourceLoaderOptions.additionalExtensionPaths).toEqual(["./a.js", "./b.js"]);
    expect(resourceLoaderOptions.extensionFactories).toEqual([factory]);
  });

  it("only sets the extension keys that are populated", () => {
    const pathsOnly = mapResourceLoaderOptions({ extensions: ["./a.js"] });
    expect(pathsOnly.resourceLoaderOptions.additionalExtensionPaths).toEqual(["./a.js"]);
    expect("extensionFactories" in pathsOnly.resourceLoaderOptions).toBe(false);

    const factory: ExtensionFactory = () => {};
    const factoriesOnly = mapResourceLoaderOptions({ extensions: [factory] });
    expect(factoriesOnly.resourceLoaderOptions.extensionFactories).toEqual([factory]);
    expect("additionalExtensionPaths" in factoriesOnly.resourceLoaderOptions).toBe(false);
  });

  it("maps skills/promptTemplates/contextFiles to *Override hooks", () => {
    const skills: AgentDefinition["skills"] = (base) => base;
    const promptTemplates: AgentDefinition["promptTemplates"] = (base) => base;
    const contextFiles: AgentDefinition["contextFiles"] = (base) => base;
    const { resourceLoaderOptions } = mapResourceLoaderOptions({
      skills,
      promptTemplates,
      contextFiles,
    });
    expect(resourceLoaderOptions.skillsOverride).toBe(skills);
    expect(resourceLoaderOptions.promptsOverride).toBe(promptTemplates);
    expect(resourceLoaderOptions.agentsFilesOverride).toBe(contextFiles);
  });

  it("injects nothing for an empty definition (Req 3.3 — preserve SDK defaults)", () => {
    const { resourceLoaderOptions } = mapResourceLoaderOptions({});
    expect(Object.keys(resourceLoaderOptions)).toEqual([]);
  });
});

describe("mapSessionFields (session-class fields, Req 3.2/3.3)", () => {
  it("threads every provided session field through unchanged", () => {
    const def: AgentDefinition = {
      model: { provider: "anthropic", modelId: "claude-opus-4-5" },
      thinkingLevel: "high",
      tools: ["read"],
      excludeTools: ["bash"],
      noTools: "builtin",
      customTools: [],
      scopedModels: [
        { model: { provider: "anthropic", modelId: "claude-opus-4-5" }, thinkingLevel: "low" },
      ],
    };
    const mapped = mapSessionFields(def);
    expect(mapped.model).toEqual(def.model);
    expect(mapped.thinkingLevel).toBe("high");
    expect(mapped.tools).toEqual(["read"]);
    expect(mapped.excludeTools).toEqual(["bash"]);
    expect(mapped.noTools).toBe("builtin");
    expect(mapped.customTools).toEqual([]);
    expect(mapped.scopedModels).toEqual(def.scopedModels);
  });

  it("omits absent fields entirely (Req 3.3)", () => {
    const mapped = mapSessionFields({ tools: ["read"] });
    expect(Object.keys(mapped)).toEqual(["tools"]);
    expect("model" in mapped).toBe(false);
    expect("noTools" in mapped).toBe(false);
  });
});

describe("isModelRef", () => {
  it("treats { provider, modelId } as a ref", () => {
    expect(isModelRef({ provider: "anthropic", modelId: "x" })).toBe(true);
  });

  it("treats a resolved Model (has `api`) as not a ref", () => {
    const model = { provider: "anthropic", modelId: "x", api: "anthropic-messages" } as never;
    expect(isModelRef(model)).toBe(false);
  });
});
