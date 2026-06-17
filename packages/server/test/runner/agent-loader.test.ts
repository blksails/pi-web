import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { AgentContext } from "../../src/runner/agent-definition.js";
import {
  InvalidAgentDefinitionError,
  loadAgentDefinition,
  RUNTIME_FACTORY_BRAND,
} from "../../src/runner/agent-loader.js";
import { makeResolveProjectTrust } from "../../src/runner/project-trust.js";

const fixturesDir = join(dirname(fileURLToPath(import.meta.url)), "fixtures");
const fixture = (name: string): string => join(fixturesDir, name);

const ctx: AgentContext = {
  cwd: "/tmp/work",
  agentDir: "/tmp/agent",
  env: { FOO: "bar" },
};
const trust = makeResolveProjectTrust(false);

afterEach(() => {
  delete (globalThis as { __shapeBCtx?: unknown }).__shapeBCtx;
});

describe("loadAgentDefinition — three-shape normalization (Req 2.2/2.3/2.4)", () => {
  it("shape (a): definition object → a runtime factory function", async () => {
    const factory = await loadAgentDefinition(fixture("shape-a-object.ts"), ctx, trust);
    expect(typeof factory).toBe("function");
  });

  it("shape (b): (ctx) => definition → calls factory with ctx, then maps", async () => {
    const factory = await loadAgentDefinition(fixture("shape-b-factory.ts"), ctx, trust);
    expect(typeof factory).toBe("function");
    const received = (globalThis as { __shapeBCtx?: AgentContext }).__shapeBCtx;
    expect(received).toBeDefined();
    expect(received!.cwd).toBe("/tmp/work");
    expect(received!.agentDir).toBe("/tmp/agent");
    expect(received!.env).toEqual({ FOO: "bar" });
  });

  it("shape (c): marked CreateAgentSessionRuntimeFactory → passed through unchanged (no re-mapping)", async () => {
    const factory = await loadAgentDefinition(fixture("shape-c-runtime.ts"), ctx, trust);
    expect(typeof factory).toBe("function");
    // Carries the runtime-factory brand and is used verbatim: invoking it runs
    // the fixture's own body (which throws its sentinel), proving no re-mapping.
    expect((factory as unknown as Record<string, unknown>)[RUNTIME_FACTORY_BRAND]).toBe(true);
    await expect(
      (factory as (o: unknown) => Promise<unknown>)({
        cwd: "/x",
        agentDir: "/y",
        sessionManager: {} as never,
      }),
    ).rejects.toThrowError(/should not be invoked during loading/);
  });
});

describe("loadAgentDefinition — invalid definitions (Req 2.5/2.6)", () => {
  it("null default export → InvalidAgentDefinitionError with agentPath", async () => {
    const path = fixture("invalid-null.ts");
    await expect(loadAgentDefinition(path, ctx, trust)).rejects.toThrowError(
      InvalidAgentDefinitionError,
    );
    await expect(loadAgentDefinition(path, ctx, trust)).rejects.toMatchObject({ agentPath: path });
  });

  it("missing default export → InvalidAgentDefinitionError", async () => {
    await expect(
      loadAgentDefinition(fixture("invalid-no-default.ts"), ctx, trust),
    ).rejects.toBeInstanceOf(InvalidAgentDefinitionError);
  });

  it("primitive default export → InvalidAgentDefinitionError", async () => {
    await expect(
      loadAgentDefinition(fixture("invalid-primitive.ts"), ctx, trust),
    ).rejects.toBeInstanceOf(InvalidAgentDefinitionError);
  });

  it("factory throws → InvalidAgentDefinitionError preserving the original cause", async () => {
    const path = fixture("factory-throws.ts");
    const error = await loadAgentDefinition(path, ctx, trust).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(InvalidAgentDefinitionError);
    expect((error as InvalidAgentDefinitionError).agentPath).toBe(path);
    expect((error as InvalidAgentDefinitionError).message).toContain("boom from factory");
    expect((error as Error & { cause?: Error }).cause).toBeInstanceOf(Error);
  });

  it("factory returns non-definition → InvalidAgentDefinitionError", async () => {
    await expect(
      loadAgentDefinition(fixture("factory-returns-non-definition.ts"), ctx, trust),
    ).rejects.toBeInstanceOf(InvalidAgentDefinitionError);
  });

  it("non-existent module path → InvalidAgentDefinitionError", async () => {
    await expect(
      loadAgentDefinition(fixture("does-not-exist.ts"), ctx, trust),
    ).rejects.toBeInstanceOf(InvalidAgentDefinitionError);
  });
});
