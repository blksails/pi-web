/**
 * sandbox-project-routes — 项目/按源沙箱配置端点(方案 B + 项目 `.pi/sandbox.json` 支持)。
 *
 * - GET  /config/sandbox/project[?cwd=<dir>] → `{ values, cwd, path, exists }`
 * - PUT  /config/sandbox/project[?cwd=<dir>] ← `{ values }` → zod 校验 → 写 `<cwd>/.pi/sandbox.json`
 *
 * 与全局 `/config/sandbox`(→ `<agentDir>/sandbox.json`)互补:pi-sandbox 运行时
 * 深合并 默认 ⊕ 全局 ⊕ 项目(项目优先),故此端点写的是"按源稀疏覆盖",
 * 无需写入源码树以外的任何位置即生效(cwd = 该 source 解析后的本地目录)。
 *
 * 安全:cwd 缺省取 `defaultCwd`;显式 cwd 必须为绝对路径且落在 `allowedRoots` 子树内
 * (默认 = [defaultCwd]),避免经该端点向任意路径写文件。adminPolicy 同 config-routes。
 *
 * 与 `/config/:domain` 不冲突:本路由 3 段(config/sandbox/project),`:domain` 仅 2 段。
 */
import { promises as fs } from "node:fs";
import { isAbsolute, join, resolve, sep } from "node:path";
import { sandboxConfigSchema } from "@blksails/protocol";
import { errorResponse, jsonResponse } from "../http/index.js";
import type { AuthContext, InjectedRoute, RequestContext } from "../http/index.js";

/** adminPolicy 接缝(与 config-routes 同构);默认放行(本地单用户)。 */
export type SandboxAdminPolicy = (auth: AuthContext) => boolean;
const defaultAdminPolicy: SandboxAdminPolicy = () => true;

export interface SandboxProjectRoutesOptions {
  /** cwd 缺省时使用的项目根(= app 所服务的项目)。 */
  readonly defaultCwd: string;
  /** 允许写入的项目根(及其子树)白名单;缺省 = [defaultCwd]。 */
  readonly allowedRoots?: readonly string[];
  /** 管理员鉴权接缝,默认放行。 */
  readonly adminPolicy?: SandboxAdminPolicy;
}

/** 解析并校验目标 cwd:绝对化、限定在 allowedRoots 子树内。 */
function resolveCwd(
  raw: string | null,
  defaultCwd: string,
  allowedRoots: readonly string[],
): { ok: true; cwd: string } | { ok: false } {
  const candidate = raw === null || raw.length === 0 ? defaultCwd : raw;
  if (!isAbsolute(candidate)) return { ok: false };
  const abs = resolve(candidate);
  const within = allowedRoots.some((root) => {
    const r = resolve(root);
    return abs === r || abs.startsWith(r + sep);
  });
  return within ? { ok: true, cwd: abs } : { ok: false };
}

/** `<cwd>/.pi/sandbox.json` 的绝对路径。 */
function projectConfigPath(cwd: string): string {
  return join(cwd, ".pi", "sandbox.json");
}

async function readJsonObject(path: string): Promise<Record<string, unknown> | undefined> {
  let text: string;
  try {
    text = await fs.readFile(path, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw err;
  }
  try {
    const parsed: unknown = JSON.parse(text);
    if (parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    /* 损坏文件按空处理 */
  }
  return {};
}

/**
 * 构造项目级沙箱路由数组,直接传入 `createPiWebHandler({ routes })`。
 */
export function createSandboxProjectRoutes(
  opts: SandboxProjectRoutesOptions,
): ReadonlyArray<InjectedRoute> {
  const adminPolicy = opts.adminPolicy ?? defaultAdminPolicy;
  const allowedRoots =
    opts.allowedRoots !== undefined && opts.allowedRoots.length > 0
      ? opts.allowedRoots
      : [opts.defaultCwd];

  const gate = (ctx: RequestContext): Response | undefined => {
    if (adminPolicy(ctx.auth)) return undefined;
    return ctx.auth.anonymous
      ? errorResponse(401, "UNAUTHORIZED", "Authentication required.")
      : errorResponse(403, "FORBIDDEN", "Config access denied.");
  };

  const getHandler = async (ctx: RequestContext): Promise<Response> => {
    const denied = gate(ctx);
    if (denied !== undefined) return denied;

    const target = resolveCwd(ctx.url.searchParams.get("cwd"), opts.defaultCwd, allowedRoots);
    if (!target.ok) {
      return errorResponse(403, "CWD_NOT_ALLOWED", "Requested cwd is not an allowed project root.");
    }
    const path = projectConfigPath(target.cwd);
    const onDisk = await readJsonObject(path);
    return jsonResponse(200, {
      cwd: target.cwd,
      path,
      exists: onDisk !== undefined,
      values: onDisk ?? {},
    });
  };

  const putHandler = async (ctx: RequestContext): Promise<Response> => {
    const denied = gate(ctx);
    if (denied !== undefined) return denied;

    const target = resolveCwd(ctx.url.searchParams.get("cwd"), opts.defaultCwd, allowedRoots);
    if (!target.ok) {
      return errorResponse(403, "CWD_NOT_ALLOWED", "Requested cwd is not an allowed project root.");
    }

    let bodyRaw: unknown;
    try {
      const text = await ctx.req.text();
      bodyRaw = text.length === 0 ? {} : JSON.parse(text);
    } catch {
      return errorResponse(400, "INVALID_JSON", "Request body is not valid JSON.");
    }
    const values =
      bodyRaw !== null && typeof bodyRaw === "object" && "values" in bodyRaw
        ? (bodyRaw as { values: unknown }).values
        : bodyRaw;

    const parsed = sandboxConfigSchema.safeParse(values);
    if (!parsed.success) {
      const fields = parsed.error.issues.map((i) =>
        i.path.length > 0 ? i.path.join(".") : "(root)",
      );
      return errorResponse(422, "SCHEMA_VALIDATION_FAILED", "Sandbox config failed validation.", fields);
    }

    const path = projectConfigPath(target.cwd);
    await fs.mkdir(join(target.cwd, ".pi"), { recursive: true });
    await fs.writeFile(path, JSON.stringify(parsed.data, null, 2) + "\n", {
      encoding: "utf8",
    });
    return jsonResponse(200, { ok: true, cwd: target.cwd, path });
  };

  return [
    { method: "GET", path: "/config/sandbox/project", handler: getHandler },
    { method: "PUT", path: "/config/sandbox/project", handler: putHandler },
  ];
}
