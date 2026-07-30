/**
 * extension-management — pi CLI 子进程适配器(唯一 IO 点,Req 1.1/2.6/3.3/9.2/9.3/9.4/10.5)。
 *
 * 经 `node:child_process` 执行 `pi list/install/remove`,以传入 args/env 运行;强制超时
 * 上限(超时杀进程防挂起);非零退出 / 超时 → 失败结果(剥离 env 敏感值与命令行凭据)。
 *
 * pi CLI 路径经 `require.resolve("@earendil-works/pi-coding-agent")` 解析(非全局 `pi`):
 * 该包入口 `dist/index.js` 同目录下的 `dist/cli.js` 即 bin。以 `node <cli.js> ...` 执行。
 *
 * 仅此处 spawn 子进程;接口可注入受控替身,使治理核心与端点在测试中无需真实 `pi`。
 */
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import type {
  InstalledExtension,
  PiCli,
  PiCommandResult,
} from "../ext.types.js";

const DEFAULT_TIMEOUT_MS = 120_000;
const PI_PACKAGE = "@earendil-works/pi-coding-agent";

/** 找不到 pi 包时的可识别错误(不泄敏)。 */
export class PiCliNotFoundError extends Error {
  readonly code = "PI_CLI_NOT_FOUND" as const;
  constructor() {
    super(`Cannot resolve the pi CLI from "${PI_PACKAGE}".`);
    this.name = "PiCliNotFoundError";
  }
}

/**
 * 解析 pi CLI 入口(`<pkgDir>/dist/cli.js`,即包 bin "pi")。
 *
 * pi 的 `exports` map 仅暴露 `import` 条件且不暴露 `package.json`,故 `require.resolve`
 * 会 ERR_PACKAGE_PATH_NOT_EXPORTED。改为从本模块位置向上逐层在 `node_modules` 中定位
 * `@earendil-works/pi-coding-agent` 包目录(与 runner/agent-loader 的策略一致),再拼
 * `dist/cli.js`。这是"经 `@earendil-works/pi-coding-agent` 解析"而非全局 `pi`。
 */
export function resolvePiCliEntry(): string {
  // 依次从多个基准向上定位包目录:
  //  ① 本模块位置(import.meta.url):dev 命中 packages/server/node_modules;同路径 standalone 亦可。
  //  ② 运行时 cwd:standalone 产物以 cwd=产物根启动,命中顶层 node_modules/@earendil-works/pi-coding-agent。
  // ②必要,因 webpack 把 standalone bundle 里的 import.meta.url **内联成构建机绝对路径**,
  // 产物换机/换 OS 后①走的是不存在的构建路径(参见 pack-standalone 的可重定位处理)。
  // 且 Windows 上 `fileURLToPath` 对 Linux 内联 URL 直接抛 ERR_INVALID_FILE_URL_PATH,
  // 故 try 包裹:抛错则跳过①,仅用②cwd。
  const bases: string[] = [];
  try {
    bases.push(fileURLToPath(import.meta.url));
  } catch {
    /* Windows + Linux 内联 URL:跳过,用 cwd */
  }
  bases.push(path.join(process.cwd(), "_"));
  for (const base of bases) {
    const pkgDir = locatePackageDir(PI_PACKAGE, base);
    if (pkgDir !== undefined) {
      return path.join(pkgDir, "dist", "cli.js");
    }
  }
  throw new PiCliNotFoundError();
}

/** 从 `fromPath` 向上在各级 `node_modules` 中定位包目录。 */
function locatePackageDir(spec: string, fromPath: string): string | undefined {
  let dir = path.dirname(fromPath);
  for (;;) {
    const candidate = path.join(dir, "node_modules", spec);
    if (existsSync(path.join(candidate, "package.json"))) {
      return candidate;
    }
    const parent = path.dirname(dir);
    if (parent === dir) {
      return undefined;
    }
    dir = parent;
  }
}

/** 子进程环境:不透传调用方完整 env(避免泄露 provider key),仅注入命令所需。 */
function childEnv(extra: Record<string, string>): NodeJS.ProcessEnv {
  return {
    PATH: process.env["PATH"],
    HOME: process.env["HOME"],
    // 非交互兜底:无论来源类型都不挂起等待输入。
    GIT_TERMINAL_PROMPT: "0",
    CI: "1",
    ...extra,
  };
}

/** 把子进程输出/错误脱敏(剥离内联凭据)。 */
function redact(text: string): string {
  return text
    .replace(/(https?:\/\/)[^/@\s]+@/gi, "$1[redacted]@")
    .replace(/(ssh:\/\/)[^/@\s]+@/gi, "$1[redacted]@")
    .replace(/(?:api[_-]?key|secret|token|password)s?\s*[:=]\s*\S+/gi, "[redacted]");
}

export interface ChildProcessPiCliOptions {
  /** pi CLI 入口路径;缺省经 require.resolve 解析。 */
  readonly piCliEntry?: string;
  /** Node 可执行路径(缺省 process.execPath)。 */
  readonly nodePath?: string;
  /** 默认子进程超时(毫秒)。 */
  readonly timeoutMs?: number;
}

/** `node:child_process` 实现(生产路径)。 */
export class ChildProcessPiCli implements PiCli {
  private readonly piCliEntry: string;
  private readonly nodePath: string;
  private readonly defaultTimeoutMs: number;

  constructor(opts: ChildProcessPiCliOptions = {}) {
    this.piCliEntry = opts.piCliEntry ?? resolvePiCliEntry();
    this.nodePath = opts.nodePath ?? process.execPath;
    this.defaultTimeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  runPiCommand(
    args: readonly string[],
    env: Record<string, string>,
    opts?: { readonly timeoutMs?: number },
  ): Promise<PiCommandResult> {
    const timeoutMs = opts?.timeoutMs ?? this.defaultTimeoutMs;
    return new Promise<PiCommandResult>((resolve) => {
      const child = spawn(this.nodePath, [this.piCliEntry, ...args], {
        env: childEnv(env),
        stdio: ["ignore", "pipe", "pipe"],
      });
      let stdout = "";
      let stderr = "";
      let settled = false;
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        child.kill("SIGKILL");
        resolve({
          ok: false,
          stdout: redact(stdout),
          exitCode: null,
          errorSummary: `pi ${args[0] ?? ""} timed out after ${timeoutMs}ms`,
        });
      }, timeoutMs);
      if (typeof timer.unref === "function") timer.unref();

      child.stdout.on("data", (d: Buffer) => {
        stdout += d.toString();
      });
      child.stderr.on("data", (d: Buffer) => {
        stderr += d.toString();
      });
      child.on("error", (err) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve({
          ok: false,
          stdout: redact(stdout),
          exitCode: null,
          errorSummary: redact(
            err instanceof Error ? err.message : "failed to spawn pi",
          ),
        });
      });
      child.on("close", (code) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        const ok = code === 0;
        const result: PiCommandResult = ok
          ? { ok, stdout: redact(stdout), exitCode: code }
          : {
              ok,
              stdout: redact(stdout),
              exitCode: code,
              errorSummary: redact(
                stderr.trim().length > 0
                  ? stderr.trim()
                  : `pi ${args[0] ?? ""} exited with code ${code ?? "null"}`,
              ),
            };
        resolve(result);
      });
    });
  }

  async listExtensions(): Promise<readonly InstalledExtension[]> {
    const res = await this.runPiCommand(["list"], {});
    if (!res.ok) {
      throw new PiListError(res.errorSummary ?? "pi list failed");
    }
    return parsePiList(res.stdout);
  }
}

/** `pi list` 失败的可识别错误(脱敏)。 */
export class PiListError extends Error {
  readonly code = "PI_LIST_FAILED" as const;
  constructor(summary: string) {
    super(`Failed to list extensions: ${summary}`);
    this.name = "PiListError";
  }
}

/**
 * 解析 `pi list` 输出为结构化条目。pi 的 list 输出格式可能漂移(集成测试上游暴露);
 * 此处做宽松解析:优先 JSON;否则按行 `<id>[@<version>] (<scope>)` 解析。空输出 → 空列表。
 */
export function parsePiList(stdout: string): readonly InstalledExtension[] {
  const trimmed = stdout.trim();
  if (trimmed.length === 0) return [];

  // 优先尝试 JSON 数组。
  try {
    const parsed: unknown = JSON.parse(trimmed);
    if (Array.isArray(parsed)) {
      return parsed
        .map((e) => coerceEntry(e))
        .filter((e): e is InstalledExtension => e !== undefined);
    }
  } catch {
    // 非 JSON,落到行解析。
  }

  const out: InstalledExtension[] = [];
  for (const line of trimmed.split("\n")) {
    const entry = parseListLine(line.trim());
    if (entry !== undefined) out.push(entry);
  }
  return out;
}

function coerceEntry(raw: unknown): InstalledExtension | undefined {
  if (typeof raw !== "object" || raw === null) return undefined;
  const o = raw as Record<string, unknown>;
  const id = typeof o["id"] === "string" ? o["id"] : typeof o["name"] === "string" ? (o["name"] as string) : undefined;
  if (id === undefined) return undefined;
  const kind: InstalledExtension["kind"] =
    o["kind"] === "npm" || o["kind"] === "git" || o["kind"] === "local"
      ? o["kind"]
      : "npm";
  const scope: InstalledExtension["scope"] =
    o["scope"] === "project" ? "project" : "global";
  const version = typeof o["version"] === "string" ? o["version"] : undefined;
  return version !== undefined
    ? { id, kind, scope, version }
    : { id, kind, scope };
}

function parseListLine(line: string): InstalledExtension | undefined {
  if (line.length === 0 || line.startsWith("#")) return undefined;
  // 形如: "@scope/pkg@1.2.3 (project)" 或 "name (global)"
  let scope: InstalledExtension["scope"] = "global";
  let body = line;
  const scopeMatch = line.match(/\((global|project)\)\s*$/);
  if (scopeMatch?.[1] !== undefined) {
    scope = scopeMatch[1] === "project" ? "project" : "global";
    body = line.slice(0, scopeMatch.index).trim();
  }
  if (body.length === 0) return undefined;
  const at = body.lastIndexOf("@");
  let id = body;
  let version: string | undefined;
  if (at > 0) {
    id = body.slice(0, at);
    version = body.slice(at + 1);
  }
  const kind: InstalledExtension["kind"] = body.includes("://") || body.startsWith("git")
    ? "git"
    : body.startsWith("/") || body.startsWith(".")
      ? "local"
      : "npm";
  return version !== undefined ? { id, kind, scope, version } : { id, kind, scope };
}
