/**
 * hello-agent — a minimal custom agent used as the integration / e2e target.
 *
 * Demonstrates the core authoring pieces:
 *  - a tiny custom tool (`echo`), and
 *  - a system prompt.
 *
 * NOTE: `model` is intentionally OMITTED so the agent inherits the default
 * provider/model from your pi config (`~/.pi/agent/settings.json`) and resolves
 * credentials from `~/.pi/agent/auth.json`. This makes the example work out of
 * the box for any pi login (e.g. anthropic, openrouter, openai). To pin a model,
 * add `model: { provider: "...", modelId: "..." }` — but then that provider must
 * have valid auth, or the LLM call will fail.
 *
 * The default export is a plain {@link AgentDefinition} (shape a). It is loaded
 * by the bootstrap runner via jiti and mapped into a pi session runtime.
 */
import { defineAgent } from "@blksails/pi-web-agent-kit";
import { defineTool } from "@earendil-works/pi-coding-agent";
import { Type } from "@earendil-works/pi-ai";

const echo = defineTool({
  name: "echo",
  label: "Echo",
  description: "Echo the provided text back to the caller.",
  parameters: Type.Object({
    text: Type.String({ description: "Text to echo back." }),
  }),
  async execute(_toolCallId, params) {
    return {
      content: [{ type: "text", text: params.text }],
      details: undefined,
    };
  },
});

export default defineAgent({
  // model omitted → inherits ~/.pi/agent/settings.json defaultProvider/defaultModel.
  systemPrompt: "You are hello-agent, a minimal pi-web example agent.",
  customTools: [echo],
  // Self-contained: do NOT pull in the system's built-in tools or disk-discovered
  // skills (e.g. ~/.pi, ~/.claude/skills). The agent runs with ONLY what this file
  // declares.
  //
  // `noTools: "builtin"` disables the default built-in toolset while keeping
  // custom (`echo`) and extension tools (`.pi/extensions/*`).
  noTools: "builtin",
  // `skills` is an override hook receiving the resolved (disk-discovered) skill
  // set; returning an empty list drops every system skill. Diagnostics are
  // preserved so resolution warnings still surface.
  skills: ({ diagnostics }) => ({ skills: [], diagnostics }),
});
