/**
 * pi-web build — externals 强制(任务 2.2 / Req 6.4)。
 *
 * 产物必须把 react/react-dom/@blksails/pi-web-kit/ai 当 external(运行时经宿主 import map
 * 解析到单例)。若 bundle 内联了这些单例,会触发运行时 "invalid hook call" 等灾难。
 * 本守卫扫描产物代码中的内联签名,命中即抛 `ExternalsGuardError`,build 失败。
 */

export class ExternalsGuardError extends Error {
  constructor(
    message: string,
    readonly offenders: readonly string[],
  ) {
    super(message);
    this.name = "ExternalsGuardError";
  }
}

/** React 被打进 bundle 的强特征(其内部不会出现在仅 import react 的代码里)。 */
const BUNDLED_REACT_SIGNATURES: readonly RegExp[] = [
  /Invalid hook call\. Hooks can only be called/,
  /react\.development\.js/,
  /react-dom\.development\.js/,
  /__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED/,
  /scheduler\.production/,
];

export function findBundledSingletons(code: string): string[] {
  const offenders: string[] = [];
  for (const re of BUNDLED_REACT_SIGNATURES) {
    if (re.test(code)) offenders.push(re.source);
  }
  return offenders;
}

/** 断言产物未内联单例;命中则抛错(build 失败)。 */
export function assertNoBundledSingletons(code: string): void {
  const offenders = findBundledSingletons(code);
  if (offenders.length > 0) {
    throw new ExternalsGuardError(
      `检测到 react/单例被内联进扩展 bundle(应保持 external):\n  ${offenders.join("\n  ")}`,
      offenders,
    );
  }
}

/**
 * pane 单副本断言(任务 2.2 / Req 4.3)。
 *
 * pane 产物走 IIFE 打包,opaque-origin iframe 无 import map,运行时库必须**内联**
 * (方向与 `assertNoBundledSingletons` 相反)。但 agent source 与 pi-web 可能各自安装了
 * 同一运行时库的副本,若解析未收敛到单一副本,esbuild 会把两份都打进产物,导致运行时
 * 出现两份 React —— hooks 状态错位、"Invalid hook call" 等灾难。
 *
 * 本守卫扫描 esbuild 为每个被内联的 CommonJS 模块生成的 `__commonJS({"<模块路径>": ...})`
 * 注册标记。单个包安装通常由**多个**内部文件组成(如 react 的 `index.js` 与
 * `cjs/react.development.js` 各自都会生成一条标记),因此不能直接按标记条数计数——
 * 必须按标记路径中 `node_modules/<name>` 所在的**安装目录前缀**去重,该前缀相同即视为
 * 同一份物理副本。统计去重后的副本数,要求**恰好一份**。
 */

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function singletonMarkerPattern(name: string): RegExp {
  const escaped = escapeRegExp(name);
  // 捕获组 1 = 到 `node_modules/<name>` 为止的安装目录前缀,同一物理副本下
  // 不同内部文件的标记会捕获到相同前缀,据此去重。
  return new RegExp(
    String.raw`__commonJS\(\s*\{\s*"([^"]*node_modules/${escaped})/[^"]*"`,
    "g",
  );
}

/** 返回产物代码中检测到的单例**物理副本**安装目录前缀(已按副本去重)。 */
export function findSingletonOccurrences(code: string, name: string): string[] {
  const pattern = singletonMarkerPattern(name);
  const roots = new Set<string>();
  for (const match of code.matchAll(pattern)) {
    const root = match[1];
    if (root !== undefined) roots.add(root);
  }
  return Array.from(roots);
}

/** 断言 `name` 对应的运行时库在产物中恰好出现一份;0 份或多于 1 份均报错。 */
export function assertSingletonOccursOnce(code: string, name: string): void {
  const offenders = findSingletonOccurrences(code, name);
  if (offenders.length === 0) {
    throw new ExternalsGuardError(
      `产物中未找到运行时库 "${name}" 的单例(应被内联恰好一份,实际检测到 0 份):请确认该库已随 pane 构建正确内联,而非被 external 化`,
      offenders,
    );
  }
  if (offenders.length > 1) {
    throw new ExternalsGuardError(
      `产物中检测到运行时库 "${name}" 存在 ${offenders.length} 份副本(应恰好一份,可能是 agent source 与宿主各自的安装未收敛到同一份):\n  ${offenders.join("\n  ")}`,
      offenders,
    );
  }
}
