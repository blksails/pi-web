/**
 * agent-loader routes normalization & authoritative validation
 * (spec agent-declared-routes, task 2.1 — Req 1.1/1.2/1.3).
 *
 * Behavioural coverage tiers:
 *  - valid declaration → normalized `routes` on the factory (handler by ref,
 *    pure-data projection matching the protocol `AgentRouteDeclDto`);
 *  - invalid name format / duplicate name / disallowed method → assembly
 *    error carrying the route name and the failure reason;
 *  - omitted `methods` → defaulted to ["GET"];
 *  - no declaration → normalization result identical to the status quo
 *    (no `routes` field attached at all).
 */
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { AgentRouteDeclDtoSchema } from "@blksails/pi-web-protocol";
import type {
  AgentContext,
  AgentRouteRequest,
} from "../../src/runner/agent-definition.js";
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
};
const trust = makeResolveProjectTrust(false);

/** Load the globalThis-driven shape-(b) fixture with an injected `routes` value. */
async function loadWithRoutes(routes: unknown): Promise<NormalizedAgentRuntimeFactory> {
  (globalThis as { __routesFixture?: unknown }).__routesFixture = routes;
  return loadAgentDefinition(fixture("routes-from-global.ts"), ctx, trust);
}

afterEach(() => {
  delete (globalThis as { __routesFixture?: unknown }).__routesFixture;
});

describe("loadAgentDefinition — routes normalization (Req 1.1/1.2)", () => {
  it("valid declaration (shape a): normalized routes attached, handler kept by reference", async () => {
    const factory = await loadAgentDefinition(fixture("routes-shape-a.ts"), ctx, trust);
    expect(factory.routes).toBeDefined();
    expect(factory.routes).toHaveLength(2);

    const [stats, snapshot] = factory.routes!;
    expect(stats).toMatchObject({
      name: "gallery-stats",
      methods: ["GET", "POST"],
      description: "Gallery statistics",
    });
    expect(typeof stats!.handler).toBe("function");
    // Handler survives normalization by reference (runs in-subprocess later).
    expect(
      stats!.handler({ name: "gallery-stats", method: "GET", query: {} }),
    ).toEqual({ images: 3 });

    // Omitted `methods` defaults to ["GET"] (Req 1.1 / design default).
    expect(snapshot).toMatchObject({ name: "canvas-snapshot", methods: ["GET"] });
    expect(snapshot!.description).toBeUndefined();
  });

  it("pure-data projection of a normalized route parses as protocol AgentRouteDeclDto", async () => {
    const factory = await loadAgentDefinition(fixture("routes-shape-a.ts"), ctx, trust);
    for (const route of factory.routes!) {
      const projection: Record<string, unknown> = {
        name: route.name,
        methods: [...route.methods],
      };
      if (route.description !== undefined) projection["description"] = route.description;
      expect(() => AgentRouteDeclDtoSchema.parse(projection)).not.toThrow();
    }
  });

  it("valid declaration (shape b): normalized routes attached", async () => {
    const factory = await loadWithRoutes([
      { name: "ping", methods: ["POST"], handler: () => "pong" },
    ]);
    expect(factory.routes).toHaveLength(1);
    expect(factory.routes![0]).toMatchObject({ name: "ping", methods: ["POST"] });
  });

  it("omitted methods default to [\"GET\"] (shape b)", async () => {
    const factory = await loadWithRoutes([{ name: "ping", handler: () => "pong" }]);
    expect(factory.routes![0]!.methods).toEqual(["GET"]);
  });
});

describe("loadAgentDefinition — invalid routes fail assembly (Req 1.2/1.3)", () => {
  it("bad name format (uppercase/underscore) → error carrying the name and reason", async () => {
    const error = await loadWithRoutes([
      { name: "Bad_Name", handler: () => null },
    ]).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(InvalidAgentDefinitionError);
    expect((error as Error).message).toContain("Bad_Name");
    expect((error as Error).message).toContain("^[a-z0-9][a-z0-9-]*$");
  });

  it("bad name format (leading hyphen) → error carrying the name", async () => {
    await expect(loadWithRoutes([{ name: "-lead", handler: () => null }])).rejects.toThrowError(
      /-lead/,
    );
  });

  it("empty name → InvalidAgentDefinitionError", async () => {
    await expect(loadWithRoutes([{ name: "", handler: () => null }])).rejects.toBeInstanceOf(
      InvalidAgentDefinitionError,
    );
  });

  it("duplicate name within one definition → error carrying the name and reason", async () => {
    const error = await loadWithRoutes([
      { name: "dup-route", handler: () => 1 },
      { name: "dup-route", methods: ["POST"], handler: () => 2 },
    ]).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(InvalidAgentDefinitionError);
    expect((error as Error).message).toContain("dup-route");
    expect((error as Error).message).toMatch(/duplicate/i);
  });

  it("disallowed method → error carrying the route name and the offending method", async () => {
    const error = await loadWithRoutes([
      { name: "danger", methods: ["GET", "DELETE"], handler: () => null },
    ]).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(InvalidAgentDefinitionError);
    expect((error as Error).message).toContain("danger");
    expect((error as Error).message).toContain("DELETE");
  });

  it("empty methods array → error (route would be unreachable, not silently ignored)", async () => {
    const error = await loadWithRoutes([
      { name: "unreachable", methods: [], handler: () => null },
    ]).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(InvalidAgentDefinitionError);
    expect((error as Error).message).toContain("unreachable");
  });

  it("non-function handler → error carrying the route name", async () => {
    const error = await loadWithRoutes([{ name: "no-handler" }]).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(InvalidAgentDefinitionError);
    expect((error as Error).message).toContain("no-handler");
    expect((error as Error).message).toContain("handler");
  });

  it("routes not an array → InvalidAgentDefinitionError", async () => {
    await expect(loadWithRoutes("not-an-array")).rejects.toBeInstanceOf(
      InvalidAgentDefinitionError,
    );
  });
});

describe("server mirror AgentRouteRequest stays aligned with agent-kit (Req 3.1)", () => {
  // `packages/server` intentionally does NOT depend on `@blksails/pi-web-agent-kit`
  // (types-only authoring package; the loader duck-types user exports), so the
  // authoritative `AgentRouteRequest` from `packages/agent-kit/src/types.ts`
  // cannot be imported for a direct two-way assignability check. Instead the
  // mirror is pinned with exact literals; both directions are enforced by
  // `tsc -p tsconfig.json --noEmit` (tsconfig includes `test/**/*.ts`):
  //  - a complete authoritative-shape literal (name/method/query/body) must be
  //    assignable to the mirror type;
  //  - an exact literal missing the required `name` must NOT be assignable
  //    (missing-required-property error, consumed by @ts-expect-error — if the
  //    mirror ever drops/optionalizes `name` again, the directive turns into an
  //    "unused @ts-expect-error" compile error and typecheck fails).
  it("requires `name` alongside method/query/body (type-level guard)", () => {
    const complete = {
      name: "gallery-stats",
      method: "GET",
      query: { limit: "10" },
      body: { nested: true },
    } as const satisfies AgentRouteRequest;
    expect(complete.name).toBe("gallery-stats");

    // @ts-expect-error — mirror must require `name` (Req 3.1: route name is
    // part of the request context handed to the handler; agent-kit authority).
    const missingName: AgentRouteRequest = { method: "GET", query: {} };
    void missingName;
  });
});

describe("loadAgentDefinition — no routes declaration is status quo (Req 1.1)", () => {
  it("definition without routes → factory has no `routes` field at all", async () => {
    const factory = await loadAgentDefinition(fixture("shape-a-object.ts"), ctx, trust);
    expect("routes" in factory).toBe(false);
  });

  it("empty routes array → treated as no declaration (no `routes` field attached)", async () => {
    const factory = await loadWithRoutes([]);
    expect("routes" in factory).toBe(false);
  });
});
