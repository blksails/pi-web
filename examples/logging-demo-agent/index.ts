/**
 * logging-demo-agent — demonstrates the pi-web logging system end-to-end.
 *
 * Shape-b factory: default export is a function `(ctx: AgentContext) => AgentDefinition`,
 * which receives the runner-injected context including `ctx.logger` (Req 2.1).
 *
 * On factory invocation the agent logs at all four levels so any startup log
 * channel watcher can observe them without waiting for an LLM turn.
 *
 * Requirements: 2.1, 2.2, 5.2
 */
import type { AgentContext, AgentDefinition, SkillsOverride } from "@pi-web/agent-kit";
import { defineAgent } from "@pi-web/agent-kit";

export default function (ctx: AgentContext): AgentDefinition {
  const logger = ctx.logger;

  // Emit startup logs at all levels so they appear in the log panel immediately
  // after the agent source is selected and the session begins (Req 2.1/2.2).
  if (logger !== undefined) {
    logger.debug("factory invoked", { cwd: ctx.cwd });
    logger.info("started", { env: Object.keys(ctx.env).length });
    logger.warn("this is a sample warn");
    logger.error("this is a sample error (not a real error)");

    const childLogger = logger.child("tool");
    childLogger.info("child logger created with namespace :tool");
  }

  return defineAgent({
    // model omitted → inherits ~/.pi/agent/settings.json defaults.
    systemPrompt: [
      "You are logging-demo-agent, a pi-web example agent that demonstrates the logging system.",
      "When asked, describe what logging namespaces are active and what levels are configured.",
      "You can also ask the user to check the logs panel to see the debug/info/warn/error entries",
      "emitted during startup.",
    ].join(" "),
    noTools: "builtin",
    skills: ((...args: Parameters<SkillsOverride>) => ({ skills: [], diagnostics: args[0]?.diagnostics })) as SkillsOverride,
  });
}
