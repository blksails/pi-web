#!/usr/bin/env node
/**
 * sync-from-aigc-agent — 从源仓库 aigc-agent 同步迁移面到本仓库(幂等,可重跑)。
 *
 * 背景:C:/workcode/aigc-agent 仍在持续迭代;每次源侧有改动,重跑本脚本即得干净 diff
 * (git 审阅后提交)。详见 docs/aigc-agent-migration.md。
 *
 * 同步面(源 → 本仓库):
 *  1. agents/aigc/**            → examples/aigc-agent/        (agent 定义 + .pi/web)
 *  2. packages/aigc-media-tools → packages/aigc-media-tools   (上提的 workspace 包,原名 @aigc-agent/media-tools)
 *  3. packages/platform-client/src/index.ts → examples/aigc-agent/platform-client.ts(内联,单文件零依赖)
 *  4. components/<壳层工作区 10 件> → examples/aigc-agent/.pi/web/workspace/(WorkspacePanel 体系:
 *     分屏+Tab+Activity 保活容器、模块注册(画布/素材/搜图/沙箱)、素材抽屉、搜图面板、对话框、launcher)
 *  5. lib/{workspace,stores,app} 7 件 → .pi/web/workspace/lib/(module-registry/layout-tree/
 *     workspace-store/search-query-store/iframe-rpc/material-drawer-store/material-drop-cache)
 *  6. public/sandbox/preview.html → public/sandbox/preview.html(沙箱模块静态页)
 *  7. app/globals.css → .pi/web/aigc-shell.css(变换 D:去 @import/@tailwind 头、中和裸 html/body
 *     全局规则、token 选择器组追加 .aigc-embed 作用域、尾部追加 pi-web 适配段)
 *  8. 生成 .pi/web/workspace/host-adapter.tsx(pi-web 宿主适配层:QueryProvider 自包 + 三槽组合)
 *
 * 定点变换(锚点丢失即告警,勿静默):
 *  A. examples/aigc-agent/*.ts:`from "@aigc-agent/platform-client"` → `from "./platform-client.js"`
 *  B. .pi/web/web.config.tsx:壳层 import 改指向迁移后的 workspace/(host-adapter 三槽:
 *     panelRight=AigcWorkspacePanel、dialogLayer=AigcDialogLayer、sidebarLeft=AigcWorkspaceRail)
 *  C. workspace 文件的 `@/…` import 按目录层级重写为相对路径(残留 `@/` 即告警)
 *  D. aigc-shell.css 见同步面 7
 *
 * 用法:node scripts/sync-from-aigc-agent.mjs [源仓库路径,默认 C:/workcode/aigc-agent]
 */
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const SRC = resolve(process.argv[2] ?? "C:/workcode/aigc-agent");
const DST = resolve(import.meta.dirname, "..");
const warnings = [];
const changed = [];

if (!existsSync(join(SRC, "agents", "aigc", "index.ts"))) {
  console.error(`源仓库不存在或无 agents/aigc:${SRC}`);
  process.exit(1);
}

/** 递归复制(排除 node_modules / tsbuildinfo),返回写入文件数。 */
function copyTree(from, to) {
  let n = 0;
  mkdirSync(to, { recursive: true });
  for (const e of readdirSync(from, { withFileTypes: true })) {
    if (e.name === "node_modules" || e.name.endsWith(".tsbuildinfo")) continue;
    const f = join(from, e.name);
    const t = join(to, e.name);
    if (e.isDirectory()) n += copyTree(f, t);
    else {
      cpSync(f, t);
      n += 1;
    }
  }
  return n;
}

/** 就地文本变换;锚点未命中且 required → 记告警。 */
function transform(file, edits) {
  let text = readFileSync(file, "utf8");
  for (const { find, replace, required, label } of edits) {
    if (text.includes(find)) {
      text = text.replaceAll(find, replace);
    } else if (required) {
      warnings.push(`锚点丢失(${label}):${file} 未找到「${find}」——源结构已变,须人工复核变换是否仍适用`);
    }
  }
  writeFileSync(file, text);
}

// ── 1. agents/aigc → examples/aigc-agent(整树覆盖:先清后拷,防源侧删除的文件残留)──
// 保留名单:pi-web 侧自有文件(源仓库不存在),整树覆盖前暂存、覆盖后原样放回。
// 注:.pi/web/workspace/ 与 aigc-shell.css 是本脚本后续步骤的生成物,清掉后会重建,无需保留。
const exampleDir = join(DST, "examples", "aigc-agent");
const PRESERVE = ["README.md"];
const preserved = new Map(
  PRESERVE.filter((n) => existsSync(join(exampleDir, n))).map((n) => [
    n,
    readFileSync(join(exampleDir, n)),
  ]),
);
rmSync(exampleDir, { recursive: true, force: true });
changed.push(`examples/aigc-agent(${copyTree(join(SRC, "agents", "aigc"), exampleDir)} files)`);
for (const [n, buf] of preserved) {
  writeFileSync(join(exampleDir, n), buf);
  changed.push(`保留 pi-web 侧文件:examples/aigc-agent/${n}`);
}

// ── 2. packages/aigc-media-tools 上提(整树覆盖)──
const mtDir = join(DST, "packages", "aigc-media-tools");
rmSync(mtDir, { recursive: true, force: true });
changed.push(`packages/aigc-media-tools(${copyTree(join(SRC, "packages", "aigc-media-tools"), mtDir)} files)`);

// ── 3. platform-client 内联 ──
const pcSrc = join(SRC, "packages", "platform-client", "src", "index.ts");
const pcBanner =
  "// [迁移内联] 源:aigc-agent packages/platform-client/src/index.ts(原包名 @aigc-agent/platform-client,\n" +
  "// 单文件零依赖,aigc 专属胶水故不上提 workspace 包)。由 scripts/sync-from-aigc-agent.mjs 覆盖,勿手改。\n";
writeFileSync(join(exampleDir, "platform-client.ts"), pcBanner + readFileSync(pcSrc, "utf8"));
changed.push("examples/aigc-agent/platform-client.ts(内联)");

// ── 变换 A:platform-client import 重写(agent 根层 *.ts)──
let rewrites = 0;
for (const e of readdirSync(exampleDir, { withFileTypes: true })) {
  if (!e.isFile() || !e.name.endsWith(".ts") || e.name === "platform-client.ts") continue;
  const f = join(exampleDir, e.name);
  const before = readFileSync(f, "utf8");
  transform(f, [
    {
      find: 'from "@aigc-agent/platform-client"',
      replace: 'from "./platform-client.js"',
      required: false,
    },
  ]);
  if (readFileSync(f, "utf8") !== before) rewrites += 1;
}
if (rewrites === 0) {
  warnings.push("变换 A 零命中:源侧可能已不再 import @aigc-agent/platform-client,请人工确认");
}
changed.push(`变换 A:platform-client import 重写 ${rewrites} 文件`);

// ── 4+5. 壳层工作区(WorkspacePanel 体系)→ .pi/web/workspace/ ──
// 源壳层"不可移植"的唯一原因是 @/ import 指向壳层目录;整体搬入 agent 自带 .pi/web 后,
// 经变换 C 改相对路径即可移植(依赖仅 @blksails/* + zustand + react-query,root 已声明)。
const wsDir = join(exampleDir, ".pi", "web", "workspace");
mkdirSync(join(wsDir, "lib"), { recursive: true });

const WS_COMPONENTS = [
  "workspace-panel",
  "workspace-modules",
  "workspace-launcher",
  "material-drawer",
  "search-panel",
  "sandbox-module-frame",
  "distribute-dialog",
  "folder-picker-dialog",
  "image-lightbox",
  "query-provider",
];
const WS_LIBS = [
  ["lib/workspace", "module-registry.ts"],
  ["lib/workspace", "layout-tree.ts"],
  ["lib/workspace", "workspace-store.ts"],
  ["lib/workspace", "search-query-store.ts"],
  ["lib/workspace", "iframe-rpc.ts"],
  ["lib/stores", "material-drawer-store.ts"],
  ["lib/app", "material-drop-cache.ts"],
];

/** 变换 C:@/ import → 相对路径(layer: "root"=workspace/ 根层, "lib"=workspace/lib/ 层)。 */
function rewriteWsImports(text, layer, fileLabel) {
  const rules =
    layer === "root"
      ? [
          [/from "@\/components\/([\w-]+)"/g, 'from "./$1.js"'],
          [/from "@\/lib\/workspace\/([\w-]+)"/g, 'from "./lib/$1.js"'],
          [/from "@\/lib\/stores\/([\w-]+)"/g, 'from "./lib/$1.js"'],
          [/from "@\/lib\/app\/([\w-]+)"/g, 'from "./lib/$1.js"'],
          [/from "@\/agents\/aigc\/\.pi\/web\/([\w-]+)"/g, 'from "../$1.js"'],
        ]
      : [
          [/from "@\/lib\/workspace\/([\w-]+)"/g, 'from "./$1.js"'],
          [/from "@\/lib\/stores\/([\w-]+)"/g, 'from "./$1.js"'],
          [/from "@\/lib\/app\/([\w-]+)"/g, 'from "./$1.js"'],
        ];
  for (const [re, rep] of rules) text = text.replace(re, rep);
  if (/"@\//.test(text)) {
    warnings.push(`变换 C 残留 @/ import:${fileLabel} ——源新增了本脚本未映射的壳层依赖,须扩充清单/映射`);
  }
  return text;
}

let wsCount = 0;
for (const name of WS_COMPONENTS) {
  const src = join(SRC, "components", `${name}.tsx`);
  if (!existsSync(src)) {
    warnings.push(`壳层组件缺失:components/${name}.tsx 源侧不存在——源结构已变,须更新清单`);
    continue;
  }
  const banner = `// [迁移壳层] 源:aigc-agent components/${name}.tsx。由 scripts/sync-from-aigc-agent.mjs 覆盖,勿手改。\n`;
  writeFileSync(
    join(wsDir, `${name}.tsx`),
    banner + rewriteWsImports(readFileSync(src, "utf8"), "root", `workspace/${name}.tsx`),
  );
  wsCount += 1;
}
for (const [dir, file] of WS_LIBS) {
  const src = join(SRC, dir, file);
  if (!existsSync(src)) {
    warnings.push(`壳层 lib 缺失:${dir}/${file} 源侧不存在——源结构已变,须更新清单`);
    continue;
  }
  const banner = `// [迁移壳层] 源:aigc-agent ${dir}/${file}。由 scripts/sync-from-aigc-agent.mjs 覆盖,勿手改。\n`;
  writeFileSync(
    join(wsDir, "lib", file),
    banner + rewriteWsImports(readFileSync(src, "utf8"), "lib", `workspace/lib/${file}`),
  );
  wsCount += 1;
}
changed.push(`.pi/web/workspace/(壳层工作区 ${wsCount} 文件,变换 C import 重写)`);

// ── 6. 沙箱模块静态页 ──
const sbSrc = join(SRC, "public", "sandbox", "preview.html");
if (existsSync(sbSrc)) {
  mkdirSync(join(DST, "public", "sandbox"), { recursive: true });
  cpSync(sbSrc, join(DST, "public", "sandbox", "preview.html"));
  changed.push("public/sandbox/preview.html(沙箱模块静态页)");
} else {
  warnings.push("public/sandbox/preview.html 源侧不存在——沙箱模块将 404,人工复核");
}

// ── 7. 变换 D:globals.css → .pi/web/aigc-shell.css ──
// 源壳层样式含全部 aigc-*/cv-* 类与调色板 token(scope 到 .aigc-shell)。pi-web 宿主里没有
// .aigc-shell 容器,token 组追加 .aigc-embed(host-adapter 的包装 div);头部 @import 宿主
// src/globals.css 已引(重复注入),@tailwind 指令会与宿主 tailwind 冲突,均去除;裸 html/body
// 全局规则改成死选择器中和(宿主自管文档级样式)。多余的壳层规则(topbar/rail 等)选择器
// 挂在 pi-web 不存在的类上,死规则无害,不逐段裁剪(保持与源 diff 最小)。
{
  const cssSrc = join(SRC, "app", "globals.css");
  // 源文件是 CRLF;锚点与写出统一 LF(pi-web 仓库惯例,也避免 git diff 噪音)。
  let css = readFileSync(cssSrc, "utf8").replace(/\r\n/g, "\n");
  const cssEdits = [
    {
      find: '@import "@blksails/pi-web-ui/styles.css";\n',
      replace: "",
      required: true,
      label: "D1 ui styles @import",
    },
    {
      find: '@import "@blksails/pi-web-canvas-ui/styles.css";\n',
      replace: "",
      required: true,
      label: "D2 canvas-ui styles @import",
    },
    {
      find: "@tailwind base;\n@tailwind components;\n@tailwind utilities;\n",
      replace: "",
      required: true,
      label: "D3 tailwind 指令",
    },
    {
      find: "html,\nbody {\n  height: 100%;",
      replace: ".aigc-dead-global-a { /* [pi-web 适配] 壳层 html/body 全局规则中和(宿主自管) */\n  height: 100%;",
      required: true,
      label: "D4 裸 html/body 块",
    },
    {
      find: "body {\n  background-color: hsl(var(--background));",
      replace: ".aigc-dead-global-b { /* [pi-web 适配] 同上 */\n  background-color: hsl(var(--background));",
      required: true,
      label: "D5 裸 body 块",
    },
    {
      find: ".aigc-shell,\n.aigc-asset-pop,\n.aigc-dist-backdrop,\n.aigc-folder-picker {\n  --bg: #ffffff;",
      replace: ".aigc-embed,\n.aigc-shell,\n.aigc-asset-pop,\n.aigc-dist-backdrop,\n.aigc-folder-picker {\n  --bg: #ffffff;",
      required: true,
      label: "D6 token 组 .aigc-embed(light)",
    },
    {
      find: ":root.dark .aigc-shell,\n:root.dark .aigc-asset-pop,",
      replace: ":root.dark .aigc-embed,\n:root.dark .aigc-shell,\n:root.dark .aigc-asset-pop,",
      required: true,
      label: "D7 token 组 .aigc-embed(dark)",
    },
  ];
  for (const { find, replace, required, label } of cssEdits) {
    if (css.includes(find)) css = css.replaceAll(find, replace);
    else if (required)
      warnings.push(`锚点丢失(${label}):globals.css 未找到「${find.slice(0, 48)}…」——源样式结构已变,须人工复核`);
  }
  const cssBanner =
    "/* [迁移壳层] 源:aigc-agent app/globals.css(变换 D:去 @import/@tailwind 头 + 全局规则中和\n" +
    "   + token 组追加 .aigc-embed 作用域)。由 scripts/sync-from-aigc-agent.mjs 覆盖,勿手改。 */\n";
  const cssTail = `
/* ═══ [pi-web 适配追加] 以下为 sync 脚本生成,不在源 globals.css 中 ═══ */
/* sidebarLeft 槽的工作区导轨容器(源壳层由 rail grid 列定宽;pi-web 由本容器定宽)。 */
.aigc-embed-rail {
  width: 210px;
  height: 100%;
  padding: 12px 10px;
  box-sizing: border-box;
  overflow-y: auto;
  border-right: 1px solid var(--border, #e5e5e7);
  background: var(--surface, #fff);
}
`;
  writeFileSync(join(exampleDir, ".pi", "web", "aigc-shell.css"), cssBanner + css + cssTail);
  changed.push(".pi/web/aigc-shell.css(变换 D)");
}

// ── 8. host-adapter.tsx 生成(pi-web 宿主适配层)──
{
  const adapter = `// [迁移生成] pi-web 宿主适配层。由 scripts/sync-from-aigc-agent.mjs 生成,勿手改。
//
// 源壳层在 app 根提供的环境,pi-web 宿主里由本层自包:
//  1. QueryProvider —— MaterialDrawer 等依赖 react-query,宿主无全局 QueryClient;
//  2. .aigc-embed —— 调色板 token 作用域(见 aigc-shell.css 变换 D;display:contents 不破坏布局);
//  3. dialogLayer 组合 —— SkillPanel(技能管理 modal)+ SearchCommandPalette(搜图浮层);
//  4. sidebarLeft —— WorkspaceRailSection(「＋ 添加模块」/ 搜索入口)。
import * as React from "react";
import "../aigc-shell.css";
import { QueryProvider } from "./query-provider.js";
import { WorkspacePanel } from "./workspace-panel.js";
import { SkillPanel } from "../skill-panel.js";
import {
  SearchCommandPalette,
  WorkspaceRailSection,
} from "./workspace-launcher.js";

export function AigcWorkspacePanel(
  props: React.ComponentProps<typeof WorkspacePanel>,
): React.JSX.Element {
  return (
    <div className="aigc-embed" style={{ display: "contents" }}>
      <QueryProvider>
        <WorkspacePanel {...props} />
      </QueryProvider>
    </div>
  );
}

export function AigcDialogLayer(
  props: React.ComponentProps<typeof SkillPanel>,
): React.JSX.Element {
  return (
    <div className="aigc-embed" style={{ display: "contents" }}>
      <SkillPanel {...props} />
      <SearchCommandPalette />
    </div>
  );
}

export function AigcWorkspaceRail(): React.JSX.Element {
  return (
    <div className="aigc-embed aigc-embed-rail">
      <QueryProvider>
        <WorkspaceRailSection />
      </QueryProvider>
    </div>
  );
}
`;
  writeFileSync(join(wsDir, "host-adapter.tsx"), adapter);
  changed.push(".pi/web/workspace/host-adapter.tsx(生成)");
}

// ── 变换 B:web.config.tsx 壳层 import 改指向迁移后的 workspace/(三槽接入)──
const webConfig = join(exampleDir, ".pi", "web", "web.config.tsx");
if (existsSync(webConfig)) {
  transform(webConfig, [
    {
      find: 'import "@/components/workspace-modules";',
      replace: 'import "./workspace/workspace-modules.js"; // [迁移变换 B] 壳层路径→迁移后 workspace/(副作用注册,须在容器 import 前)',
      required: true,
      label: "B1 workspace-modules 副作用 import",
    },
    {
      find: 'import { WorkspacePanel } from "@/components/workspace-panel";',
      replace:
        'import {\n  AigcDialogLayer,\n  AigcWorkspacePanel,\n  AigcWorkspaceRail,\n} from "./workspace/host-adapter.js"; // [迁移变换 B] 经宿主适配层接入(QueryProvider 自包 + 三槽)',
      required: true,
      label: "B2 WorkspacePanel import",
    },
    {
      find: 'import { SkillPanel } from "./skill-panel.js";\n',
      replace: "",
      required: true,
      label: "B3 SkillPanel import(转由 host-adapter 引)",
    },
    {
      find: "dialogLayer: SkillPanel as never,",
      replace: "dialogLayer: AigcDialogLayer as never,",
      required: true,
      label: "B4 dialogLayer 槽位",
    },
    {
      find: "panelRight: WorkspacePanel as never,",
      replace: "panelRight: AigcWorkspacePanel as never,\n    sidebarLeft: AigcWorkspaceRail as never,",
      required: true,
      label: "B5 panelRight/sidebarLeft 槽位",
    },
  ]);
  changed.push("变换 B:web.config.tsx 三槽接入 workspace/host-adapter");
} else {
  warnings.push(".pi/web/web.config.tsx 不存在——源结构已变,人工复核");
}

// ── 汇报 ──
console.log("同步完成:");
for (const c of changed) console.log("  ✔ " + c);
if (warnings.length > 0) {
  console.log("\n⚠ 告警(须人工处理):");
  for (const w of warnings) console.log("  ⚠ " + w);
  process.exitCode = 2;
} else {
  console.log("\n下一步:git diff 审阅 → 跑验证(typecheck/build:client/冒烟)→ 提交。");
}
// 提醒:media-tools/壳层若在源侧新增了 npm 依赖,须检查本仓库 root package.json 是否需要
// 补声明(examples 经 root node_modules 解析;当前壳层需 zustand + @tanstack/react-query)。
