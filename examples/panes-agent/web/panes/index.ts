import { paneDocuments } from "../pane-documents.generated.js";
import { definePanes } from "@blksails/pi-web-panes-kit";
import {
  artifactPaneMeta,
  canvasPaneMeta,
  diffPaneMeta,
  editorPaneMeta,
  filesPaneMeta,
} from "../../pane-meta.js";

const inline = (srcDoc: string) => ({ kind: "inline", srcDoc }) as const;

export const panesDefinition = definePanes({
  id: "panes-example",
  initialPaneIds: ["editor", "files", "canvas"],
  maxOpenPanes: 12,
  panes: [
    { ...filesPaneMeta, document: inline(paneDocuments.files), lifecycle: {} },
    { ...editorPaneMeta, document: inline(paneDocuments.editor), lifecycle: {} },
    { ...diffPaneMeta, document: inline(paneDocuments.diff), lifecycle: {} },
    { ...canvasPaneMeta, document: inline(paneDocuments.canvas), lifecycle: {} },
    { ...artifactPaneMeta, document: inline(paneDocuments.artifact), lifecycle: {} },
  ],
});
