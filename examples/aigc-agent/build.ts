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
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildWebExtension, type BuildResult } from "@blksails/pi-web-kit/build";
import postcss from "postcss";
import tailwindcss from "tailwindcss";
import type { Config } from "tailwindcss";
import { piWebPreset } from "../../packages/ui/tailwind-preset.js";
import { aigcPanesDefinition } from "./web/panes/index.js";

const ROOT = dirname(fileURLToPath(import.meta.url));
const PANE_IDS = ["search", "materials", "canvas"] as const;
const PANE_TITLES: Record<string, string> = { search: "搜索 Pane", materials: "素材 Pane", canvas: "画布 Pane" };

// aigc pane 基础样式(源自独立仓 scripts/build-panes.mjs:素材卡 .card/.grid/.imgbtn 等)。
const PANE_CSS = String.raw`
:root{font:13px/1.6 ui-sans-serif,system-ui,"PingFang SC","Microsoft YaHei",sans-serif;color:#172033;background:#f8fafc;color-scheme:light}
*{box-sizing:border-box}html,body,#root{height:100%;margin:0}button,input{font:inherit;color:inherit}
button:focus-visible,input:focus-visible{outline:2px solid #2563eb;outline-offset:2px}
.pane-layout{height:100%;min-height:0;display:flex;flex-direction:column}
.toolbar{display:flex;align-items:center;flex-wrap:wrap;gap:6px;padding:8px 10px;border-bottom:1px solid #e2e8f0;background:#fff}
.toolbar>.muted{flex-basis:100%}
.grow{flex:1;min-width:0}
input{border:1px solid #cbd5e1;border-radius:8px;background:#fff;padding:8px 10px}
.button{display:inline-flex;flex:none;align-items:center;height:30px;border:1px solid #cbd5e1;border-radius:8px;background:#fff;padding:5px 9px;cursor:pointer;white-space:nowrap}
.button:disabled{opacity:.5;cursor:not-allowed}
.button-primary{border-color:#2563eb;background:#2563eb;color:#fff}
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
.badge{border-radius:999px;padding:1px 7px;font-size:11px;background:#eef2ff;color:#4338ca}
.name{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#475569}
.imgbtn{display:block;width:100%;margin:0;padding:0;border:0;background:none;cursor:pointer}
.imgbtn:disabled{cursor:default;opacity:.7}
.card.on{outline:2px solid #2563eb;outline-offset:-2px}
.card[draggable=true]{cursor:grab}
.split{flex:1;min-height:0;display:flex}
.side{width:148px;flex:none;border-right:1px solid #e2e8f0;background:#fff;padding:8px 6px;display:flex;flex-direction:column;gap:2px}
.tree-row{display:flex;align-items:center;gap:2px;border-radius:7px;padding:1px 2px}
.tree-row.on{background:#eef2ff}
.tree-name{flex:1;min-width:0;text-align:left;border:0;background:none;padding:5px 6px;cursor:pointer;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.tree-twist{flex:none;width:14px;border:0;background:none;padding:0;color:#94a3b8;cursor:pointer;font-size:10px;line-height:1}
.tree-count{flex:none;padding:0 4px;font-size:11px;color:#94a3b8;font-variant-numeric:tabular-nums}
.tree-act{flex:none;border:0;background:none;padding:3px 5px;border-radius:6px;color:#94a3b8;cursor:pointer;font-size:12px}
.tree-row:hover .tree-act{color:#475569}
.tree-act.danger{color:#b91c1c}
.tree-add{margin-top:6px;border:1px dashed #cbd5e1;border-radius:8px;background:none;padding:6px 8px;color:#64748b;cursor:pointer;text-align:left}
.notice{margin:8px 12px 0;padding:6px 10px;border:1px solid #fcd34d;background:#fffbeb;color:#92400e;border-radius:8px;font-size:12px;cursor:pointer}
.content.dropping{outline:2px dashed #2563eb;outline-offset:-6px;background:#eff6ff}
/* 素材卡(复刻 aigc-agent .aigc-asset):保持比例不裁切 + 扫光占位 + 悬浮动作 */
.asset{position:relative;border:1px solid #e2e8f0;border-radius:10px;background:#fff;overflow:hidden;aspect-ratio:1}
.asset[draggable=true]{cursor:grab}
.asset.sel{outline:2px solid #2563eb;outline-offset:-2px}
.asset-img{display:block;width:100%;height:100%;object-fit:contain;background:#f1f5f9;opacity:0;transition:opacity .25s;cursor:pointer}
.asset-img.loaded{opacity:1}
.asset-shimmer{position:absolute;inset:0;background:linear-gradient(90deg,#f1f5f9 25%,#e2e8f0 37%,#f1f5f9 63%);background-size:400% 100%;animation:pane-shimmer 1.4s ease infinite}
@keyframes pane-shimmer{0%{background-position:100% 50%}100%{background-position:0 50%}}
.asset-ck{position:absolute;left:6px;top:6px;width:18px;height:18px;border-radius:5px;border:1px solid #cbd5e1;background:rgb(255 255 255/.9);color:#2563eb;font-size:11px;line-height:1;display:grid;place-items:center;cursor:pointer;opacity:0;transition:opacity .15s}
.asset:hover .asset-ck,.asset-ck.on,.asset-ck.any{opacity:1}
.asset-ck.on{border-color:#2563eb}
.asset-menu{position:absolute;right:6px;top:6px;width:22px;height:22px;border-radius:6px;border:none;background:rgb(20 22 35/.66);color:#fff;cursor:pointer;opacity:0;transition:opacity .15s;line-height:1}
.asset:hover .asset-menu{opacity:1}
.asset-name{position:absolute;left:0;right:0;bottom:0;padding:4px 7px;font-size:11px;color:#fff;background:linear-gradient(transparent,rgb(0 0 0/.55));overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
/* 分发状态角标(只读台账;平台未接则整个不渲染) */
.asset-badge{position:absolute;left:6px;bottom:22px;padding:1px 6px;border-radius:999px;font-size:10px;line-height:16px;color:#fff;background:#64748b;pointer-events:auto}
.asset-badge.done{background:#16a34a}
.asset-badge.pending{background:#d97706}
.asset-badge.failed{background:#dc2626}
/* 卡片动作菜单(portal 到 body,useFitPos 夹进视口) */
.asset-backdrop{position:fixed;inset:0;z-index:40}
.asset-pop{position:fixed;z-index:41;min-width:150px;padding:4px;border:1px solid #e2e8f0;border-radius:10px;background:#fff;box-shadow:0 10px 30px rgb(0 0 0/.18);display:flex;flex-direction:column}
.asset-pop>button{display:block;width:100%;text-align:left;border:0;background:none;padding:7px 10px;border-radius:7px;cursor:pointer;white-space:nowrap}
.asset-pop>button:hover:not(:disabled){background:#f1f5f9}
.asset-pop>button:disabled{color:#94a3b8;cursor:not-allowed}
.pop-sep{height:1px;margin:4px 2px;background:#e2e8f0}
.pop-sub{display:flex;gap:4px;padding:2px}
.pop-input{flex:1;min-width:0;padding:5px 7px}
.pop-sub>button{border:1px solid #cbd5e1;border-radius:7px;background:none;padding:4px 9px;cursor:pointer}
/* 「移动到目录」弹窗 */
.dlg-backdrop{position:fixed;inset:0;z-index:45;display:grid;place-items:center;padding:24px;background:rgb(0 0 0/.35)}
.dlg{display:flex;flex-direction:column;width:min(360px,100%);max-height:70vh;border:1px solid #e2e8f0;border-radius:12px;background:#fff;overflow:hidden;box-shadow:0 20px 60px rgb(0 0 0/.3)}
.dlg-head{padding:11px 14px;border-bottom:1px solid #e2e8f0;font-weight:600}
.dlg-body{padding:6px;display:flex;flex-direction:column;gap:2px}
.dlg-row{text-align:left;border:0;background:none;padding:8px 10px;border-radius:8px;cursor:pointer}
.dlg-row:hover{background:#f1f5f9}
.dlg-foot{padding:8px 12px;border-top:1px solid #e2e8f0;display:flex;justify-content:flex-end}
/* 富预览灯箱(复刻 aigc-agent .aigc-ilb) */
.ilb{position:fixed;inset:0;z-index:60;display:grid;place-items:center;background:rgb(8 10 18/.88);overflow:hidden}
.ilb-stage{max-width:92vw;max-height:88vh;display:grid;place-items:center;overflow:hidden}
.ilb-img{max-width:92vw;max-height:88vh;object-fit:contain;transition:transform .12s ease-out;user-select:none;-webkit-user-drag:none}
.ilb-x{position:fixed;top:14px;right:16px;width:34px;height:34px;border-radius:50%;border:none;background:rgb(255 255 255/.12);color:#fff;font-size:16px;cursor:pointer}
.ilb-x:hover{background:rgb(255 255 255/.22)}
.ilb-nav{position:fixed;top:50%;translate:0 -50%;width:44px;height:64px;border:none;border-radius:10px;background:rgb(255 255 255/.1);color:#fff;font-size:28px;line-height:1;cursor:pointer}
.ilb-nav:hover{background:rgb(255 255 255/.2)}
.ilb-nav.left{left:16px}.ilb-nav.right{right:16px}
.ilb-tools{position:fixed;left:50%;bottom:22px;translate:-50% 0;display:flex;align-items:center;gap:2px;padding:5px 8px;border-radius:12px;background:rgb(255 255 255/.1);backdrop-filter:blur(8px);color:#fff}
.ilb-tools button{width:30px;height:28px;border:none;border-radius:7px;background:none;color:#fff;font-size:15px;line-height:1;cursor:pointer}
.ilb-tools button:hover{background:rgb(255 255 255/.18)}
.ilb-tools button.on{background:rgb(37 99 235/.75)}
.ilb-tools .pct{min-width:44px;text-align:center;font-size:12px;font-variant-numeric:tabular-nums}
.ilb-tools .sep{width:1px;height:16px;margin:0 4px;background:rgb(255 255 255/.25)}
.ilb-count{position:fixed;left:50%;top:16px;translate:-50% 0;color:rgb(255 255 255/.8);font-size:12px}
.ilb-dims{position:fixed;right:16px;bottom:22px;color:rgb(255 255 255/.65);font-size:12px;font-variant-numeric:tabular-nums}
@media(prefers-color-scheme:dark){:root{color:#e2e8f0;background:#0f172a;color-scheme:dark}
.toolbar,.card,input,.button,.empty,.side,.asset,.asset-pop,.dlg{background:#111827;border-color:#334155}
.noimg{background:#1e293b}.muted,.name{color:#94a3b8}
.tree-row.on{background:#1e293b}.tree-add{border-color:#334155}
.asset-img{background:#1e293b}
.asset-shimmer{background:linear-gradient(90deg,#1e293b 25%,#334155 37%,#1e293b 63%);background-size:400% 100%}
.asset-ck{background:rgb(17 24 39/.9);border-color:#334155}
.asset-pop>button:hover:not(:disabled),.dlg-row:hover{background:#1e293b}
.pop-sep,.dlg-head,.dlg-foot{border-color:#334155}
.segs{background:#1e293b}.seg{color:#94a3b8}.seg:hover{background:#334155}.seg.on{background:#0f172a;color:#e2e8f0}
.notice{background:#422006;border-color:#a16207;color:#fde68a}
.content.dropping{background:#0b1220}}
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

async function buildPaneDocuments(): Promise<{ target: string; canvasCss: string }> {
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
  return { target, canvasCss };
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
    // ★入口是**自挂载的工作台**(web/panes/isolated-workbench.tsx),不是 web.config —— 隔离宿主
    //   的 loader 要求 entry 自己 connectPaneGuest 握手 + 自 mount;webext 描述符对象喂进去
    //   只会加载出一个对象、屏幕空白。
    entryPoints: [resolve(ROOT, "web", "panes", "isolated-workbench.tsx")],
    bundle: true,
    write: false,
    format: "esm",
    platform: "browser",
    target: "es2022",
    jsx: "automatic",
    // `ai` 仍 external:只在类型/可选路径出现,打进来显著膨胀且隔离 pane 用不到。
    external: ["ai"],
    define: {
      "process.env.NODE_ENV": '"production"',
      // 同源形态下 pane 样式由 build 写进自含 HTML;隔离形态的 HTML 是宿主的 pane-loader
      // (第一方,不含本源样式),故把样式打进产物、运行时自注入。
      __AIGC_PANE_CSS__: JSON.stringify(`${PANE_CSS}\n${canvasCss}`),
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
    `// 由 examples/aigc-agent/build.ts 生成 —— 按 realm 分派到 external / isolated 产物。\n` +
    `let m;\n` +
    `try {\n` +
    `  await import("react");\n` +
    `  m = await import("./web-extension.external.mjs");\n` +
    `} catch {\n` +
    `  m = await import("./web-extension.isolated.mjs");\n` +
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
  const { canvasCss } = await buildPaneDocuments();
  const outDir = resolve(ROOT, ".pi", "web", "dist");
  await mkdir(outDir, { recursive: true });
  const built = await buildWebExtension({
    id: "aigc-studio",
    targetApiVersion: "^0.5.0",
    entryDir: resolve(ROOT, ".pi", "web"),
    outDir,
    capabilities: ["slots", "renderers", "config"],
    // ★ pane 清单进 manifest —— 隔离宿主(pi-clouds pane-loader 车道)读不到 entry 的运行时
    //   描述符,manifest 是它唯一能静态拿到 pane 列表与逐 pane 授权的地方。**与
    //   `aigcPanesDefinition` 同源**(见下),不另手写一份,免两处漂移。
    panes: aigcPanesDefinition.panes.map((p) => ({
      id: p.id,
      title: p.title,
      ...(p.icon !== undefined ? { icon: p.icon } : {}),
      capabilities: {
        routes: p.capabilities.routes.map((r) => ({ name: r.name, methods: [...r.methods] })),
        surfaceKeys: [...p.capabilities.surfaceKeys],
        surfaceCommands: p.capabilities.surfaceCommands.map((c) => ({
          domain: c.domain,
          actions: [...c.actions],
        })),
        attachments: p.capabilities.attachments,
        conversation: p.capabilities.conversation,
      },
    })),
  });
  await buildSelfContainedEntry(outDir, canvasCss);
  await buildEntryDispatcher(outDir);
  return built;
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  void buildAigcAgent().then((result) => console.log(`[built] aigc-agent → ${result.entryOut}`));
}
