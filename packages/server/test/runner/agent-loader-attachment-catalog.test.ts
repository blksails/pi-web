/**
 * agent-loader attachmentCatalog shape normalization (agent-attachment-catalog spec,
 * task 1.2 — Req 1.1, 1.2).
 *
 * Loader-level scope is **shape only** (list/resolve must be functions); the
 * catalog bridge behavior (zero-frame/list/materialize dispatch) is runner's
 * job (task 2.1+), not covered here.
 */
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { AgentContext } from "../../src/runner/agent-definition.js";
import {
  InvalidAgentDefinitionError,
  loadAgentDefinition,
  type NormalizedAgentRuntimeFactory,
} from "../../src/runner/agent-loader.js";
import { makeResolveProjectTrust } from "../../src/runner/project-trust.js";

const fixturesDir = join(dirname(fileURLToPath(import.meta.url)), "fixtures");
const fixture = (name: string): string => join(fixturesDir, name);

const ctx: AgentContext = {
  cwd: "/tmp/work",
  agentDir: "/tmp/agent",
  env: {},
  settings: {},
};
const trust = makeResolveProjectTrust(false);

async function loadWithCatalog(catalog: unknown): Promise<NormalizedAgentRuntimeFactory> {
  (globalThis as { __attachmentCatalogFixture?: unknown }).__attachmentCatalogFixture = catalog;
  return loadAgentDefinition(fixture("attachment-catalog-from-global.ts"), ctx, trust);
}

afterEach(() => {
  delete (globalThis as { __attachmentCatalogFixture?: unknown }).__attachmentCatalogFixture;
});

const list = (): [] => [];
const resolve = (): never => {
  throw new Error("not reached");
};

describe("loadAgentDefinition — attachmentCatalog shape normalization (Req 1.1/1.2)", () => {
  it("valid { list, resolve } → attached to factory verbatim (handlers preserved)", async () => {
    const factory = await loadWithCatalog({ list, resolve });
    expect(factory.attachmentCatalog?.list).toBe(list);
    expect(factory.attachmentCatalog?.resolve).toBe(resolve);
  });

  it("not declared (undefined) → factory has no attachmentCatalog field at all", async () => {
    const factory = await loadWithCatalog(undefined);
    expect("attachmentCatalog" in factory).toBe(false);
  });
});

describe("loadAgentDefinition — invalid attachmentCatalog fails assembly (Req 1.2)", () => {
  it("missing resolve handler → InvalidAgentDefinitionError", async () => {
    const error = await loadWithCatalog({ list }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(InvalidAgentDefinitionError);
    expect((error as Error).message).toContain("resolve");
  });

  it("missing list handler → InvalidAgentDefinitionError", async () => {
    const error = await loadWithCatalog({ resolve }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(InvalidAgentDefinitionError);
    expect((error as Error).message).toContain("list");
  });

  it("non-function list → InvalidAgentDefinitionError", async () => {
    await expect(
      loadWithCatalog({ list: "not-a-function", resolve }),
    ).rejects.toBeInstanceOf(InvalidAgentDefinitionError);
  });

  it("non-function resolve → InvalidAgentDefinitionError", async () => {
    await expect(
      loadWithCatalog({ list, resolve: 42 }),
    ).rejects.toBeInstanceOf(InvalidAgentDefinitionError);
  });

  it("non-object declaration (string) → InvalidAgentDefinitionError", async () => {
    await expect(loadWithCatalog("nope")).rejects.toBeInstanceOf(
      InvalidAgentDefinitionError,
    );
  });

  it("null declaration → InvalidAgentDefinitionError", async () => {
    await expect(loadWithCatalog(null)).rejects.toBeInstanceOf(
      InvalidAgentDefinitionError,
    );
  });
});
