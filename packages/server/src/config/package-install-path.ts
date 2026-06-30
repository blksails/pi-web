/**
 * package-install-path — 由 `packages[]` 条目(spec)推导「扩展 id」与「本地安装目录」。
 *
 * pi 把已装包落盘:
 *  - `npm:[@scope/]name[@ver]`   → `<agentDir>/npm/node_modules/[@scope/]name`
 *  - `git:host/path[@ref]`        → `<agentDir>/git/host/path`
 *  - `local:/abs/path`            → `/abs/path`(原样)
 *  - 无前缀(裸名)                  → 当作 npm name
 *
 * 「扩展 id」= 去前缀去版本/ref 后的规范名(registry 查询键、与包 `package.json.name` 对齐)。
 */
import { isAbsolute, join, resolve, sep } from "node:path";

/** child 是否落在 parent 子树内(含自身)。 */
function isWithin(parent: string, child: string): boolean {
  const p = resolve(parent);
  const c = resolve(child);
  return c === p || c.startsWith(p + sep);
}

type Parsed = { kind: "npm" | "git" | "local" | "bare"; rest: string };

function parseSpec(spec: string): Parsed {
  const colon = spec.indexOf(":");
  if (colon === -1) return { kind: "bare", rest: spec };
  const prefix = spec.slice(0, colon);
  const rest = spec.slice(colon + 1);
  if (prefix === "npm" || prefix === "git" || prefix === "local") return { kind: prefix, rest };
  // 未知前缀(如 local 绝对路径里本就含 ':' 的极端情况)→ 当作裸名整体。
  return { kind: "bare", rest: spec };
}

/** 去掉 npm name 的 `@version` 尾巴(兼顾 `@scope/name` 的作用域 `@`)。 */
function stripNpmVersion(name: string): string {
  const at = name.lastIndexOf("@");
  // 作用域名 `@scope/name`:首字符的 `@` 不是版本分隔符。
  if (at <= 0) return name;
  return name.slice(0, at);
}

/** 去掉 git `host/path@ref` 的 `@ref` 尾巴。 */
function stripGitRef(path: string): string {
  const at = path.lastIndexOf("@");
  return at <= 0 ? path : path.slice(0, at);
}

/** 规范扩展 id(registry 查询键 / 与 package.json.name 对齐)。 */
export function packageIdFromSpec(spec: string): string {
  const { kind, rest } = parseSpec(spec);
  switch (kind) {
    case "git":
      return stripGitRef(rest);
    case "local":
      return rest; // 本地包无规范 npm id,用路径作 id(registry 一般不命中)
    case "npm":
    case "bare":
    default:
      return stripNpmVersion(rest);
  }
}

/**
 * 本地安装目录(读包内 package.json / schema 用);无法定位返回 undefined。
 * npm/git 解析结果必须落在 `<agentDir>` 子树内(防 `..` 穿越逃逸);`local:` 是用户
 * 显式给的绝对路径,豁免子树约束。
 */
export function packageInstallDir(spec: string, agentDir: string): string | undefined {
  const { kind, rest } = parseSpec(spec);
  switch (kind) {
    case "npm":
    case "bare": {
      const dir = join(agentDir, "npm", "node_modules", stripNpmVersion(rest));
      return isWithin(agentDir, dir) ? dir : undefined;
    }
    case "git": {
      const dir = join(agentDir, "git", stripGitRef(rest));
      return isWithin(agentDir, dir) ? dir : undefined;
    }
    case "local":
      return isAbsolute(rest) ? rest : undefined;
    default:
      return undefined;
  }
}

/**
 * 安全拼接包内相对路径(读包自带 schema 用):结果必须仍在包目录子树内,
 * 防 `pi.settings.schema = "../../x"` 逃逸。越界返回 undefined。
 */
export function resolveInPackage(pkgDir: string, rel: string): string | undefined {
  const p = join(pkgDir, rel);
  return isWithin(pkgDir, p) ? p : undefined;
}
