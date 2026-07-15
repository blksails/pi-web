/**
 * Agent tools wrapping @blksails/pi-web-tool-kit/runtime archive ops.
 * Root = process.cwd()（会话工作目录）。
 */
import path from "node:path";
import { defineTool } from "@earendil-works/pi-coding-agent";
import { Type } from "@earendil-works/pi-ai";
import {
  createZip,
  extractZip,
  extractRar,
} from "@blksails/pi-web-tool-kit/runtime";

function root(): string {
  return process.cwd();
}

function textResult(payload: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(payload, null, 2) }],
    details: payload,
  };
}

export const zipTool = defineTool({
  name: "zip",
  label: "Zip",
  description:
    "Create a .zip archive under the session working directory from one or more paths " +
    "(files or directories). Paths are relative to cwd. Rejects paths outside the workspace.",
  parameters: Type.Object({
    paths: Type.Array(Type.String({ description: "Source path relative to cwd" }), {
      minItems: 1,
      description: "Files/directories to include",
    }),
    output: Type.String({
      description: "Output .zip path relative to cwd (e.g. dist/out.zip)",
    }),
  }),
  async execute(_id, params) {
    const result = await createZip(root(), params.paths, params.output);
    return textResult(result);
  },
});

export const unzipTool = defineTool({
  name: "unzip",
  label: "Unzip",
  description:
    "Extract a .zip archive into a destination directory under the session cwd. " +
    "Rejects zip-slip entries (absolute paths or .. segments).",
  parameters: Type.Object({
    archive: Type.String({ description: "Path to .zip relative to cwd" }),
    destination: Type.Optional(
      Type.String({
        description:
          "Extract directory relative to cwd. Default: basename of archive without .zip",
      }),
    ),
  }),
  async execute(_id, params) {
    const dest =
      params.destination?.trim() ||
      path.basename(params.archive, path.extname(params.archive)) ||
      "unzipped";
    const result = extractZip(root(), params.archive, dest);
    return textResult(result);
  },
});

export const unrarTool = defineTool({
  name: "unrar",
  label: "Unrar",
  description:
    "Extract a .rar archive into a destination under the session cwd. " +
    "Requires a host backend (unrar, unar, or bsdtar). " +
    "If none is installed, returns RAR_BACKEND_UNAVAILABLE without throwing.",
  parameters: Type.Object({
    archive: Type.String({ description: "Path to .rar relative to cwd" }),
    destination: Type.Optional(
      Type.String({
        description:
          "Extract directory relative to cwd. Default: basename of archive without .rar",
      }),
    ),
  }),
  async execute(_id, params) {
    const dest =
      params.destination?.trim() ||
      path.basename(params.archive, path.extname(params.archive)) ||
      "unrarred";
    const result = extractRar(root(), params.archive, dest);
    return textResult(result);
  },
});

export const archiveTools = [zipTool, unzipTool, unrarTool] as const;
