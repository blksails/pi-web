#!/usr/bin/env node
/**
 * sync-from-aigc-agent — 从源仓库 aigc-agent 同步「基础波」迁移面到本仓库(幂等,可重跑)。
 *
 * 背景:C:/workcode/aigc-agent 仍在持续迭代;基础波迁移面 = agent 定义 + 可复用媒体工具包。
 * 每次源侧有改动,重跑本脚本即得干净 diff(git 审阅后提交)。详见 docs/aigc-agent-migration.md。
 *
 * 同步面(源 → 本仓库):
 *  1. agents/aigc/**            → examples/aigc-agent/        (agent 定义 + .pi/web)
 *  2. packages/aigc-media-tools → packages/aigc-media-tools   (上提的 workspace 包,原名 @aigc-agent/media-tools)
 *  3. packages/platform-client/src/index.ts → examples/aigc-agent/platform-client.ts(内联,单文件零依赖)
 *
 * 定点变换(仅两处,锚点丢失即告警,勿静默):
 *  A. examples/aigc-agent/*.ts:`from "@aigc-agent/platform-client"` → `from "./platform-client.js"`
 *  B. .pi/web/web.config.tsx:宿主壳专属 WorkspacePanel(不可移植,源码注释自述)→ 可移植 AigcCanvasPanel:
 *     - 删除 `import "@/components/workspace-modules";`
 *     - `import { WorkspacePanel } from "@/components/workspace-panel";` → `import { AigcCanvasPanel } from "./canvas-panel.js";`
 *     - `panelRight: WorkspacePanel as never` → `panelRight: AigcCanvasPanel as never`
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

// ── 变换 B:web.config.tsx panelRight 换可移植面板 ──
const webConfig = join(exampleDir, ".pi", "web", "web.config.tsx");
if (existsSync(webConfig)) {
  transform(webConfig, [
    {
      find: 'import "@/components/workspace-modules";\n',
      replace: "",
      required: true,
      label: "B1 workspace-modules 副作用 import",
    },
    {
      find: 'import { WorkspacePanel } from "@/components/workspace-panel";',
      replace: 'import { AigcCanvasPanel } from "./canvas-panel.js"; // [迁移变换 B] 宿主壳 WorkspacePanel 不可移植→可移植纯画布',
      required: true,
      label: "B2 WorkspacePanel import",
    },
    {
      find: "panelRight: WorkspacePanel as never",
      replace: "panelRight: AigcCanvasPanel as never",
      required: true,
      label: "B3 panelRight 槽位",
    },
  ]);
  changed.push("变换 B:web.config.tsx panelRight → AigcCanvasPanel");
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
// 提醒:media-tools 若在源侧新增了依赖,须同步 packages/aigc-media-tools/package.json 之外
// 再检查本仓库 root package.json 是否需要补声明(examples 经 root node_modules 解析)。
