import { defineAgent } from "@blksails/pi-web-agent-kit";
import { defineTool } from "@earendil-works/pi-coding-agent";
import { Type } from "@earendil-works/pi-ai";
import { routes } from "./routes/index.js";
import { inspectPanesForLlm } from "./panes-state.js";
import { panesSurfaceExtension } from "./panes-extension.js";

const inspectPanes = defineTool({
  name: "inspect_panes",
  label: "Inspect panes",
  description: "Read the latest authoritative files, canvas, artifacts and user change journal shared by all panes.",
  parameters: Type.Object({
    path: Type.Optional(Type.String({ description: "Optional file path for its complete current content." })),
  }),
  async execute(_toolCallId, params) {
    return {
      content: [{ type: "text", text: JSON.stringify(inspectPanesForLlm(params.path), null, 2) }],
      details: undefined,
    };
  },
});

export default defineAgent({
  systemPrompt: [
    "You are panes-agent.",
    "The user can modify files, canvas content and artifacts inside isolated panes without sending a chat message.",
    "Before making claims about pane content or recent edits, call inspect_panes and use its latest revision.",
    "Keep replies concise.",
  ].join("\n"),
  extensions: [panesSurfaceExtension],
  customTools: [inspectPanes],
  routes,
  noTools: "builtin",
  skills: ({ diagnostics }) => ({ skills: [], diagnostics }),
});
