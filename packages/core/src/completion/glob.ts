/**
 * completion-provider-framework — 轻量零依赖 glob 匹配器(file provider 的 includes/excludes)。
 *
 * 支持子集:双星跨目录任意(作目录前缀时为零或多层目录)、单星段内任意(不跨 "/")、
 * "?" 段内单字符、"{a,b,c}" 分支、其余字符字面量。路径用 cwd 相对 posix 形式匹配。
 * 锚定整串(^…$)。够覆盖 "src 下所有 ts"、"排除 test"、"任意层级某扩展名" 等常见型。
 */

const REGEX_SPECIAL = /[.+^${}()|[\]\\]/;

/** 把单个 glob 模式编译为锚定正则。 */
function globToRegExp(glob: string): RegExp {
  let re = "^";
  let braceDepth = 0;
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i] as string;
    if (c === "*") {
      if (glob[i + 1] === "*") {
        // `**`
        i++;
        if (glob[i + 1] === "/") {
          re += "(?:.*/)?"; // `**/` → 零或多层目录
          i++;
        } else {
          re += ".*"; // `**` → 跨目录任意
        }
      } else {
        re += "[^/]*"; // `*` → 段内任意
      }
    } else if (c === "?") {
      re += "[^/]";
    } else if (c === "{") {
      braceDepth++;
      re += "(?:";
    } else if (c === "}" && braceDepth > 0) {
      braceDepth--;
      re += ")";
    } else if (c === "," && braceDepth > 0) {
      re += "|";
    } else if (c === "/") {
      re += "/";
    } else {
      re += REGEX_SPECIAL.test(c) ? `\\${c}` : c;
    }
  }
  re += "$";
  return new RegExp(re);
}

/**
 * 编译一组 glob 为匹配函数(任一命中即 true)。
 * patterns 为空/未定义 → 返回 null(由调用方决定默认放行/拒绝)。
 */
export function compileGlobs(
  patterns: readonly string[] | undefined,
): ((rel: string) => boolean) | null {
  if (patterns === undefined || patterns.length === 0) return null;
  const res = patterns.map(globToRegExp);
  return (rel: string): boolean => res.some((r) => r.test(rel));
}
