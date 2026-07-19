/**
 * agent-loader attachmentProfile shape normalization (agent-attachment-profile spec,
 * task 1.2 — Req 1.1/1.3).
 *
 * Loader-level scope is **shape only** (non-empty string, backend-name-compatible
 * character format); whitelist validation against the host topology is runner's
 * job (task 3.1), not covered here.
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

async function loadWithProfile(profile: unknown): Promise<NormalizedAgentRuntimeFactory> {
  (globalThis as { __attachmentProfileFixture?: unknown }).__attachmentProfileFixture = profile;
  return loadAgentDefinition(fixture("attachment-profile-from-global.ts"), ctx, trust);
}

afterEach(() => {
  delete (globalThis as { __attachmentProfileFixture?: unknown }).__attachmentProfileFixture;
});

describe("loadAgentDefinition — attachmentProfile shape normalization (Req 1.1)", () => {
  it("valid name → attached to factory verbatim", async () => {
    const factory = await loadWithProfile("s3-cn");
    expect(factory.attachmentProfile).toBe("s3-cn");
  });

  it("valid name with digits/hyphens → attached", async () => {
    const factory = await loadWithProfile("cold-store-2");
    expect(factory.attachmentProfile).toBe("cold-store-2");
  });

  it("not declared (undefined) → factory has no attachmentProfile field at all", async () => {
    const factory = await loadWithProfile(undefined);
    expect("attachmentProfile" in factory).toBe(false);
  });
});

describe("loadAgentDefinition — invalid attachmentProfile fails assembly (Req 1.3)", () => {
  it("empty string → InvalidAgentDefinitionError", async () => {
    await expect(loadWithProfile("")).rejects.toBeInstanceOf(InvalidAgentDefinitionError);
  });

  it("non-string value → InvalidAgentDefinitionError", async () => {
    await expect(loadWithProfile(42)).rejects.toBeInstanceOf(InvalidAgentDefinitionError);
  });

  it("uppercase/underscore chars → error carrying the value and the pattern", async () => {
    const error = await loadWithProfile("Bad_Name").catch((e: unknown) => e);
    expect(error).toBeInstanceOf(InvalidAgentDefinitionError);
    expect((error as Error).message).toContain("Bad_Name");
    expect((error as Error).message).toContain("^[a-z0-9][a-z0-9-]*$");
  });

  it("leading hyphen → InvalidAgentDefinitionError", async () => {
    await expect(loadWithProfile("-lead")).rejects.toBeInstanceOf(InvalidAgentDefinitionError);
  });
});
