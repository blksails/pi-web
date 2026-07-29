import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  ALLOWED_EDGES,
  KNOWN_DEBT,
  isReverseEdge,
  layerOf,
  moduleNameOf,
  type Layer,
} from "./module-roster.js";
import {
  PACKAGE_ROOTS,
  assertEveryRootContributed,
  exportsMapOf,
  hasSrcWildcard,
  type PackageRoot,
} from "./package-roots.js";

/**
 * 依赖方向守卫(spec: kernel-boundary-decoupling 任务 1.2;core-package-extraction 任务 2.2 改为跨包)。
 *
 * 断言本仓各包的 `src/` 之间不存在**跨层反向依赖** —— 即依赖方向对
 * neutral / core / {runner, adapters} / assembly 的分层已经成立。
 * 守卫转绿 = 「可以搬文件了」;拆包之后它继续守着「不许再搬回去」。
 *
 * ★ 只看**直接**导入,不做传递分析。传递分析已被上游 spec 实测证伪:barrel 把整个模块图
 *   拉进来,198 个候选中 116 个(59%)误报。跨层边是**声明**层面的事实,直接导入足以判定。
 *
 * ★ 区分值导入与 `import type`:类型在编译期擦除,跨包 `import type` 合法。
 *   不区分的话 `capability → auth` 这条合法边会被误报。
 *
 * ★ **跨包 specifier 一并解析**(R4.4)。拆包后 `../auth/x.js` 会写成
 *   `@blksails/pi-web-server/...`,若只认相对路径,一次搬迁就能让所有跨层边**集体消失**,
 *   守卫从此永远绿。那是本守卫最容易出现、也最难察觉的失效方式。
 *
 * 本文件跑在 fast 档:只读文件,不起子进程、不写盘。
 */

interface CrossEdge {
  readonly fromRoot: string;
  readonly fromModule: string;
  readonly toModule: string;
  readonly fromLayer: Layer;
  readonly toLayer: Layer;
  readonly file: string;
  readonly line: number;
  readonly typeOnly: boolean;
}

function walk(dir: string, base: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, base, out);
    else if (entry.name.endsWith(".ts")) out.push(path.relative(base, full));
  }
  return out;
}

/**
 * 匹配一条 import/export ... from "spec" 语句。
 *
 * ★ 必须跨行匹配。本仓库大量导入写成多行:
 *     import {
 *       deriveTemplateName,
 *     } from "../sandbox-image/template-name.js";
 *   按行扫描会**整条漏掉**它们 —— 实测:逐行版本漏报了 rpc-channel→sandbox-image 与
 *   runner→auth 这两条已知边,只报出单行写法的那些。一个会漏报的守卫比没有守卫更坏,
 *   因为它会让人以为「照清单修完就干净了」。
 *
 *   `[^;]*?` 跨行且在分号处止步 —— import 语句的 `from` 之前不会出现分号。
 */
const IMPORT_RE = /(?:^|\n)[ \t]*(?:import|export)[ \t]+(type[ \t]+)?[^;]*?from[ \t]*["']([^"']+)["']/g;

/**
 * 动态导入 `import("...")`。
 * ★ 必须一并扫:否则「把静态 import 改成动态 import」就成了绕过守卫的后门,
 *   而依赖关系一点没变。运行期组合是**合法手段**,但必须走 ALLOWED_EDGES 显式登记,
 *   不能靠守卫看不见蒙混过去。
 */
const DYNAMIC_IMPORT_RE = /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g;

/** 跨包**具名**子路径 specifier → 目标模块。由各包 `exports` 声明推导,不靠子路径名猜。 */
const CROSS_PACKAGE_TARGETS = new Map<string, { root: PackageRoot; module: string }>();
/** 声明了 `src/` 通配子路径的包 —— 其深路径 specifier 按前缀剥离解析。 */
const WILDCARD_ROOTS = PACKAGE_ROOTS.filter(hasSrcWildcard);
for (const root of PACKAGE_ROOTS) {
  for (const [specifier, srcRel] of exportsMapOf(root)) {
    CROSS_PACKAGE_TARGETS.set(specifier, { root, module: moduleNameOf(srcRel) });
  }
}

/**
 * 通配子路径的解析:`@blksails/pi-web-core/http/routes/x.js` → `{ core, "http" }`。
 *
 * ★ 这条路径**必须**存在,否则拆包后所有深路径跨包引用都被守卫当作"外部依赖"跳过 ——
 *   于是一次搬迁就让全部跨层边集体消失,守卫从此永远绿。这是本守卫最难察觉的失效方式。
 */
function resolveWildcard(specifier: string): { root: PackageRoot; module: string } | undefined {
  for (const root of WILDCARD_ROOTS) {
    const prefix = `${root.packageName}/`;
    if (!specifier.startsWith(prefix)) continue;
    return { root, module: moduleNameOf(specifier.slice(prefix.length)) };
  }
  return undefined;
}

/** 把 specifier 解析成 `{ 包根, 模块名 }`;不指向本仓包时返回 undefined。 */
function resolveTarget(
  root: PackageRoot,
  fromRel: string,
  specifier: string,
): { root: PackageRoot; module: string } | undefined {
  if (specifier.startsWith(".")) {
    const srcDir = path.join(root.dir, "src");
    const abs = path.resolve(path.dirname(path.join(srcDir, fromRel)), specifier);
    const rel = path.relative(srcDir, abs);
    return rel.startsWith("..") ? undefined : { root, module: moduleNameOf(rel) };
  }
  return CROSS_PACKAGE_TARGETS.get(specifier) ?? resolveWildcard(specifier);
}

/** 收集单个文件里所有指向**别的顶层模块**的导入(含跨包)。 */
function crossModuleImports(root: PackageRoot, fileRel: string): CrossEdge[] {
  const source = fs.readFileSync(path.join(root.dir, "src", fileRel), "utf8");
  const fromModule = moduleNameOf(fileRel);
  const out: CrossEdge[] = [];

  const scan = (re: RegExp, specIndex: number, typeIndex: number): void => {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(source)) !== null) {
      const target = resolveTarget(root, fileRel, m[specIndex]!);
      if (target === undefined) continue;
      // 同包同模块内部的导入不是跨模块边。跨包时即便模块同名也是两个模块(如 index)。
      if (target.root.name === root.name && target.module === fromModule) continue;
      out.push({
        fromRoot: root.name,
        fromModule,
        toModule: target.module,
        fromLayer: layerOf(fromModule, root.name),
        toLayer: layerOf(target.module, target.root.name),
        file: `${root.name}/src/${fileRel}`,
        line: source.slice(0, m.index).split("\n").length,
        typeOnly: typeIndex > 0 && m[typeIndex] !== undefined,
      });
    }
  };
  scan(IMPORT_RE, 2, 1);
  scan(DYNAMIC_IMPORT_RE, 1, 0);
  return out;
}

function isDebt(edge: CrossEdge): boolean {
  return KNOWN_DEBT.some((d) => d.from === edge.fromModule && d.to === edge.toModule);
}

function isExempt(edge: CrossEdge): boolean {
  return ALLOWED_EDGES.some(
    (a) =>
      a.from === edge.fromModule &&
      a.to === edge.toModule &&
      // 豁免声明为 typeOnly 时,只对 `import type` 成立;同一对模块的值导入仍要拦。
      (!a.typeOnly || edge.typeOnly),
  );
}

const fileCounts = new Map<string, number>();
const allEdges: CrossEdge[] = [];
for (const root of PACKAGE_ROOTS) {
  const srcDir = path.join(root.dir, "src");
  const files = fs.existsSync(srcDir) ? walk(srcDir, srcDir).sort() : [];
  fileCounts.set(root.name, files.length);
  for (const rel of files) allEdges.push(...crossModuleImports(root, rel));
}

const reverseValueEdges = allEdges.filter(
  (e) => isReverseEdge(e.fromLayer, e.toLayer) && !e.typeOnly && !isExempt(e),
);
const violations = reverseValueEdges.filter((e) => !isDebt(e));
const debtEdges = reverseValueEdges.filter(isDebt);
// 欠债边同样要排除 —— 它已在 KNOWN_DEBT 里登记过,不必再在纯类型表里重复要求登记。
const typeOnlyReverse = allEdges.filter(
  (e) => isReverseEdge(e.fromLayer, e.toLayer) && e.typeOnly && !isExempt(e) && !isDebt(e),
);

function render(edges: readonly CrossEdge[]): string {
  const byPair = new Map<string, CrossEdge[]>();
  for (const e of edges) {
    const key = `${e.fromModule}(${e.fromLayer}) → ${e.toModule}(${e.toLayer})`;
    if (!byPair.has(key)) byPair.set(key, []);
    byPair.get(key)!.push(e);
  }
  return [...byPair.entries()]
    .map(([pair, list]) => `  ${pair}\n${list.map((e) => `      ${e.file}:${e.line}`).join("\n")}`)
    .join("\n");
}

describe("依赖方向守卫 —— 各包 src/ 之间不得有跨层反向依赖", () => {
  it("不存在跨层反向的值依赖", () => {
    expect(
      violations.length,
      `发现跨层反向依赖(切包后会变成循环或反向依赖):\n${render(violations)}\n` +
        `修复方式:归位(把放错层的模块移到正确位置)或依赖倒置(下层定契约、上层实现并注入)。` +
        `若确属合法,须在 ALLOWED_EDGES 中显式豁免并写出理由。`,
    ).toBe(0);
  });

  it("跨层的纯类型依赖必须显式豁免 —— 合法但要写下来", () => {
    expect(
      typeOnlyReverse.map((e) => `${e.fromModule} → ${e.toModule} @ ${e.file}:${e.line}`),
      `以下跨层 import type 未在 ALLOWED_EDGES 中登记。它们在编译期擦除、切包后合法,` +
        `但必须写出来 —— 否则下一个人分不清「有意为之」与「漏网」。`,
    ).toEqual([]);
  });

  it("已知欠债只减不增 —— 每条实际存在的欠债边都必须已登记", () => {
    // 反向断言:登记表里的条目若已不存在,说明债还清了,应当把它从表里删掉。
    const stale = KNOWN_DEBT.filter(
      (d) => !debtEdges.some((e) => e.fromModule === d.from && e.toModule === d.to),
    ).map((d) => `${d.from} → ${d.to}`);

    expect(
      stale,
      `KNOWN_DEBT 里有已不存在的欠债:${stale.join(", ")}。债还清了就把条目删掉,` +
        `否则这张表会变成一张没人看的旧账。`,
    ).toEqual([]);
  });

  it("每个包根都被真的扫到了(R4.3:空扫必须失败,不得静默通过)", () => {
    // ★ 这条是本守卫最重要的自证。见 package-roots.ts 的说明:
    //   扫不到文件的守卫报出的绿,和真的没有违规长得一模一样。
    expect(() => assertEveryRootContributed(fileCounts, "源文件")).not.toThrow();
    // 名册覆盖:layerOf 对未知模块抛错,故扫描本身没抛即为覆盖完整。
    expect(allEdges.length).toBeGreaterThan(0);
  });
});
