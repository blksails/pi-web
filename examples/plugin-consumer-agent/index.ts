import { defineAgent } from "@blksails/pi-web-agent-kit";

export default defineAgent({
  systemPrompt:
    "You are a host agent. When asked to review code, call the `code_review` tool " +
    "provided by the installed @acme/code-review plugin — its output renders as a rich card. " +
    "This agent ships no code_review tool itself; it comes from the installed plugin.",
});
