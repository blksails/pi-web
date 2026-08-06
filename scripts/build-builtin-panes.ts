/**
 * 构建宿主内置 pane 的 guest 文档(spec host-builtin-panes,任务 1.1)。
 *
 * 把 `panes/<paneId>/main.tsx` 各自打成自足 IIFE,内联进一份带 CSP 的 HTML,汇总写成
 * `panes/generated.ts`(`Record<paneId, html>`)。宿主的内置 pane 定义从该产物取 `srcDoc`。
 *
 * ## 为什么是内联 srcDoc 而不是宿主 serve 的 URL
 *
 * pane 文档契约支持两形态(内联 `srcDoc` / `html` 的 `src`),生产 CSP 也已放行
 * `frame-src 'self'`,故 URL 形态**可行**。但它引入「宿主静态资源路径在 dev / standalone /
 * desktop / 云端 / e2b 沙箱五形态下都必须正确」这一前提,而该类前提在本仓有前科(runner
 * bootstrap 路径的五形态解析、内置扩展解析根随包走导致内置扩展静默不可用)。内联 srcDoc
 * 零网络、零路由、形态无关 —— 少一个只在某种部署形态下才暴露的失败面。
 * 详见 spec design.md 的 D1(含将来大体积 pane 切换 URL 形态的逃生门)。
 *
 * ## 按目录扫描,不是硬编码清单
 *
 * 扫 `panes/<paneId>/main.tsx`。新增一个内置 pane = 新建一个目录,构建侧零改动。
 * 一个 pane 都没有时产出空映射而非报错 —— 使本构建管道可以先于任何 guest 存在。
 *
 * ## 产物不入库
 *
 * `panes/generated.ts` 被 gitignore;类型侧由 `panes/generated.d.ts` 垫片兜住,故
 * `tsc --noEmit` 不依赖构建产物。这条纪律的由来:本仓已三次踩到「本地绿是因为工作树里
 * 躺着一份没人生成的产物」(webext 示例产物、兄弟仓、声明式夹具)。
 *
 * 运行:`node --import jiti/register scripts/build-builtin-panes.ts`
 */
import { access, readdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import {
  bundlePaneEntry,
  escapeInlineScriptForHtml,
  renderPaneDocument,
} from "@blksails/pi-web-kit/build/pane-document";
import {
  PANE_CHROME_SCRIPT_FILE,
  paneChromeScriptSource,
} from "@blksails/pi-web-panes-kit";
import { LOGS_PANE_HTML } from "../packages/ui/src/logs/logs-pane-document.js";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const PANES_DIR = resolve(ROOT, "panes");
const GENERATED = resolve(PANES_DIR, "generated.ts");
const PUBLIC_DIR = resolve(ROOT, "public");

async function logsPaneHtml(): Promise<string> {
  const result = await build({
    stdin: {
      contents: 'import { installGlobalTauriPaneBootstrap } from "@blksails/pi-web-panes-kit/adapters/tauri-runtime"; installGlobalTauriPaneBootstrap();',
      resolveDir: ROOT,
      loader: "ts",
    },
    bundle: true,
    write: false,
    format: "iife",
    platform: "browser",
    target: "es2022",
    minify: true,
    legalComments: "none",
  });
  const output = result.outputFiles?.[0];
  if (output === undefined) throw new Error("logs pane Tauri bootstrap 未生成 bundle");
  return LOGS_PANE_HTML.replace(
    "<script>",
    `<script>${escapeInlineScriptForHtml(output.text)}</script><script>`,
  );
}

/**
 * 内置 pane 文档的基础样式。
 *
 * pane 跑在独立 realm,拿不到宿主的 CSS —— 每份文档必须自带。这里只放「任何内置 pane 都
 * 需要」的最小集(盒模型、滚动、深色模式、等宽),领域样式由各 pane 自行内联。
 * 深色模式走 `prefers-color-scheme`:pane 是 opaque origin 的 iframe,读不到宿主的主题类,
 * 但媒体查询在 iframe 内同样生效。
 */
const BASE_CSS = String.raw`
:root{font:13px/1.5 Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:hsl(var(--foreground,0 0% 9%));background:hsl(var(--background,0 0% 100%));color-scheme:light}
*{box-sizing:border-box}html,body{height:100%;margin:0}#root{height:100%}
.pane{height:100%;min-height:0;display:flex;flex-direction:column;overflow:auto}
.pane-body{flex:1;min-height:0;padding:12px;overflow:auto}
/* 宿主浮层(比例切换器)固定在面板右下角,会盖住 pane 右下角内容 —— pane 侧留出让位内边距,
   不改宿主 chrome。 */
.pane-body{padding-bottom:56px}
/* 浏览器地址栏与 agent toolbar 同构：chrome 底边之下再一条业务分隔 */
.browser-toolbar{display:flex;align-items:center;flex-wrap:wrap;gap:6px;padding:8px 10px;border-bottom:1px solid hsl(var(--border,0 0% 89%));background:hsl(var(--surface,var(--background,0 0% 100%)));flex:none}
.browser-toolbar input{flex:1;min-width:0;height:28px;border:1px solid hsl(var(--border,0 0% 89%));border-radius:7px;padding:0 8px;background:hsl(var(--background,0 0% 100%));color:inherit}
.browser-toolbar button{height:28px;padding:0 10px;border:1px solid hsl(var(--border,0 0% 89%));border-radius:7px;background:hsl(var(--background,0 0% 100%));color:inherit;cursor:pointer}
.browser-status{padding:6px 10px;font-size:12px}
.browser-content{flex:1;min-height:0;display:flex;flex-direction:column}
.browser-content iframe{flex:1;min-height:0;width:100%;border:0;background:#fff}
.muted{color:hsl(var(--muted-foreground,0 0% 45%))}.mono{font-family:ui-monospace,SFMono-Regular,Consolas,monospace;font-size:12px}
dl.kv{margin:0;display:grid;grid-template-columns:auto 1fr;gap:6px 12px;align-items:baseline}
dl.kv dt{color:hsl(var(--muted-foreground,0 0% 45%));white-space:nowrap}
dl.kv dd{margin:0;min-width:0;overflow-wrap:anywhere;font-family:ui-monospace,SFMono-Regular,Consolas,monospace;font-size:12px}
.empty{min-height:120px;display:grid;place-items:center;text-align:center;color:hsl(var(--muted-foreground,0 0% 45%));border:1px dashed hsl(var(--border,0 0% 89%));border-radius:12px;background:hsl(var(--surface,var(--background,0 0% 100%)));padding:16px}
@media(prefers-color-scheme:dark){
  :root{color-scheme:dark}
}
`;

/** 扫 `panes/<paneId>/main.tsx`,返回 paneId 列表(按名排序,使产物稳定)。 */
async function discoverPanes(): Promise<string[]> {
  let entries;
  try {
    entries = await readdir(PANES_DIR, { withFileTypes: true });
  } catch {
    // panes/ 尚不存在 → 没有内置 pane,不是错误。
    return [];
  }
  const ids: string[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    try {
      await access(resolve(PANES_DIR, entry.name, "main.tsx"));
      ids.push(entry.name);
    } catch {
      // 目录里没有 main.tsx → 不是 pane 目录,跳过(不报错:允许放辅助目录)。
    }
  }
  return ids.sort();
}

export interface BuiltinPanesBuildResult {
  readonly generatedPath: string;
  readonly paneIds: readonly string[];
}

export async function buildBuiltinPanes(): Promise<BuiltinPanesBuildResult> {
  const paneIds = await discoverPanes();
  const documents: Record<string, string> = {};
  // chrome 不写进产物：Host withDefaultPaneChrome（inline）/ native boot（URL）唯一注入。
  // public 仍落一份 pane-chrome.js 仅作调试对照，HTML 不再引用。
  await writeFile(resolve(PUBLIC_DIR, PANE_CHROME_SCRIPT_FILE), paneChromeScriptSource(), "utf8");
  for (const id of paneIds) {
    const script = await bundlePaneEntry(resolve(PANES_DIR, id, "main.tsx"));
    const bare = renderPaneDocument(id, script, BASE_CSS);
    // generated 供 host 定义取 srcDoc；Host 入口 force wrap。
    documents[id] = bare;
    await writeFile(resolve(PUBLIC_DIR, `pane-${id}.html`), bare, "utf8");
  }
  await writeFile(resolve(PUBLIC_DIR, "pane-logs.html"), await logsPaneHtml(), "utf8");
  await writeFile(
    GENERATED,
    `// Generated by scripts/build-builtin-panes.ts; do not edit, do not commit.\n` +
      `export const builtinPaneDocuments = ${JSON.stringify(documents)} as const;\n`,
    "utf8",
  );
  return { generatedPath: GENERATED, paneIds };
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  void buildBuiltinPanes().then(({ generatedPath, paneIds }) => {
    // eslint-disable-next-line no-console
    console.log(
      paneIds.length === 0
        ? `[builtin-panes] 无内置 pane,已写出空映射 → ${generatedPath}`
        : `[builtin-panes] ${paneIds.length} 个 → ${generatedPath} (${paneIds.join(", ")})`,
    );
  });
}
