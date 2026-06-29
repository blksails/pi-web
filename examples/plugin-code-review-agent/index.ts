import { defineAgent } from "@blksails/pi-web-agent-kit";

export default defineAgent({
  systemPrompt:
    "You are code-review-agent. When asked to review code, call the `code_review` tool " +
    "(provided by this package's pi extension) — its output renders as a rich card via .pi/web. " +
    "Do not answer in prose when a review is requested; let the tool render.",
});
