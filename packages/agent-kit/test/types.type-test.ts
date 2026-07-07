/**
 * Compile-time type tests (Req 1.4). These are validated by `tsc --noEmit`
 * (the package `typecheck` script): each `@ts-expect-error` asserts that an
 * invalid definition is rejected by the type checker. If any line below stops
 * being an error, tsc fails because the `@ts-expect-error` becomes unused.
 *
 * Included in test/ so it is type-checked, but contains only type-level
 * assertions and no runtime test cases.
 */
import { defineAgent } from "../src/index.js";
import type {
  AgentDefinition,
  AgentRouteDecl,
  AgentRouteHandler,
  AgentRouteRequest,
} from "../src/index.js";

// Valid baseline: compiles cleanly.
export const ok: AgentDefinition = defineAgent({
  systemPrompt: "hi",
  thinkingLevel: "medium",
});

// Unknown field is rejected.
defineAgent({
  // @ts-expect-error — `notAField` is not part of AgentDefinition.
  notAField: true,
});

// Wrong type for a known field is rejected.
defineAgent({
  // @ts-expect-error — `tools` must be string[], not string.
  tools: "read",
});

// Invalid thinking level literal is rejected.
defineAgent({
  // @ts-expect-error — "turbo" is not a valid ThinkingLevel.
  thinkingLevel: "turbo",
});

// `noTools` only accepts the documented union members.
defineAgent({
  // @ts-expect-error — "some" is not "all" | "builtin".
  noTools: "some",
});

// `allowExtensions` accepts a string[] (the allowlist) ...
export const withAllow: AgentDefinition = defineAgent({
  allowExtensions: ["foo", "bar"],
});

// ... an empty array (close all) ...
export const withAllowEmpty: AgentDefinition = defineAgent({
  allowExtensions: [],
});

// ... and is optional (may be omitted entirely).
export const withoutAllow: AgentDefinition = defineAgent({});

// Wrong type for `allowExtensions` is rejected.
defineAgent({
  // @ts-expect-error — `allowExtensions` must be string[], not string.
  allowExtensions: "foo",
});

// --- agent-declared routes (Req 1.1) ---

// A definition with routes compiles: handler may be sync or async, methods
// optional (defaults to ["GET"]), description optional.
export const withRoutes: AgentDefinition = defineAgent({
  routes: [
    {
      name: "gallery-items",
      handler: (req) => ({ items: [], query: req.query }),
    },
    {
      name: "canvas-ops",
      methods: ["GET", "POST"],
      description: "Read or mutate canvas state.",
      handler: async (req) => ({ ok: true, body: req.body ?? null }),
    },
  ],
});

// A definition without routes is untouched by the feature.
export const withoutRoutes: AgentDefinition = defineAgent({});

// Standalone decl/handler/request types are usable directly.
export const decl: AgentRouteDecl = {
  name: "ping",
  handler: () => "pong",
};
export const handler: AgentRouteHandler = (req: AgentRouteRequest) =>
  req.method === "GET" ? req.name : Promise.resolve(req.query);

// A method outside the GET/POST whitelist is rejected.
defineAgent({
  routes: [
    {
      name: "bad-method",
      // @ts-expect-error — "DELETE" is not in the "GET" | "POST" union.
      methods: ["DELETE"],
      handler: () => null,
    },
  ],
});

// A route without a handler is rejected.
defineAgent({
  routes: [
    // @ts-expect-error — `handler` is required on AgentRouteDecl.
    { name: "no-handler" },
  ],
});

// Wrong type for `routes` is rejected.
defineAgent({
  // @ts-expect-error — `routes` must be AgentRouteDecl[], not a single decl.
  routes: { name: "not-an-array", handler: () => null },
});

// AgentRouteRequest.method is a closed union.
export function methodIsUnion(req: AgentRouteRequest): "GET" | "POST" {
  return req.method;
}
