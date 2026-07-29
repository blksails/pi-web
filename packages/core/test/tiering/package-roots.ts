/**
 * 被守卫扫描的**包根名册**(spec: core-package-extraction,任务 2.2)。
 *
 * 内核提取把 `packages/server` 切成两个包(后续还要切出 runner 与 adapters)。
 * 两个既有守卫(依赖方向、分档)必须继续覆盖**全部**模块与测试,否则边界会在
 * 接下来的两次搬迁中悄悄腐化 —— 而腐化的症状恰恰是「守卫还是绿的」。
 *
 * ★ 本文件住在 core 而非 server:core 是更低的包,server 引用它方向正确;
 *   反过来会让 core 的测试依赖 server,正是要根除的东西。
 *
 * ★ **每个包根都必须至少贡献一个文件**(见两个守卫里的 `assertEveryRootContributed`)。
 *   这条断言不是洁癖:上游 spec 已经被「没装上的守卫」骗过两次 ——
 *   **扫不到文件的守卫报出的绿,和真的没有违规长得一模一样**。
 *   路径写错、包被改名、目录被搬走,都只会让扫描结果变空而不会报错。
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export interface PackageRoot {
  /** 短名,只用于报错时指认是哪个包根。 */
  readonly name: string;
  /** 包根绝对路径(含 `package.json` 的那一层)。 */
  readonly dir: string;
  /** npm 包名,用于把跨包 import specifier 解析回本仓某个包。 */
  readonly packageName: string;
}

const coreDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const packagesDir = path.dirname(coreDir);

export const PACKAGE_ROOTS: readonly PackageRoot[] = [
  { name: "core", dir: coreDir, packageName: "@blksails/pi-web-core" },
  { name: "server", dir: path.join(packagesDir, "server"), packageName: "@blksails/pi-web-server" },
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
    const specifier =
      subpath === "." ? root.packageName : `${root.packageName}${subpath.slice(1)}`;
    // "./src/trust/index.ts" → "trust/index.ts"
    out.set(specifier, target.replace(/^\.\/src\//, ""));
  }
  return out;
}

/**
 * 断言每个包根都贡献了文件。空扫是**最危险的失败形态** —— 它伪装成通过。
 *
 * @param what 被扫描物的名称,用于错误消息(如「测试文件」「源文件」)。
 */
export function assertEveryRootContributed(
  counts: ReadonlyMap<string, number>,
  what: string,
): void {
  const empty = PACKAGE_ROOTS.filter((r) => (counts.get(r.name) ?? 0) === 0);
  if (empty.length === 0) return;
  throw new Error(
    `以下包根扫到了 0 个${what},守卫实际上什么都没在守:\n` +
      empty.map((r) => `  · ${r.name} —— ${r.dir}`).join("\n") +
      `\n扫不到文件的守卫报出的绿,和真的没有违规长得一模一样。` +
      `请检查包根路径、包是否被改名或目录是否被搬走 —— 不要放宽本断言。`,
  );
}
