import { canvasModule } from "./canvas.js";
import { diffModule } from "./diff.js";
import { editorModule } from "./editor.js";
import { filesModule } from "./files.js";

export const modules = [filesModule, editorModule, diffModule, canvasModule] as const;
