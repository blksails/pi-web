import { defineAgent } from "@blksails/pi-web-agent-kit";
import { defineTool } from "@earendil-works/pi-coding-agent";
import { Type } from "@earendil-works/pi-ai";
import { routes } from "./routes/index.js";
import { inspectWorkbenchForLlm } from "./workbench-state.js";
import { workbenchSurfaceExtension } from "./workbench-extension.js";

const inspectWorkbench = defineTool({
  name: "inspect_workbench",
  label: "Inspect workbench",
  description: "Read the latest authoritative workbench files, canvas references and user change journal.",
  parameters: Type.Object({
    path: Type.Optional(Type.String({ description: "Optional file path for its complete current content." })),
  }),
  async execute(_toolCallId, params) {
    return {
      content: [{ type: "text", text: JSON.stringify(inspectWorkbenchForLlm(params.path), null, 2) }],
      details: undefined,
    };
  },
});

export default defineAgent({
  systemPrompt: [
    "You are workbench-modules-agent.",
    "The user can modify files and canvas content directly in an isolated Workbench without sending a chat message.",
    "Before making claims about Workbench content or recent edits, call inspect_workbench and use its latest revision.",
    "Keep replies concise.",
  ].join("\n"),
  extensions: [workbenchSurfaceExtension],
  customTools: [inspectWorkbench],
  routes,
  noTools: "builtin",
  skills: ({ diagnostics }) => ({ skills: [], diagnostics }),
});
