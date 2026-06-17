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
import type { AgentDefinition } from "../src/index.js";

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
