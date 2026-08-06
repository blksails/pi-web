/**
 * 打包 agic-video-agent 隔离 pane Guest 文档(inline srcDoc)+ webext 产物。
 *
 * 用 esbuild 把各模块声明的 Guest 入口连 React + Guest SDK 打成单脚本 IIFE,包进自含 HTML
 * (严格 CSP:仅 inline script/style + 图片),写出 panes/pane-documents.generated.ts。
 * canvas pane 另经 tailwind(piWebPreset)生成 canvas-ui 所需工具类样式。
 * 随后 buildWebExtension 把 .pi/web 打成 ESM + manifest 入 .pi/web/dist。
 *
 * 运行:node --import jiti/register examples/agic-video-agent/build.ts
 * (改 Pane 包后重跑并提交 pane-documents.generated.ts)。
 */
import { build, type Plugin } from "esbuild";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { buildWebExtension, type BuildResult } from "@blksails/pi-web-kit/build";
import { escapeInlineScriptForHtml } from "@blksails/pi-web-kit/build/pane-document";
import { PaneCapabilitiesSchema } from "@blksails/pi-web-panes-kit";
import postcss from "postcss";
import tailwindcss from "tailwindcss";
import type { Config } from "tailwindcss";
import { AIGC_PANES_ID, aigcPaneModules } from "./panes/modules.js";
import { AIGC_AGENT_PANEL_CONFIG, AIGC_PANES_CONFIG } from "./panes/agent-config.js";
import { LOGS_PANE_HTML, LOGS_PANE_ID } from "./panes/logs-pane-document.js";

const ROOT = dirname(fileURLToPath(import.meta.url));
const requireFromAgent = createRequire(import.meta.url);

/**
 * 独立仓可能与 pi-web 工作区各装一份 React；若让 esbuild 按 importer 就近解析，
 * agent 页面与 panes-kit 会各打入一份 React，最终触发 Invalid Hook Call 并白屏。
 * 所有 pane realm 强制从 agent 根解析 React 单例，仍保持 pane 自包含。
 */
const paneReactSingletonPlugin: Plugin = {
  name: "aigc-pane-react-singleton",
  setup(ctx): void {
    ctx.onResolve(
      { filter: /^(?:react|react-dom)(?:\/.*)?$/ },
      (args) => ({ path: requireFromAgent.resolve(args.path) }),
    );
  },
};

// aigc pane 基础样式(源自独立仓 scripts/build-panes.mjs:素材卡 .card/.grid/.imgbtn 等)。
const PANE_CSS = String.raw`
:root{font:13px/1.6 ui-sans-serif,system-ui,"PingFang SC","Microsoft YaHei",sans-serif;color:hsl(var(--foreground,0 0% 9%));background:hsl(var(--background,0 0% 100%));color-scheme:light dark}
*{box-sizing:border-box}html,body,#root{height:100%;margin:0}button,input{font:inherit;color:inherit}
button:focus-visible,input:focus-visible{outline:2px solid hsl(var(--ring,0 0% 9%));outline-offset:2px}
.pane-layout{height:100%;min-height:0;display:flex;flex-direction:column}
.toolbar{display:flex;align-items:center;flex-wrap:wrap;gap:6px;padding:8px 10px;border-bottom:1px solid #e2e8f0;background:#fff}
.pane-header{position:sticky;top:0;z-index:2;flex-wrap:nowrap;background:color-mix(in srgb,#fff 88%,transparent);backdrop-filter:blur(12px)}
.toolbar>.muted{flex-basis:100%}
.grow{flex:1;min-width:0}
input{border:1px solid #cbd5e1;border-radius:8px;background:#fff;padding:8px 10px}
.search-field{display:flex;align-items:center;gap:7px;min-width:0;padding:0 9px;border:1px solid #d7dee9;border-radius:9px;background:#fff;color:#64748b;box-shadow:0 1px 2px rgb(15 23 42/.04)}
.search-field:focus-within{border-color:hsl(var(--ring,0 0% 9%));box-shadow:0 0 0 3px hsl(var(--ring,0 0% 9%)/.12)}
.search-field input{width:100%;min-width:0;border:0;padding:7px 0;outline:0;box-shadow:none}
.button{display:inline-flex;flex:none;align-items:center;height:30px;border:1px solid #cbd5e1;border-radius:8px;background:#fff;padding:5px 9px;cursor:pointer;white-space:nowrap}
.button:disabled{opacity:.5;cursor:not-allowed}
.button-primary{border-color:hsl(var(--primary,0 0% 9%));background:hsl(var(--primary,0 0% 9%));color:hsl(var(--primary-foreground,0 0% 100%))}
.icon-button{display:inline-grid;flex:none;width:30px;height:30px;place-items:center;border:1px solid #d7dee9;border-radius:8px;background:#fff;color:#475569;cursor:pointer;transition:background .15s,color .15s,border-color .15s,transform .15s}
.icon-button:hover:not(:disabled){border-color:hsl(var(--border,0 0% 89%));background:hsl(var(--accent,0 0% 96%));color:hsl(var(--foreground,0 0% 9%))}.icon-button:active:not(:disabled){transform:scale(.94)}.icon-button:disabled{opacity:.45;cursor:not-allowed}.icon-button.primary{border-color:hsl(var(--primary,0 0% 9%));background:hsl(var(--primary,0 0% 9%));color:hsl(var(--primary-foreground,0 0% 100%))}.icon-button.primary:hover:not(:disabled){background:hsl(var(--primary,0 0% 9%));color:hsl(var(--primary-foreground,0 0% 100%))}
.spin{animation:pane-spin .75s linear infinite}@keyframes pane-spin{to{transform:rotate(360deg)}}
.content{padding:12px}.scroll{overflow:auto}
.center{height:100%;display:grid;place-items:center}.muted{color:#64748b}.error{color:#b91c1c}
.hint{cursor:help;opacity:.75}
/* 类型过滤分段控件 + 按天分栏标头 */
.segs{display:inline-flex;flex:none;padding:2px;border-radius:8px;background:#f1f5f9;gap:2px}
.seg{border:0;background:none;padding:3px 8px;border-radius:6px;font-size:12px;color:#475569;cursor:pointer;white-space:nowrap}
.seg:hover{background:#e2e8f0}
.seg.on{background:#fff;color:#0f172a;box-shadow:0 1px 2px rgb(0 0 0/.12)}
.day{position:sticky;top:0;z-index:1;padding:4px 2px;font-size:11px;color:#64748b;background:inherit}
.empty{min-height:160px;display:grid;place-items:center;color:#64748b;border:1px dashed #cbd5e1;border-radius:12px;background:#fff}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(112px,1fr));gap:8px;margin-top:8px}
.card{margin:0;border:1px solid #e2e8f0;border-radius:10px;background:#fff;overflow:hidden}
.card img{display:block;width:100%;aspect-ratio:1;object-fit:cover}
.noimg{display:grid;place-items:center;aspect-ratio:1;color:#94a3b8;background:#f1f5f9}
figcaption{display:flex;align-items:center;gap:6px;padding:6px 8px;font-size:12px}
.badge{border-radius:999px;padding:1px 7px;font-size:11px;background:hsl(var(--accent,0 0% 96%));color:hsl(var(--accent-foreground,0 0% 9%))}
.name{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#475569}
.imgbtn{display:block;width:100%;margin:0;padding:0;border:0;background:none;cursor:pointer}
.imgbtn:disabled{cursor:default;opacity:.7}
.card.on{outline:2px solid hsl(var(--ring,0 0% 9%));outline-offset:-2px}
.card[draggable=true]{cursor:grab}
@media(prefers-color-scheme:dark){:root{color:#e2e8f0;background:#0f172a;color-scheme:dark}
.toolbar,.card,input,.button,.icon-button,.search-field,.empty{background:#111827;border-color:#334155}
.noimg{background:#1e293b}.muted,.name{color:#94a3b8}
.segs{background:#1e293b}.seg{color:#94a3b8}.seg:hover{background:#334155}.seg.on{background:#0f172a;color:#e2e8f0}
}
/* 主题层:随宿主 shadcn token 走;宿主未传时 fallback 为黑白灰(去 #2563eb 等蓝色硬编码)。 */
:root{color:hsl(var(--foreground,0 0% 9%));background:hsl(var(--background,0 0% 100%));color-scheme:light dark}
button:focus-visible,input:focus-visible{outline:2px solid hsl(var(--ring,0 0% 9%));outline-offset:2px}
.toolbar,.card,input,.search-field,.empty{border-color:hsl(var(--border,0 0% 89%));background:hsl(var(--background,0 0% 100%))}
.search-field:focus-within{border-color:hsl(var(--ring,0 0% 9%));box-shadow:0 0 0 3px hsl(var(--ring,0 0% 9%)/.12)}
.button{border-color:hsl(var(--border,0 0% 89%));background:hsl(var(--background,0 0% 100%))}
.button-primary{border-color:hsl(var(--primary,0 0% 9%));background:hsl(var(--primary,0 0% 9%));color:hsl(var(--primary-foreground,0 0% 100%))}
.icon-button{border-color:hsl(var(--border,0 0% 89%));background:hsl(var(--background,0 0% 100%));color:hsl(var(--muted-foreground,0 0% 45%))}
.icon-button:hover:not(:disabled){border-color:hsl(var(--border,0 0% 89%));background:hsl(var(--accent,0 0% 96%));color:hsl(var(--foreground,0 0% 9%))}
.icon-button.primary{border-color:hsl(var(--primary,0 0% 9%));background:hsl(var(--primary,0 0% 9%));color:hsl(var(--primary-foreground,0 0% 100%))}
.icon-button.primary:hover:not(:disabled){background:hsl(var(--primary,0 0% 9%));color:hsl(var(--primary-foreground,0 0% 100%))}
.segs{background:hsl(var(--accent,0 0% 96%))}.seg{color:hsl(var(--muted-foreground,0 0% 45%))}.seg:hover{background:hsl(var(--border,0 0% 89%))}.seg.on{background:hsl(var(--background,0 0% 100%));color:hsl(var(--foreground,0 0% 9%))}
.badge{background:hsl(var(--accent,0 0% 96%));color:hsl(var(--accent-foreground,0 0% 9%))}
.name,.muted,.day{color:hsl(var(--muted-foreground,0 0% 45%))}
.noimg{color:hsl(var(--muted-foreground,0 0% 45%));background:hsl(var(--muted,0 0% 96%))}
.card.on{outline:2px solid hsl(var(--ring,0 0% 9%))}
*,*::before,*::after{box-shadow:none!important}
.card{border:0;background:transparent;overflow:visible}.card img{border-radius:8px}
`;

function htmlDocument(title: string, script: string, extraCss = ""): string {
  const safeScript = escapeInlineScriptForHtml(script);
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src blob: data: http: https:; media-src blob: data: http: https:; connect-src http: https:; style-src 'unsafe-inline'; script-src 'unsafe-inline'"><title>${title}</title><style>html,body{height:100%;margin:0}#root{height:100%}${PANE_CSS}\n${extraCss}</style></head><body><div id="root" style="height:100%"></div><script>${safeScript}</script></body></html>`;
}

function urlHtmlDocument(title: string, scriptFile: string, extraCss = ""): string {
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src blob: data: http: https:; media-src blob: data: http: https:; connect-src http: https: ws: ipc: http://ipc.localhost; style-src 'unsafe-inline'; script-src 'self'"><title>${title}</title><style>html,body{height:100%;margin:0}#root{height:100%}${PANE_CSS}\n${extraCss}</style></head><body><div id="root" style="height:100%"></div><script src="${scriptFile}"></script></body></html>`;
}

/** canvas pane 的样式管线(照 examples/panes-agent/build.ts buildCanvasCss)。 */
async function buildCanvasCss(): Promise<string> {
  const uiStylesPath = requireFromAgent.resolve("@blksails/pi-web-ui/styles.css");
  const canvasStylesPath = requireFromAgent.resolve("@blksails/pi-web-canvas-ui/styles.css");
  const { piWebPreset } = await import(
    pathToFileURL(resolve(dirname(uiStylesPath), "..", "tailwind-preset.ts")).href
  ) as { readonly piWebPreset: Config };
  const config: Config = {
    presets: [piWebPreset as Config],
    content: [
      resolve(dirname(requireFromAgent.resolve("@blksails/pi-web-canvas-ui")), "**", "*.{ts,tsx}"),
      resolve(dirname(requireFromAgent.resolve("@blksails/pi-web-canvas-kit")), "**", "*.{ts,tsx}"),
      resolve(dirname(requireFromAgent.resolve("@blksails/pi-web-primitives")), "**", "*.{ts,tsx}"),
    ],
  };
  const generated = await postcss([tailwindcss(config)]).process(
    "@tailwind base; @tailwind components; @tailwind utilities;",
    { from: undefined },
  );
  const [uiStyles, canvasStyles] = await Promise.all([
    readFile(uiStylesPath, "utf8"),
    readFile(canvasStylesPath, "utf8"),
  ]);
  return `${uiStyles}\n${canvasStyles}\n${generated.css}`;
}

async function buildTauriGuestBootstrap(): Promise<string> {
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
  if (output === undefined) throw new Error("Tauri pane bootstrap 未生成 bundle");
  return output.text;
}

async function buildPaneDocuments(): Promise<{ target: string; canvasCss: string; scripts: Readonly<Record<string, string>> }> {
  const documents: Record<string, string> = {};
  const scripts: Record<string, string> = {};
  const canvasCss = await buildCanvasCss();
  for (const pane of aigcPaneModules) {
    const result = await build({
      entryPoints: [
        pane.entry instanceof URL
          ? fileURLToPath(pane.entry)
          : resolve(ROOT, "panes", pane.entry),
      ],
      bundle: true,
      write: false,
      format: "iife",
      platform: "browser",
      target: "es2022",
      jsx: "automatic",
      plugins: [paneReactSingletonPlugin],
      minify: true,
      legalComments: "none",
      define: { "process.env.NODE_ENV": '"production"' },
    });
    const output = result.outputFiles?.[0];
    if (output === undefined) throw new Error(`Pane ${pane.id} 未生成 bundle`);
    scripts[pane.id] = output.text;
    documents[pane.id] = htmlDocument(
      pane.title,
      output.text,
      pane.canvasStyles === true
        ? `:root{font-size:16px;line-height:1.5}\n${canvasCss}`
        : "",
    );
  }
  const target = resolve(ROOT, "panes", "pane-documents.generated.ts");
  await writeFile(
    target,
    `// 由 examples/agic-video-agent/build.ts 生成,勿手改(改 Pane 包后重跑)。\nexport const paneDocuments = ${JSON.stringify(documents)} as const;\n`,
    "utf8",
  );
  return { target, canvasCss, scripts };
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
async function buildSelfContainedEntry(outDir: string, canvasCss: string): Promise<void> {
  const result = await build({
    // ★入口是**自挂载的工作台**(panes/isolated-workbench.tsx),不是 web.config —— 隔离宿主
    //   的 loader 要求 entry 自己 connectPaneGuest 握手 + 自 mount;webext 描述符对象喂进去
    //   只会加载出一个对象、屏幕空白。
    entryPoints: [resolve(ROOT, "panes", "isolated-workbench.tsx")],
    bundle: true,
    write: false,
    format: "esm",
    platform: "browser",
    target: "es2022",
    jsx: "automatic",
    plugins: [paneReactSingletonPlugin],
    // `ai` 仍 external:只在类型/可选路径出现,打进来显著膨胀且隔离 pane 用不到。
    external: ["ai"],
    define: {
      "process.env.NODE_ENV": '"production"',
      // 同源形态下 pane 样式由 build 写进自含 HTML;隔离形态的 HTML 是宿主的 pane-loader
      // (第一方,不含本源样式),故把样式打进产物、运行时自注入。
      // ★ 分开注入:canvas 专属的 tailwind/ui 样式(canvasCss)只该进 canvas 一个 realm ——
      //   与同源形态(pane-{id}.html 里 search/materials 无 canvasCss)保持一致,否则搜索/素材
      //   pane 会被 canvas 的完整样式污染(pi-clouds 缺陷#1)。
      __AIGC_PANE_CSS__: JSON.stringify(PANE_CSS),
      __AIGC_CANVAS_CSS__: JSON.stringify(canvasCss),
    },
    minify: true,
    legalComments: "none",
  });
  const out = result.outputFiles?.[0];
  if (out === undefined) throw new Error("自包含 webext 未产出文件");
  await writeFile(resolve(outDir, "web-extension.isolated.mjs"), out.text, "utf8");
}

/**
 * 把 `manifest.entry` 指向的 `web-extension.mjs` 换成一枚**运行时分派器**,原 external 产物
 * 改名 `web-extension.external.mjs`。
 *
 * 为何非如此不可:`WebExtensionManifest` 只有**一个** `entry` 字段(schema 见
 * packages/protocol/src/web-ext/manifest.ts,未知字段被 zod strip 掉),而两类宿主要的字节不同:
 *   - 同源宿主(pi-web):经 **import map** 解析裸 `react` 等 → 必须用 external 版共享单例;
 *   - 隔离宿主(pi-clouds pane-loader,opaque-origin iframe):独立 realm、无 import map →
 *     裸 specifier 解析失败,脚本加载即死,必须用自包含版。
 * 消费侧(cloud `resolveCloudWebext` → `paneLoaderUrl(hash, manifest.entry, …)`)只认
 * `manifest.entry` 这一个名字,故只能在**这一个入口内部**分派。
 *
 * 判据用 `await import("react")` 成败,而非某个私有全局:同源宿主的 import map 必能解析它,
 * 隔离 realm 必抛 —— 不依赖任何宿主实现细节,两侧都不会误判。
 *
 * ★代价(有意接受):宿主对 entry 字节做 SRI(`verifyExtension`),但分派器**动态 import** 的两个
 *   子模块不在该校验覆盖内。本 example 的三份产物同出一次构建、同随 bundle 分发、同被 registry
 *   的 `webext.integrity`(对 manifest.json)与逐文件回源核验覆盖,故本地/发布链完整性仍成立;
 *   若将来要严守「entry 字节即全部代码」的 SRI 语义,应改为给 manifest 增设隔离入口字段(公共面
 *   改动),而不是在此处放宽。
 */
async function buildEntryDispatcher(outDir: string): Promise<void> {
  const entryPath = resolve(outDir, "web-extension.mjs");
  const externalPath = resolve(outDir, "web-extension.external.mjs");
  await writeFile(externalPath, await readFile(entryPath, "utf8"), "utf8");

  const dispatcher =
    `// 由 examples/agic-video-agent/build.ts 生成 —— 按 realm 分派到 external / isolated 产物。\n` +
    `const reload = new URL(import.meta.url).search;\n` +
    `let m;\n` +
    `try {\n` +
    `  await import("react");\n` +
    `  m = await import(/* @vite-ignore */ \`./web-extension.external.mjs\${reload}\`);\n` +
    `} catch {\n` +
    `  m = await import(/* @vite-ignore */ \`./web-extension.isolated.mjs\${reload}\`);\n` +
    `}\n` +
    `export default m.default;\n`;
  await writeFile(entryPath, dispatcher, "utf8");

  // manifest 的 SRI 覆盖 entry 字节,entry 换了内容就必须重算,否则同源宿主 `verifyExtension`
  // 直接 rejected(算法同 packages/web-kit/build/manifest-emit.ts:computeIntegrity)。
  const manifestPath = resolve(outDir, "manifest.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as Record<string, unknown>;
  manifest["integrity"] = `sha384-${createHash("sha384").update(dispatcher).digest("base64")}`;
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
}

export async function buildAigcAgent(): Promise<BuildResult> {
  const { canvasCss, scripts } = await buildPaneDocuments();
  const logsHtml = LOGS_PANE_HTML.replace(
    "<script>",
    `<script>${escapeInlineScriptForHtml(await buildTauriGuestBootstrap())}</script><script>`,
  );
  const outDir = resolve(ROOT, ".pi", "web", "dist");
  await mkdir(outDir, { recursive: true });
  await Promise.all(aigcPaneModules.flatMap((pane) => {
    const scriptFile = `pane-${pane.id}.js`;
    return [
      writeFile(resolve(outDir, scriptFile), scripts[pane.id] ?? "", "utf8"),
      writeFile(
        resolve(outDir, `pane-${pane.id}.html`),
        urlHtmlDocument(
          pane.title,
          `./${scriptFile}`,
          pane.canvasStyles === true
            ? `:root{font-size:16px;line-height:1.5}\n${canvasCss}`
            : "",
        ),
        "utf8",
      ),
    ];
  }));
  await writeFile(resolve(outDir, `pane-${LOGS_PANE_ID}.html`), logsHtml, "utf8");
  const built = await buildWebExtension({
    id: "agic-video-studio",
    targetApiVersion: "^0.5.0",
    entryDir: resolve(ROOT, ".pi", "web"),
    outDir,
    capabilities: ["slots", "renderers", "config"],
  });
  // pane 属本 agent 业务能力,不扩 pi-web 的 WebExtensionManifest 公共协议。另产 sidecar,
  // 供 Pi-clouds adapter 静态发现；内容仍与运行时 definePanes 单源。
  await writeFile(resolve(outDir, "panes.json"), `${JSON.stringify({
    id: AIGC_PANES_ID,
    // 宿主侧配置烘焙进 sidecar:Pi-clouds adapter 据此声明 panelRight 宽度 / panes 交互,
    // 宽度由 agent config 驱动(而非宿主写死),经 resolveCloudWebext 下发前端。
    config: {
      ...AIGC_AGENT_PANEL_CONFIG,
      ...AIGC_PANES_CONFIG,
    },
    panes: aigcPaneModules.map((pane) => {
      const capabilities = PaneCapabilitiesSchema.parse(pane.capabilities);
      return {
        id: pane.id,
        title: pane.title,
        ...(pane.icon !== undefined ? { icon: pane.icon } : {}),
        capabilities: {
          routes: capabilities.routes.map((r) => ({ name: r.name, methods: [...r.methods] })),
          surfaceKeys: [...capabilities.surfaceKeys],
          surfaceCommands: capabilities.surfaceCommands.map((c) => ({
            domain: c.domain,
            actions: [...c.actions],
          })),
          events: {
            publish: [...capabilities.events.publish],
            subscribe: [...capabilities.events.subscribe],
          },
          attachments: capabilities.attachments,
          conversation: capabilities.conversation,
        },
      };
    }),
  }, null, 2)}\n`, "utf8");
  await buildSelfContainedEntry(outDir, canvasCss);
  await buildEntryDispatcher(outDir);
  return built;
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  void buildAigcAgent().then((result) => console.log(`[built] agic-video-agent → ${result.entryOut}`));
}
