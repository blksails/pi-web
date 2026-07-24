import { defineAgent } from "@blksails/pi-web-agent-kit";
import { defineTool } from "@earendil-works/pi-coding-agent";
import { Type } from "@earendil-works/pi-ai";
import { aigcSlashCompletions } from "@blksails/pi-web-tool-kit";
import { composePaneAgentModules, panesWorkspaceExtension } from "@blksails/pi-web-tool-kit/runtime";
import { inspectPanesForLlm } from "./panes-state.js";
import { paneModules } from "./panes-modules.js";

// pane 自带 tools:每个 pane 的 extensions/routes 由其 PaneAgentModule 声明,一次 compose 即用。
const composed = composePaneAgentModules(paneModules);

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
    "You can drive the workspace tabs: pane_list shows the pane catalog and live instances; pane_open/pane_activate/pane_close/pane_reload operate them.",
    "Keep replies concise.",
  ].join("\n"),
  extensions: [...composed.extensions, panesWorkspaceExtension],
  slashCompletions: aigcSlashCompletions,
  customTools: [inspectPanes],
  routes: composed.routes,
  noTools: "builtin",
  skills: ({ diagnostics }) => ({ skills: [], diagnostics }),
});
