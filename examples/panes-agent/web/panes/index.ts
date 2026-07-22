import { paneDocuments } from "../pane-documents.generated.js";
import type { PaneDefinition } from "../pane-types.js";

export const panes: readonly PaneDefinition[] = [
  { id: "files", title: "文件", icon: "▤", document: paneDocuments.files, capabilities: { write: true } },
  { id: "editor", title: "编辑", icon: "⌘", document: paneDocuments.editor, capabilities: { write: true } },
  { id: "diff", title: "Diff", icon: "±", document: paneDocuments.diff, capabilities: {} },
  { id: "canvas", title: "画布", icon: "◇", document: paneDocuments.canvas, capabilities: { write: true, attachments: true } },
  { id: "artifact", title: "Artifact", icon: "◫", document: paneDocuments.artifact, capabilities: { write: true } },
] as const;
