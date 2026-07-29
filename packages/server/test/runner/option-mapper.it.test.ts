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

describe("mapResourceLoaderOptions allowExtensions (Req 2.2/2.3/2.4/3.2/3.4/5.2)", () => {
  it("maps empty allowExtensions to noExtensions=true without extensionsOverride (Req 2.2/2.3/3.4)", () => {
    const { resourceLoaderOptions } = mapResourceLoaderOptions({ allowExtensions: [] });
    expect(resourceLoaderOptions.noExtensions).toBe(true);
    expect("extensionsOverride" in resourceLoaderOptions).toBe(false);
  });

  it("maps non-empty allowExtensions to an extensionsOverride function without noExtensions (Req 3.2)", () => {
    const { resourceLoaderOptions } = mapResourceLoaderOptions({ allowExtensions: ["keep"] });
    expect(typeof resourceLoaderOptions.extensionsOverride).toBe("function");
    expect("noExtensions" in resourceLoaderOptions).toBe(false);
  });

  it("injects neither key when allowExtensions is absent (Req 5.2 — preserve SDK defaults)", () => {
    const { resourceLoaderOptions } = mapResourceLoaderOptions({});
    expect("noExtensions" in resourceLoaderOptions).toBe(false);
    expect("extensionsOverride" in resourceLoaderOptions).toBe(false);
  });

  // --- Behavior of the override returned for a non-empty whitelist ---
  // These tests actually CALL extensionsOverride(base) and assert the filtered
  // result, so that mutants like "filter → false" (drop all) or "drop ...base"
  // (lose errors/runtime) are killed.

  type LoadExtensionsResult = Parameters<
    NonNullable<
      NonNullable<
        ReturnType<typeof mapResourceLoaderOptions>["resourceLoaderOptions"]["extensionsOverride"]
      >
    >
  >[0];

  /** Minimal controlled fake of a single discovered extension (only `path` is read). */
  function fakeExtension(path: string): LoadExtensionsResult["extensions"][number] {
    return { path } as unknown as LoadExtensionsResult["extensions"][number];
  }

  /** Minimal controlled fake of a LoadExtensionsResult with sentinel errors/runtime. */
  function fakeBase(
    paths: string[],
    extra: { errors?: unknown; runtime?: unknown } = {},
  ): LoadExtensionsResult {
    return {
      extensions: paths.map(fakeExtension),
      errors: extra.errors,
      runtime: extra.runtime,
    } as unknown as LoadExtensionsResult;
  }

  it("override keeps whitelisted + inline + explicit, drops the rest, and passes errors/runtime through (Req 3.2/3.3/2.4)", () => {
    const errorsSentinel = [{ path: "x", error: "e" }];
    const runtimeSentinel = { __runtime: Symbol("runtime") };

    const { resourceLoaderOptions } = mapResourceLoaderOptions({
      allowExtensions: ["keep"],
      extensions: ["./explicit.js"],
    });
    const override = resourceLoaderOptions.extensionsOverride;
    expect(typeof override).toBe("function");

    const base = fakeBase(
      [
        "/some/dir/keep.js",
        "/some/dir/drop.js",
        "<inline:1>",
        "/other/dir/explicit.js",
      ],
      { errors: errorsSentinel, runtime: runtimeSentinel },
    );

    const result = override!(base);

    const keptPaths = result.extensions.map((e) => e.path);
    expect(keptPaths).toEqual([
      "/some/dir/keep.js", // named whitelist match
      "<inline:1>", // factory-appended item
      "/other/dir/explicit.js", // explicit string-path appended item
    ]);
    expect(keptPaths).not.toContain("/some/dir/drop.js"); // dropped

    // errors/runtime threaded through untouched (kills "drop ...base" mutant).
    expect(result.errors).toBe(errorsSentinel);
    expect(result.runtime).toBe(runtimeSentinel);
  });

  it("override yields an empty extensions list (and does not throw) when nothing matches the whitelist (Req 3.5)", () => {
    const { resourceLoaderOptions } = mapResourceLoaderOptions({
      allowExtensions: ["missing"],
    });
    const override = resourceLoaderOptions.extensionsOverride;
    expect(typeof override).toBe("function");

    const base = fakeBase([
      "/some/dir/alpha.js",
      "/some/dir/beta.js",
      "/some/dir/gamma.js",
    ]);

    let result!: LoadExtensionsResult;
    expect(() => {
      result = override!(base);
    }).not.toThrow();
    expect(result.extensions).toEqual([]);
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
