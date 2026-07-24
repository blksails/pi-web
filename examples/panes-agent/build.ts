import { build } from "esbuild";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildWebExtension, type BuildResult } from "@blksails/pi-web-kit/build";
import postcss from "postcss";
import tailwindcss from "tailwindcss";
import type { Config } from "tailwindcss";
import { piWebPreset } from "../../packages/ui/tailwind-preset.js";

const ROOT = dirname(fileURLToPath(import.meta.url));
const PANE_IDS = ["files", "editor", "diff", "canvas", "artifact"] as const;

const PANE_CSS = String.raw`
:root{font:13px/1.5 Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#172033;background:#f8fafc;color-scheme:light}
*{box-sizing:border-box}html,body,#root{height:100%;margin:0}button,input,select,textarea{font:inherit;color:inherit}button:focus-visible,input:focus-visible,select:focus-visible,textarea:focus-visible{outline:2px solid #2563eb;outline-offset:2px}
.pane-layout{height:100%;min-height:0;display:flex;flex-direction:column;background:#f8fafc}.toolbar{min-height:50px;display:flex;align-items:center;gap:8px;padding:8px 12px;border-bottom:1px solid #e2e8f0;background:#fff}.grow{flex:1;min-width:0}.content{padding:12px}.scroll{overflow:auto}.center{height:100%;display:grid;place-items:center}.muted,.notice{color:#64748b}.ok{color:#047857}.error{color:#b91c1c}.notice{min-height:34px;margin:0;padding:7px 12px;border-top:1px solid #e2e8f0;background:#fff}.empty{min-height:180px;display:grid;place-items:center;text-align:center;color:#64748b;border:1px dashed #cbd5e1;border-radius:12px;background:#fff}
input,select,textarea{border:1px solid #cbd5e1;border-radius:8px;background:#fff;padding:8px 10px}.button{display:inline-flex;align-items:center;justify-content:center;border:1px solid #cbd5e1;border-radius:8px;background:#fff;padding:7px 10px;cursor:pointer;white-space:nowrap}.button:hover{background:#f1f5f9}.button:disabled{opacity:.45;cursor:not-allowed}.button-primary{border-color:#2563eb;background:#2563eb;color:#fff}.button-primary:hover{background:#1d4ed8}.button-danger{color:#b91c1c}.button-danger:hover{background:#fef2f2}.badge,.status{display:inline-flex;border-radius:999px;padding:2px 7px;font-size:11px;background:#eef2ff;color:#4338ca}.warning{background:#fff7ed;color:#c2410c}
.list{display:flex;flex-direction:column;gap:6px}.list-row{display:flex;align-items:center;gap:10px;padding:10px 12px;border:1px solid #e2e8f0;border-radius:10px;background:#fff}.file-icon{color:#2563eb}
.dialog-backdrop{position:fixed;inset:0;z-index:20;display:grid;place-items:center;padding:16px;background:rgb(15 23 42/.32)}.dialog{width:min(440px,100%);border:1px solid #e2e8f0;border-radius:14px;background:#fff;box-shadow:0 24px 70px rgb(15 23 42/.24);overflow:hidden}.dialog-header,.dialog-actions{display:flex;align-items:center;gap:8px;padding:10px 14px}.dialog-header{justify-content:space-between;border-bottom:1px solid #e2e8f0}.dialog-actions{justify-content:flex-end;border-top:1px solid #e2e8f0}.dialog-body{display:flex;flex-direction:column;gap:12px;padding:16px}.field{display:flex;flex-direction:column;gap:5px}.field span{font-size:12px;color:#475569}
.editor-shell{flex:1;min-height:0;display:grid;grid-template-columns:4px 46px 1fr;background:#f0fdf4;color:#172033}.change-bar{background:#16a34a}.line-numbers{overflow:hidden;padding:14px 10px;text-align:right;color:#15803d;background:#f0fdf4;font:12px/1.65 ui-monospace,SFMono-Regular,Consolas,monospace}.editor{width:100%;height:100%;resize:none;border:0;border-radius:0;padding:14px;background:#f0fdf4;color:#172033;font:12px/1.65 ui-monospace,SFMono-Regular,Consolas,monospace}.segmented{display:flex}.segmented .button{border-radius:0}.segmented .button:first-child{border-radius:8px 0 0 8px}.segmented .button:last-child{border-radius:0 8px 8px 0}.segmented .button[aria-pressed=true]{background:#e0e7ff;color:#3730a3}
.ide-tabs{height:42px;display:flex;align-items:end;gap:4px;padding:5px 10px 0;border-bottom:1px solid #e2e8f0;background:#f8fafc}.ide-tab{height:34px;display:flex;align-items:center;gap:8px;border:0;border-radius:10px 10px 0 0;padding:0 11px;background:#eef2f7;color:#475569;cursor:pointer}.ide-tab.active{background:#fff;color:#172033}.ide-tab i{font-style:normal;color:#ea580c}.ide-tab.add{font-size:20px}.ide-toolbar{height:48px;display:flex;align-items:center;gap:8px;padding:7px 12px;border-bottom:1px solid #e2e8f0;background:#fff}.menu-anchor{position:relative}.ide-menu{position:absolute;z-index:12;top:38px;left:0;width:260px;padding:6px;border:1px solid #e2e8f0;border-radius:12px;background:#fff;box-shadow:0 18px 45px rgb(15 23 42/.18)}.ide-menu button{width:100%;display:flex;justify-content:space-between;border:0;border-radius:8px;padding:8px 10px;background:transparent;text-align:left;cursor:pointer}.ide-menu button:hover{background:#f1f5f9}.ide-menu kbd{color:#94a3b8}.revision{color:#334155}.delta{color:#059669}.delta.minus{color:#dc2626}.breadcrumb{height:34px;display:flex;align-items:center;gap:8px;padding:0 12px;border-bottom:1px solid #e2e8f0;background:#fff;color:#64748b}.ide-body{flex:1;min-height:0;display:flex}.ide-main{flex:1;min-width:0;display:flex}.split-handle{width:5px;cursor:col-resize;background:#e2e8f0}.split-handle:hover{background:#60a5fa}.file-tree{min-width:170px;max-width:420px;display:flex;flex-direction:column;padding:10px;background:#fff}.tree-filter{width:100%;margin-bottom:10px}.tree{overflow:auto;color:#475569}.tree-indent{padding-left:14px}.tree button{width:100%;display:flex;align-items:center;gap:7px;border:0;border-radius:6px;padding:5px 7px;background:transparent;text-align:left;cursor:pointer}.tree button[aria-current=true]{background:#eff6ff;color:#1d4ed8}.tree button i{margin-left:auto;color:#ea580c}.ide .notice{min-height:30px;padding-block:5px}
.diff-grid{height:100%;display:grid;grid-template-columns:1fr 1fr;gap:1px;background:#cbd5e1;border:1px solid #cbd5e1;border-radius:10px;overflow:hidden}.diff{margin:0;padding:14px;overflow:auto;background:#fff;font:12px/1.6 ui-monospace,SFMono-Regular,Consolas,monospace}.before{background:#fff7f7}.after{background:#f3fff8}.removed{display:block;background:#fee2e2;color:#991b1b}.added{display:block;background:#dcfce7;color:#166534}
.swatches{display:flex;gap:5px}.swatch{width:24px;height:24px;border:2px solid #fff;border-radius:50%;box-shadow:0 0 0 1px #cbd5e1;cursor:pointer}.swatch[aria-pressed=true]{box-shadow:0 0 0 2px #0f172a}.canvas-wrap{flex:1;min-height:0;display:grid;place-items:center;padding:12px;background-image:radial-gradient(#cbd5e1 1px,transparent 1px);background-size:18px 18px}.stage{width:100%;height:100%;max-height:560px;border:1px solid #cbd5e1;border-radius:12px;background:#fff;box-shadow:0 8px 28px rgb(15 23 42/.08);cursor:crosshair}
.artifact-grid{flex:1;min-height:0;display:grid;grid-template-columns:minmax(150px,34%) 1fr}.artifact-list{display:flex;flex-direction:column;gap:6px;padding:10px;border-right:1px solid #e2e8f0;background:#f1f5f9}.artifact-nav{display:flex;flex-direction:column;align-items:flex-start;gap:6px;border:1px solid transparent;border-radius:9px;padding:10px;text-align:left;background:transparent;cursor:pointer}.artifact-nav[aria-current=true]{border-color:#c7d2fe;background:#fff}.artifact-preview{min-width:0;display:flex;flex-direction:column;padding:16px;overflow:auto}.artifact-paper{flex:1;border:1px solid #e2e8f0;border-radius:12px;padding:24px;background:#fff;box-shadow:0 8px 26px rgb(15 23 42/.06)}.artifact-paper h1{margin:12px 0;font-size:22px}.artifact-paper p{white-space:pre-wrap;color:#475569}.artifact-paper small{color:#94a3b8}.artifact-actions{display:flex;justify-content:flex-end;gap:8px;padding-top:12px}.status-draft{background:#f1f5f9;color:#475569}.status-review{background:#fff7ed;color:#c2410c}.status-published{background:#ecfdf5;color:#047857}
.spinner{width:22px;height:22px;border:2px solid #cbd5e1;border-top-color:#2563eb;border-radius:50%;animation:spin .8s linear infinite}@keyframes spin{to{transform:rotate(360deg)}}
@media(prefers-color-scheme:dark){:root{color:#e2e8f0;background:#0f172a;color-scheme:dark}.pane-layout,.canvas-wrap,.ide-tabs{background:#0f172a}.toolbar,.notice,.dialog,.list-row,.diff,.artifact-paper,.artifact-nav[aria-current=true],input,select,textarea,.button,.ide-tab.active,.ide-toolbar,.breadcrumb,.ide-menu,.file-tree{background:#111827;border-color:#334155}.content,.artifact-list{background:#0f172a}.empty{background:#111827;border-color:#334155}.muted,.notice,.field span{color:#94a3b8}.button:hover,.ide-menu button:hover{background:#1e293b}.artifact-list{border-color:#334155}.artifact-paper p{color:#cbd5e1}.stage{background:#111827;border-color:#334155}.editor-shell,.line-numbers,.editor{background:#052e16;color:#dcfce7}.ide-tab{background:#1e293b;color:#94a3b8}.split-handle{background:#334155}.tree{color:#cbd5e1}}
`;

function htmlDocument(title: string, script: string, extraCss = ""): string {
  const safeScript = script.replace(/<\/script/gi, "<\\/script");
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src blob: data: http: https:; style-src 'unsafe-inline'; script-src 'unsafe-inline'"><title>${title}</title><style>${PANE_CSS}\n${extraCss}</style></head><body><div id="root"></div><script>${safeScript}</script></body></html>`;
}

async function buildCanvasCss(): Promise<string> {
  const config: Config = {
    presets: [piWebPreset as Config],
    content: [
      resolve(ROOT, "web", "panes", "canvas.tsx"),
      resolve(ROOT, "..", "..", "packages", "canvas-ui", "src", "**", "*.{ts,tsx}"),
      resolve(ROOT, "..", "..", "packages", "canvas-kit", "src", "**", "*.{ts,tsx}"),
      resolve(ROOT, "..", "..", "packages", "primitives", "src", "**", "*.{ts,tsx}"),
    ],
  };
  const generated = await postcss([tailwindcss(config)]).process(
    "@tailwind base; @tailwind components; @tailwind utilities;",
    { from: undefined },
  );
  const [uiStyles, canvasStyles] = await Promise.all([
    readFile(resolve(ROOT, "..", "..", "packages", "ui", "src", "styles.css"), "utf8"),
    readFile(resolve(ROOT, "..", "..", "packages", "canvas-ui", "src", "styles.css"), "utf8"),
  ]);
  return `${uiStyles}\n${canvasStyles}\n${generated.css}`;
}

async function buildPaneDocuments(): Promise<string> {
  const documents: Record<string, string> = {};
  const canvasCss = await buildCanvasCss();
  for (const id of PANE_IDS) {
    const result = await build({
      entryPoints: [resolve(ROOT, "web", "panes", `${id}.tsx`)],
      bundle: true,
      write: false,
      format: "iife",
      platform: "browser",
      target: "es2022",
      jsx: "automatic",
      minify: true,
      legalComments: "none",
      define: { "process.env.NODE_ENV": '"production"' },
    });
    const output = result.outputFiles?.[0];
    if (output === undefined) throw new Error(`Pane ${id} 未生成 bundle`);
    documents[id] = htmlDocument(id, output.text, id === "canvas" ? canvasCss : "");
  }
  const target = resolve(ROOT, "web", "pane-documents.generated.ts");
  await writeFile(target, `// Generated by examples/panes-agent/build.ts; do not edit.\nexport const paneDocuments = ${JSON.stringify(documents)} as const;\n`, "utf8");
  return target;
}

export async function buildPanesAgent(): Promise<BuildResult> {
  const generated = await buildPaneDocuments();
  try {
    const outDir = resolve(ROOT, ".pi", "web", "dist");
    await mkdir(outDir, { recursive: true });
    return await buildWebExtension({
      id: "panes",
      targetApiVersion: "^0.5.0",
      entryDir: resolve(ROOT, "web"),
      outDir,
      capabilities: ["slots", "config"],
    });
  } finally {
    await rm(generated, { force: true });
  }
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  void buildPanesAgent().then((result) => console.log(`[built] panes → ${result.entryOut}`));
}
