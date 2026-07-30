/**
 * 被守卫扫描的**包根名册**(spec: core-package-extraction 任务 2.2;
 * runner-package-extraction 任务 2.1 加入第三个包根;
 * adapters-package-extraction 任务 2.1 加入第四个包根)。
 *
 * 内核提取把 `packages/server` 切成 core / runner / adapters 三包,
 * 加上仍作为装配方的兼容层 server,名册共四项。
 * 三个既有守卫(依赖方向、分档、包依赖审计)必须继续覆盖**全部**模块与测试,否则边界会在
 * 搬迁中悄悄腐化 —— 而腐化的症状恰恰是「守卫还是绿的」。
 *
 * ★ 本文件住在 core 而非 server:core 是更低的包,server 引用它方向正确;
 *   反过来会让 core 的测试依赖 server,正是要根除的东西。
 *
 * ★ **每个包根都必须至少贡献一个文件**(见三个守卫里的 `assertEveryRootContributed`)。
 *   这条断言不是洁癖:上游 spec 已经被「没装上的守卫」骗过两次 ——
 *   **扫不到文件的守卫报出的绿,和真的没有违规长得一模一样**。
 *   路径写错、包被改名、目录被搬走,都只会让扫描结果变空而不会报错。
 *
 * ★ 守卫必须**先于**搬迁装上,于是名册里会出现「已成立但还没填充」的包根。
 *   这类包根用 `pendingContributions` 按维度声明,语义是**必须为空**(不是"可以为空") ——
 *   见该字段与 `assertRootsContributed` 的说明。名册自身的守卫在 `package-roots.test.ts`。
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * 守卫扫描的**维度**。每个维度对应一次 `assertEveryRootContributed` 调用。
 *
 * ★ 是**类型化的键**而非自由字符串:`pendingContributions` 要按维度声明豁免,
 *   写错的维度名必须由类型检查当场拦下,而不是变成一条永远匹配不上的死豁免。
 */
export type ContributionKind = "srcModules" | "srcFiles" | "testFiles";

/** 维度的人话名字,只用于错误消息。 */
const CONTRIBUTION_LABEL: Record<ContributionKind, string> = {
  srcModules: "顶层模块",
  srcFiles: "源文件",
  testFiles: "测试文件",
};

export interface PackageRoot {
  /** 短名,只用于报错时指认是哪个包根。 */
  readonly name: string;
  /** 包根绝对路径(含 `package.json` 的那一层)。 */
  readonly dir: string;
  /** npm 包名,用于把跨包 import specifier 解析回本仓某个包。 */
  readonly packageName: string;
  /**
   * **尚未填充**的维度 —— 该包已成立(有 `package.json`)但对应目录里还没有文件。
   *
   * ★ 这不是"放宽判据",而是把判据**翻转**:声明为 pending 的维度,该包根必须扫到
   *   **恰好 0 个**文件;一旦搬进第一个文件,`assertRootsContributed` 立刻报红并要求
   *   删掉这个标记。于是两条约束在任何时刻都恰有一条生效 ——
   *   pending 时"必须为空",非 pending 时"必须非空",**没有一刻是无人看管的**。
   *   豁免因此不可能被遗忘:它只能通过让守卫变红来退场。
   *
   * ★ 维度分开声明是必要的:实现与测试在不同任务里搬(spec runner-package-extraction
   *   的 3.1 与 3.3),用单个布尔标记会让 3.1 之后、3.3 之前的测试维度凭空变红。
   */
  readonly pendingContributions?: readonly ContributionKind[];
}

const coreDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const packagesDir = path.dirname(coreDir);

export const PACKAGE_ROOTS: readonly PackageRoot[] = [
  { name: "core", dir: coreDir, packageName: "@blksails/pi-web-core" },
  { name: "server", dir: path.join(packagesDir, "server"), packageName: "@blksails/pi-web-server" },
  // spec runner-package-extraction:任务 3.1 搬入 `src/`、任务 3.3 搬入 `test/` 之后,
  // 三个维度(`srcModules` / `srcFiles` / `testFiles`)的 pending 全部过期删除 ——
  // 守卫由此对 runner 恢复「每个维度都必须非空」的严格判据,与 core / server 同待遇。
  { name: "runner", dir: path.join(packagesDir, "runner"), packageName: "@blksails/pi-web-runner" },
  // spec adapters-package-extraction:守卫必须**先于**搬迁扩到四包(见 tasks.md 开头的次序约束),
  // 故 2.1 建立本条时三个维度全部声明 pending,语义是**必须恰好为空**。
  // 任务 3.1 搬入 `src/` 后 `srcModules` / `srcFiles` 两个维度的 pending 被
  // `assertRootsContributed` 判为「豁免过期」而删除;任务 3.2 搬入 `test/` 的 57 个文件后
  // 同一装置又逼着删掉最后的 `testFiles` —— 至此四包全部落在同一条严格判据下
  // (每个维度都必须非空),名册里**一个 pending 豁免都不剩**。
  { name: "adapters", dir: path.join(packagesDir, "adapters"), packageName: "@blksails/pi-web-adapters" },
];

/**
 * 由包的 `exports` 声明得到「import specifier → 相对 src 的文件路径」映射。
 *
 * ★ 不能靠子路径名猜模块名:`./model-options` 指向的是 `src/config/model-options.ts`
 *   (模块是 `config`,不是 `model-options`),`./testing` 指向 `src/workspace/testing/index.ts`。
 *   按名字猜会得出两个并不存在的模块,而 `layerOf` 对未知模块抛错 —— 表现为守卫在
 *   完全无关的地方炸掉,极难归因。故直接读声明。
 */
export function exportsMapOf(root: PackageRoot): ReadonlyMap<string, string> {
  const pkgPath = path.join(root.dir, "package.json");
  if (!fs.existsSync(pkgPath)) {
    // 裸 ENOENT 会以「模块加载失败」的形态炸掉整个守卫文件,读的人得先猜是哪一步坏了。
    throw new Error(
      `包根 "${root.name}" 下没有 package.json:${pkgPath}\n` +
        `PACKAGE_ROOTS 里的路径已失效(包被改名或搬走?)。不要删掉这个包根 —— ` +
        `少一个包根就少守一个包,而守卫照样报绿。`,
    );
  }
  const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8")) as {
    exports?: Record<string, string>;
  };
  const out = new Map<string, string>();
  for (const [subpath, target] of Object.entries(pkg.exports ?? {})) {
    // 通配子路径(`"./*.js": "./src/*.ts"`)不进具名表 —— 它匹配的是**任意**深路径,
    // 塞进 Map 会得到一个键为 `.../*.js` 的条目,`moduleNameOf` 拿它算出模块名 `*`,
    // 而 `layerOf("*")` 抛错。见 `hasSrcWildcard`:通配由前缀剥离处理。
    if (subpath.includes("*")) continue;
    // ★ 只收指向 `src/` 的目标。runner 包导出了一条 `"./runner-bootstrap.mjs"` ——
    //   它是包根部的引导脚本,**不是** src 模块。不剥掉的话 `moduleNameOf("./runner-bootstrap.mjs")`
    //   会算出模块名 `"."`,而 `layerOf(".")` 抛错 —— 表现为守卫在毫不相干的地方炸掉。
    //   (core / server 的具名子路径全部指向 `./src/`,故这一条对既有包根零影响。)
    if (!target.startsWith("./src/")) continue;
    const specifier =
      subpath === "." ? root.packageName : `${root.packageName}${subpath.slice(1)}`;
    // "./src/trust/index.ts" → "trust/index.ts"
    out.set(specifier, target.replace(/^\.\/src\//, ""));
  }
  return out;
}

/**
 * 该包是否声明了指向 `src/` 的**通配子路径**(如 `"./*.js": "./src/*.ts"`)。
 *
 * core 需要它:兼容层包有 51 个不同的深路径目标要引用(`http/routes/*`、
 * `attachment-bridge/*` 等大多**刻意不在**主入口导出),逐条列具名子路径既维护不动,
 * 也会把"跨仓公开 API"和"同仓装配方的内部通路"混为一谈。
 *
 * ★ 通配**不等于**放弃封装:对跨仓消费方,公开面仍是那几个具名子路径;
 *   真正挡住依赖污染的是包的 `dependencies` 声明与依赖方向守卫,不是导出面的窄。
 */
export function hasSrcWildcard(root: PackageRoot): boolean {
  const pkgPath = path.join(root.dir, "package.json");
  if (!fs.existsSync(pkgPath)) return false;
  const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8")) as {
    exports?: Record<string, string>;
  };
  return Object.entries(pkg.exports ?? {}).some(
    ([sub, target]) => sub.includes("*") && target.startsWith("./src/"),
  );
}

/**
 * 断言名册里每个包根**真的指向本仓的那个包**。
 *
 * ★ 为什么单独一条:`pendingContributions` 允许某个维度扫到 0 个文件,而**路径写错**
 *   同样表现为扫到 0 个文件。两者若不加区分,豁免就成了路径笔误的藏身处 ——
 *   这正是「没装上的守卫报出的绿」。故豁免的前提是:包根本身可解析,且 `package.json`
 *   里的包名与名册声明的**逐字相同**(仅查目录存在还不够 —— 指到隔壁包也会"存在")。
 */
export function assertRootsResolvable(roots: readonly PackageRoot[] = PACKAGE_ROOTS): void {
  const broken: string[] = [];
  for (const root of roots) {
    const pkgPath = path.join(root.dir, "package.json");
    if (!fs.existsSync(pkgPath)) {
      broken.push(`  · ${root.name} —— ${pkgPath} 不存在(包被改名或目录被搬走?)`);
      continue;
    }
    const actual = (JSON.parse(fs.readFileSync(pkgPath, "utf8")) as { name?: string }).name;
    if (actual !== root.packageName) {
      broken.push(
        `  · ${root.name} —— ${pkgPath} 里的包名是 "${actual}",名册声明的是 "${root.packageName}"`,
      );
    }
  }
  if (broken.length === 0) return;
  throw new Error(
    `以下包根无法解析到本仓的对应包,守卫对它们实际上什么都没在守:\n${broken.join("\n")}\n` +
      `路径失效的症状与「真的没有违规」长得一模一样。请修路径,不要删包根、也不要放宽本断言。`,
  );
}

/**
 * 断言每个包根都在给定维度上贡献了文件。空扫是**最危险的失败形态** —— 它伪装成通过。
 *
 * 两个方向都要拦:
 * - 未声明 pending 的包根扫到 0 个 → 守卫空转,报红。
 * - 声明了 pending 的包根扫到 >0 个 → 豁免已过期,报红并要求删标记。
 *   ★ 后者是豁免的**自毁装置**:没有它,一条为过渡期加的豁免会永久留下,
 *   而「这个包哪天真的变空了」就再也不会响 —— 那才是本函数存在的理由。
 *
 * @param roots 参与判定的包根;默认全量名册(注入是为了让本函数自身可被测试驱动)。
 */
export function assertRootsContributed(
  roots: readonly PackageRoot[],
  counts: ReadonlyMap<string, number>,
  kind: ContributionKind,
): void {
  assertRootsResolvable(roots);
  const what = CONTRIBUTION_LABEL[kind];

  const empty = roots.filter(
    (r) => (counts.get(r.name) ?? 0) === 0 && !(r.pendingContributions ?? []).includes(kind),
  );
  if (empty.length > 0) {
    throw new Error(
      `以下包根扫到了 0 个${what},守卫实际上什么都没在守:\n` +
        empty.map((r) => `  · ${r.name} —— ${r.dir}`).join("\n") +
        `\n扫不到文件的守卫报出的绿,和真的没有违规长得一模一样。` +
        `请检查包根路径、包是否被改名或目录是否被搬走 —— 不要放宽本断言。`,
    );
  }

  const outdated = roots.filter(
    (r) => (r.pendingContributions ?? []).includes(kind) && (counts.get(r.name) ?? 0) > 0,
  );
  if (outdated.length > 0) {
    throw new Error(
      `以下包根声明了「${what}尚未填充」,但实际已经扫到了文件 —— 豁免过期了:\n` +
        outdated
          .map((r) => `  · ${r.name} —— ${counts.get(r.name)} 个${what} @ ${r.dir}`)
          .join("\n") +
        `\n请把 PACKAGE_ROOTS 里该包根的 pendingContributions 中的 "${kind}" 删掉。` +
        `留着它等于让这个包**永久**免于空扫检查 —— 将来它真的变空时就没人会响了。`,
    );
  }
}

/** 对全量名册执行 {@link assertRootsContributed}。 */
export function assertEveryRootContributed(
  counts: ReadonlyMap<string, number>,
  kind: ContributionKind,
): void {
  assertRootsContributed(PACKAGE_ROOTS, counts, kind);
}
