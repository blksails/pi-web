/**
 * path display masking — 聊天/工具输出中的绝对路径展示策略。
 *
 * 模式:
 *  - `off`      原样(完整绝对路径)
 *  - `home`     折叠用户 home 为 `~`(`/Users/alice/proj` → `~/proj`)
 *  - `basename` 仅保留最后一级(`/Users/alice/proj/foo` → `foo`; 裸 home → `~`)
 *
 * 默认 `basename`(隐私优先且路径短)。纯函数、同构、无 I/O。
 */

/** 路径显示模式。 */
export type PathDisplayMode = "off" | "home" | "basename";

/** 默认路径显示模式(设置缺省 / 未注入时)。 */
export const DEFAULT_PATH_DISPLAY_MODE: PathDisplayMode = "basename";

const PATH_DISPLAY_MODES: readonly PathDisplayMode[] = [
  "off",
  "home",
  "basename",
] as const;

/** 把未知值收窄为合法 {@link PathDisplayMode},非法/缺省 → 默认。 */
export function parsePathDisplayMode(value: unknown): PathDisplayMode {
  if (typeof value === "string" && (PATH_DISPLAY_MODES as readonly string[]).includes(value)) {
    return value as PathDisplayMode;
  }
  return DEFAULT_PATH_DISPLAY_MODE;
}

/** 快速判定是否可能含需处理的 home/绝对用户路径。 */
function mayContainHomePath(text: string): boolean {
  return (
    text.includes("/Users/") ||
    text.includes("/home/") ||
    /:[\\/]Users[\\/]/i.test(text)
  );
}

/**
 * 用户名段:常见 POSIX/Windows 账户字符(字母数字 . _ -)。
 * 故意不用 `[^/\\s]+`,以免吞掉路径后的 `)`、`]` 等标点。
 */
const USER = "[A-Za-z0-9._-]+";

/** 路径后续段:非空白、非常见结束标点。 */
const REST = "[^\\s\"'`()\\[\\]{}<>|,;:]*";

/** 取路径最后一级;裸 home(`/Users/name`) → `~`(不泄漏用户名)。 */
function lastSegment(path: string): string {
  const parts = path.split(/[/\\]/).filter((s) => s.length > 0);
  if (parts.length === 0) return path;
  // /Users/name 或 /home/name
  if (
    parts.length === 2 &&
    (parts[0] === "Users" || parts[0] === "home")
  ) {
    return "~";
  }
  // C:\Users\name  → ["C:", "Users", "name"] 或 ["C:","Users","name"]
  if (
    parts.length === 3 &&
    /^[A-Za-z]:$/.test(parts[0] ?? "") &&
    parts[1] === "Users"
  ) {
    return "~";
  }
  return parts[parts.length - 1] ?? path;
}

function maskHome(text: string): string {
  return text
    .replace(new RegExp(`/Users/${USER}`, "g"), "~")
    .replace(new RegExp(`/home/${USER}`, "g"), "~")
    .replace(new RegExp(`[A-Za-z]:\\\\Users\\\\${USER}`, "gi"), "~");
}

function maskBasename(text: string): string {
  // 匹配完整用户路径(含后续段),替换为最后一级。
  const replace = (m: string) => lastSegment(m);
  return text
    .replace(new RegExp(`/Users/${USER}(?:/${REST})?`, "g"), replace)
    .replace(new RegExp(`/home/${USER}(?:/${REST})?`, "g"), replace)
    .replace(
      new RegExp(`[A-Za-z]:\\\\Users\\\\${USER}(?:\\\\${REST})?`, "gi"),
      replace,
    );
}

/**
 * 按模式处理字符串中的绝对 home 路径。
 *
 * @example
 * maskPaths("/Users/alice/proj", "home")     // "~/proj"
 * maskPaths("/Users/alice/proj/foo", "basename") // "foo"
 * maskPaths("/Users/alice/proj", "off")      // "/Users/alice/proj"
 */
export function maskPaths(
  text: string,
  mode: PathDisplayMode = DEFAULT_PATH_DISPLAY_MODE,
): string {
  if (mode === "off" || text.length === 0) return text;
  if (!mayContainHomePath(text)) return text;
  if (mode === "home") return maskHome(text);
  return maskBasename(text);
}

/**
 * @deprecated 使用 {@link maskPaths}(text, "home")。保留别名以免瞬时破坏调用方。
 */
export function maskHomePaths(text: string): string {
  return maskPaths(text, "home");
}

/**
 * 深度遍历 JSON 兼容值，对所有 string 叶子做 {@link maskPaths}。
 * 非 plain object / array 原样返回（Date、Map 等不递归）。
 */
export function maskPathsDeep<T>(
  value: T,
  mode: PathDisplayMode = DEFAULT_PATH_DISPLAY_MODE,
): T {
  if (mode === "off") return value;
  if (typeof value === "string") {
    return maskPaths(value, mode) as T;
  }
  if (Array.isArray(value)) {
    return value.map((item) => maskPathsDeep(item, mode)) as T;
  }
  if (value !== null && typeof value === "object") {
    const proto = Object.getPrototypeOf(value);
    if (proto !== Object.prototype && proto !== null) {
      return value;
    }
    const src = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(src)) {
      out[key] = maskPathsDeep(src[key], mode);
    }
    return out as T;
  }
  return value;
}

/**
 * @deprecated 使用 {@link maskPathsDeep}(value, "home")。
 */
export function maskHomePathsDeep<T>(value: T): T {
  return maskPathsDeep(value, "home");
}
