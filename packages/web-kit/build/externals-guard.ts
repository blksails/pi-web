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
