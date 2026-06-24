/**
 * minimal-agent — the most thoroughly stripped-down baseline agent.
 *
 * This goes further than `examples/hello-agent`:
 *  - hello-agent uses `noTools: "builtin"` (disables ONLY the built-in toolset,
 *    while keeping custom + `.pi/extensions/*` tools) plus an empty `skills`
 *    override.
 *  - minimal-agent uses the `defineMinimalAgent` preset to close everything at
 *    once: `noTools: "all"` (no built-in OR extension tools), an empty `skills`
 *    override (drops every disk-discovered skill), and `allowExtensions: []`
 *    (disables all disk-discovered system extensions). The result is a true
 *    zero-capability baseline.
 *
 * NOTE: `model` is intentionally OMITTED so the agent inherits the default
 * provider/model from your pi config (`~/.pi/agent/settings.json`) and resolves
 * credentials from `~/.pi/agent/auth.json` — identical to hello-agent. This
 * makes the example work out of the box for any pi login.
 *
 * The default export is a plain {@link AgentDefinition} (produced by the preset).
 * It is loaded by the bootstrap runner via jiti and mapped into a pi session
 * runtime.
 */
import { defineMinimalAgent } from "@blksails/pi-web-agent-kit";

export default defineMinimalAgent({
  // model omitted → inherits ~/.pi/agent/settings.json defaultProvider/defaultModel.
  systemPrompt: "You are minimal-agent, a zero-capability pi-web baseline example.",
  // Everything else (noTools: "all", empty skills override, allowExtensions: [])
  // comes from the minimal preset — nothing further to declare.
});
