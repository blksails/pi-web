/**
 * 零声明者核验(spec panes-only-right-panel 任务 5.1;Req 1.4/1.5/7.3/7.4)。
 *
 * 删除动作的**机械前置判据**:全仓不存在右侧面板槽键的声明、类型定义与引用。
 * 人工通读在 19 个保留槽键 + 40 余个示例的规模下不可靠,而删错的代价是红构建。
 *
 * 删除完成后本核验**常驻**(接入测试面),防止有人把这个键再加回来。
 *
 * ## 判据形状
 *
 * 扫源码文本里的 `panelRight` 标识符。刻意**不做** AST 分析:
 * 一是简单可靠,二是我们要的正是「连提都不提」这个强性质 —— 注释里残留的引用同样是信号
 * (它意味着有人的心智模型还停在旧机制上)。允许的例外只有本 spec 自己的文档与本文件。
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

/** 要找的槽键标识符。 */
const NEEDLE = "panelRight";

/** 不扫的目录(产物、依赖、版本库内部)。 */
const SKIP_DIRS = new Set([
  "node_modules", ".git", "dist", ".next", "build", "coverage",
  ".pi", "payload", "binaries", "test-results", "playwright-report",
  ".e2e-evidence",
]);

const SCAN_EXT = /\.(ts|tsx|js|jsx|mjs|cjs|json)$/;

/**
 * 允许仍然提及该键的路径。
 *
 * ★ 白名单只装**文档与核验自身**,不装任何产品代码 —— 一旦产品代码进了白名单,
 * 这条核验就退化成了摆设。规划文档必须能提它(否则无法记述这次迁移)。
 */
const ALLOWED = [
  ".kiro/",                              // spec 文档
  "scripts/check-no-panel-right.ts",     // 本文件
  "test/guards/no-panel-right.test.ts",  // 本核验的测试
  "docs/",                               // 设计与历史文档
];

export interface PanelRightHit {
  readonly file: string;
  readonly line: number;
  readonly text: string;
}

function walk(dir: string, root: string, out: string[]): void {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue;
    const full = join(dir, name);
    let st;
    try {
      st = statSync(full);
    } catch {
      continue; // 断掉的符号链接等,跳过而非崩溃
    }
    if (st.isDirectory()) walk(full, root, out);
    else if (SCAN_EXT.test(name)) out.push(full);
  }
}

function isAllowed(rel: string): boolean {
  const normalized = rel.split(sep).join("/");
  return ALLOWED.some((prefix) => normalized.startsWith(prefix));
}

/** 扫描仓库,返回全部残留位置(空数组即通过)。 */
export function findPanelRightDeclarations(repoRoot: string): PanelRightHit[] {
  const files: string[] = [];
  walk(repoRoot, repoRoot, files);
  const hits: PanelRightHit[] = [];
  for (const file of files) {
    const rel = relative(repoRoot, file);
    if (isAllowed(rel)) continue;
    const content = readFileSync(file, "utf8");
    if (!content.includes(NEEDLE)) continue;
    content.split("\n").forEach((text, i) => {
      if (text.includes(NEEDLE)) {
        hits.push({ file: rel.split(sep).join("/"), line: i + 1, text: text.trim().slice(0, 160) });
      }
    });
  }
  return hits;
}

/** 供 CLI 使用:打印残留并以非零码退出。 */
export function reportPanelRight(repoRoot: string): number {
  const hits = findPanelRightDeclarations(repoRoot);
  if (hits.length === 0) {
    // eslint-disable-next-line no-console
    console.log(`[ok] 零声明者:全仓无 ${NEEDLE} 残留`);
    return 0;
  }
  // eslint-disable-next-line no-console
  console.error(`[fail] 仍有 ${hits.length} 处 ${NEEDLE} 残留:`);
  for (const hit of hits) {
    // eslint-disable-next-line no-console
    console.error(`  ${hit.file}:${hit.line}  ${hit.text}`);
  }
  return 1;
}
