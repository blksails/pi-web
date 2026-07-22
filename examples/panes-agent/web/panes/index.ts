import { paneDocuments } from "../pane-documents.generated.js";
import { definePanes } from "@blksails/pi-web-panes-kit";

const panesSurface = { surfaceKeys: ["surface:panes"], surfaceCommands: [], attachments: "none", conversation: "none" } as const;

export const panesDefinition = definePanes({
  id: "panes-example",
  initialPaneIds: ["editor", "files", "canvas"],
  maxOpenPanes: 12,
  panes: [
    { id: "files", title: "文件", icon: "▤", document: { kind: "inline", srcDoc: paneDocuments.files }, allowMultiple: true, maxInstances: 3, lifecycle: {}, capabilities: { ...panesSurface, routes: [{ name: "pane-data", methods: ["GET", "POST"] }] } },
    { id: "editor", title: "编辑", icon: "⌘", document: { kind: "inline", srcDoc: paneDocuments.editor }, allowMultiple: true, maxInstances: 4, lifecycle: {}, capabilities: { ...panesSurface, routes: [{ name: "pane-data", methods: ["GET", "POST"] }] } },
    { id: "diff", title: "Diff", icon: "±", document: { kind: "inline", srcDoc: paneDocuments.diff }, allowMultiple: true, maxInstances: 3, lifecycle: {}, capabilities: { ...panesSurface, routes: [{ name: "pane-data", methods: ["GET"] }] } },
    {
      id: "canvas",
      title: "Canvas",
      icon: "◇",
      document: { kind: "inline", srcDoc: paneDocuments.canvas },
      allowMultiple: true,
      maxInstances: 3,
      lifecycle: {},
      capabilities: {
        routes: [],
        surfaceKeys: ["surface:canvas"],
        surfaceCommands: [{ domain: "canvas", actions: ["sync", "register", "edit", "inpaint", "reference", "variants", "outpaint", "reframe", "delete"] }],
        attachments: "read-write",
        conversation: "submit",
      },
    },
    { id: "artifact", title: "Artifact", icon: "◫", document: { kind: "inline", srcDoc: paneDocuments.artifact }, allowMultiple: true, maxInstances: 3, lifecycle: {}, capabilities: { ...panesSurface, routes: [{ name: "pane-data", methods: ["GET", "POST"] }] } },
  ],
});
