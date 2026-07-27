/**
 * 打包 aigc 隔离 pane Guest 文档(inline srcDoc)+ webext 产物 —— 仿 examples/panes-agent/build.ts。
 *
 * 用 esbuild 把 web/panes/<id>.tsx 连 React + Guest SDK 打成单脚本 IIFE,包进自含 HTML
 * (严格 CSP:仅 inline script/style + 图片),写出 web/pane-documents.generated.ts。
 * canvas pane 另经 tailwind(piWebPreset)生成 canvas-ui 所需工具类样式。
 * 随后 buildWebExtension 把 .pi/web 打成 ESM + manifest 入 .pi/web/dist。
 *
 * 运行:node --import jiti/register examples/aigc-agent/build.ts
 * (改 web/panes/*.tsx 后重跑并提交 pane-documents.generated.ts)。
 */
import { build } from "esbuild";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildWebExtension, type BuildResult } from "@blksails/pi-web-kit/build";
import postcss from "postcss";
import tailwindcss from "tailwindcss";
import type { Config } from "tailwindcss";
import { piWebPreset } from "../../packages/ui/tailwind-preset.js";

const ROOT = dirname(fileURLToPath(import.meta.url));
const PANE_IDS = ["search", "materials", "canvas"] as const;
const PANE_TITLES: Record<string, string> = { search: "搜索 Pane", materials: "素材 Pane", canvas: "画布 Pane" };

// aigc pane 基础样式(源自独立仓 scripts/build-panes.mjs:素材卡 .card/.grid/.imgbtn 等)。
const PANE_CSS = String.raw`
:root{font:13px/1.6 ui-sans-serif,system-ui,"PingFang SC","Microsoft YaHei",sans-serif;color:#172033;background:#f8fafc;color-scheme:light}
*{box-sizing:border-box}html,body,#root{height:100%;margin:0}button,input{font:inherit;color:inherit}
button:focus-visible,input:focus-visible{outline:2px solid #2563eb;outline-offset:2px}
.pane-layout{height:100%;min-height:0;display:flex;flex-direction:column}
.toolbar{display:flex;gap:8px;padding:10px 12px;border-bottom:1px solid #e2e8f0;background:#fff}
.grow{flex:1;min-width:0}
input{border:1px solid #cbd5e1;border-radius:8px;background:#fff;padding:8px 10px}
.button{display:inline-flex;align-items:center;border:1px solid #cbd5e1;border-radius:8px;background:#fff;padding:7px 12px;cursor:pointer;white-space:nowrap}
.button:disabled{opacity:.5;cursor:not-allowed}
.button-primary{border-color:#2563eb;background:#2563eb;color:#fff}
.content{padding:12px}.scroll{overflow:auto}
.center{height:100%;display:grid;place-items:center}.muted{color:#64748b}.error{color:#b91c1c}
.empty{min-height:160px;display:grid;place-items:center;color:#64748b;border:1px dashed #cbd5e1;border-radius:12px;background:#fff}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:10px;margin-top:12px}
.card{margin:0;border:1px solid #e2e8f0;border-radius:10px;background:#fff;overflow:hidden}
.card img{display:block;width:100%;aspect-ratio:1;object-fit:cover}
.noimg{display:grid;place-items:center;aspect-ratio:1;color:#94a3b8;background:#f1f5f9}
figcaption{display:flex;align-items:center;gap:6px;padding:6px 8px;font-size:12px}
.badge{border-radius:999px;padding:1px 7px;font-size:11px;background:#eef2ff;color:#4338ca}
.name{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#475569}
.imgbtn{display:block;width:100%;margin:0;padding:0;border:0;background:none;cursor:pointer}
.imgbtn:disabled{cursor:default;opacity:.7}
.card.on{outline:2px solid #2563eb;outline-offset:-2px}
.card[draggable=true]{cursor:grab}
.split{flex:1;min-height:0;display:flex}
.side{width:210px;flex:none;border-right:1px solid #e2e8f0;background:#fff;padding:8px 6px;display:flex;flex-direction:column;gap:2px}
.tree-row{display:flex;align-items:center;gap:2px;border-radius:7px;padding:1px 2px}
.tree-row.on{background:#eef2ff}
.tree-name{flex:1;min-width:0;text-align:left;border:0;background:none;padding:5px 6px;cursor:pointer;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.tree-act{flex:none;border:0;background:none;padding:3px 5px;border-radius:6px;color:#94a3b8;cursor:pointer;font-size:12px}
.tree-row:hover .tree-act{color:#475569}
.tree-act.danger{color:#b91c1c}
.tree-add{margin-top:6px;border:1px dashed #cbd5e1;border-radius:8px;background:none;padding:6px 8px;color:#64748b;cursor:pointer;text-align:left}
@media(prefers-color-scheme:dark){:root{color:#e2e8f0;background:#0f172a;color-scheme:dark}
.toolbar,.card,input,.button,.empty,.side{background:#111827;border-color:#334155}
.noimg{background:#1e293b}.muted,.name{color:#94a3b8}
.tree-row.on{background:#1e293b}.tree-add{border-color:#334155}}
`;

function htmlDocument(title: string, script: string, extraCss = ""): string {
  const safeScript = script.replace(/<\/script/gi, "<\\/script");
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src blob: data: http: https:; style-src 'unsafe-inline'; script-src 'unsafe-inline'"><title>${title}</title><style>${PANE_CSS}\n${extraCss}</style></head><body><div id="root"></div><script>${safeScript}</script></body></html>`;
}

/** canvas pane 的样式管线(照 examples/panes-agent/build.ts buildCanvasCss)。 */
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
    documents[id] = htmlDocument(PANE_TITLES[id] ?? id, output.text, id === "canvas" ? canvasCss : "");
  }
  const target = resolve(ROOT, "web", "pane-documents.generated.ts");
  await writeFile(
    target,
    `// 由 examples/aigc-agent/build.ts 生成,勿手改(改 web/panes/*.tsx 后重跑)。\nexport const paneDocuments = ${JSON.stringify(documents)} as const;\n`,
    "utf8",
  );
  return target;
}

/**
 * 额外产一份**自包含** webext 产物 `web-extension.isolated.mjs`(react 系与 pi-web-kit 全打进去)。
 *
 * 为何要:隔离宿主(opaque-origin iframe 车道,如 pi-clouds cloud 的 pane-loader 以
 * `<script type=module src>` 加载 dist entry)里,扩展跑在**独立 realm** —— 宿主的单例桥
 * `globalThis.__PI_WEBEXT_SINGLETONS__` 在其中不存在,import map 亦无从指向宿主实例,
 * 故标准产物里那句裸 `import "react"` 无从解析,脚本加载即失败。
 *
 * 为何**只在本 example 内**做、不进 `buildWebExtension` 公共面:它不过是再调一次 esbuild;
 * 公共面的不变量恰恰是「单例必须 external」(assertNoBundledSingletons 守卫),此产物有意违之,
 * 属本源自用的补充形态,不宜污染公共契约。
 *
 * 两份并存、各司其职:同源宿主(pi-web 自身)恒用 `manifest.entry` 指的 external 版,与宿主共享
 * 同一 React 实例;隔离宿主取本产物,realm 内自成一体、经 panes-kit RPC 与宿主通信。
 * manifest **不含**本产物,故对既有宿主与 SRI/签名链零影响。
 */
async function buildSelfContainedEntry(outDir: string): Promise<void> {
  const result = await build({
    entryPoints: [resolve(ROOT, ".pi", "web", "web.config.tsx")],
    bundle: true,
    write: false,
    format: "esm",
    platform: "browser",
    target: "es2022",
    jsx: "automatic",
    // `ai` 仍 external:只在类型/可选路径出现,打进来显著膨胀且隔离 pane 用不到。
    external: ["ai"],
    define: { "process.env.NODE_ENV": '"production"' },
    minify: true,
    legalComments: "none",
  });
  const out = result.outputFiles?.[0];
  if (out === undefined) throw new Error("自包含 webext 未产出文件");
  await writeFile(resolve(outDir, "web-extension.isolated.mjs"), out.text, "utf8");
}

export async function buildAigcAgent(): Promise<BuildResult> {
  await buildPaneDocuments();
  const outDir = resolve(ROOT, ".pi", "web", "dist");
  await mkdir(outDir, { recursive: true });
  const built = await buildWebExtension({
    id: "aigc-studio",
    targetApiVersion: "^0.5.0",
    entryDir: resolve(ROOT, ".pi", "web"),
    outDir,
    capabilities: ["slots", "renderers", "config"],
  });
  await buildSelfContainedEntry(outDir);
  return built;
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  void buildAigcAgent().then((result) => console.log(`[built] aigc-agent → ${result.entryOut}`));
}
