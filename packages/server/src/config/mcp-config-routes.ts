/**
 * mcp-config-routes — 独立「MCP」配置端点(GET·PUT /config/mcp)。
 *
 * 专管 pi-mcp-adapter 的 `<agentDir>/mcp.json`:**直接原始 JSON 编辑**(不喂 schema,
 * 前端 configFiles 控件无 fileSchemas → 回退原始 JSON 文本框)。仅在 pi-mcp-adapter 已安装
 * (在 settings.json packages[])时 `installed:true`;未安装则 `installed:false`(供前端
 * 「装了才出现」门控)。响应/写盘形态对齐扩展独立配置文件,故前端直接复用 configFiles 控件。
 */
import { promises as fs } from "node:fs";
import { join } from "node:path";
import { errorResponse, jsonResponse } from "../http/index.js";
import type { AuthContext, InjectedRoute, RequestContext } from "../http/index.js";
import { packageIdFromSpec } from "./package-install-path.js";

const MCP_EXT_ID = "pi-mcp-adapter";
const MCP_FILE = "mcp.json";

export type McpAdminPolicy = (auth: AuthContext) => boolean;

export interface McpConfigRoutesOptions {
  readonly agentDir: string;
  readonly adminPolicy?: McpAdminPolicy;
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

async function readJsonObject(path: string): Promise<Record<string, unknown> | undefined> {
  try {
    const parsed: unknown = JSON.parse(await fs.readFile(path, "utf8"));
    return isPlainObject(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await fs.access(path);
    return true;
  } catch {
    return false;
  }
}

function isMcpInstalled(settings: Record<string, unknown>): boolean {
  const pkgs = settings["packages"];
  if (!Array.isArray(pkgs)) return false;
  return pkgs.some((p) => typeof p === "string" && packageIdFromSpec(p) === MCP_EXT_ID);
}

export function createMcpConfigRoutes(opts: McpConfigRoutesOptions): ReadonlyArray<InjectedRoute> {
  const adminPolicy = opts.adminPolicy ?? (() => true);
  const mcpPath = join(opts.agentDir, MCP_FILE);

  const gate = (ctx: RequestContext): Response | undefined => {
    if (adminPolicy(ctx.auth)) return undefined;
    return ctx.auth.anonymous
      ? errorResponse(401, "UNAUTHORIZED", "Authentication required.")
      : errorResponse(403, "FORBIDDEN", "Config access denied.");
  };

  const handleGet = async (): Promise<Response> => {
    const settings = (await readJsonObject(join(opts.agentDir, "settings.json"))) ?? {};
    if (!isMcpInstalled(settings)) {
      return jsonResponse(200, { installed: false, values: {} });
    }
    const content = await readJsonObject(mcpPath);
    // 不喂 fileSchemas → 前端 configFiles 控件回退原始 JSON 文本编辑。
    return jsonResponse(200, {
      installed: true,
      values: { files: { [MCP_FILE]: content ?? {} } },
    });
  };

  const handlePut = async (ctx: RequestContext): Promise<Response> => {
    let bodyRaw: unknown;
    try {
      const text = await ctx.req.text();
      bodyRaw = text.length === 0 ? {} : JSON.parse(text);
    } catch {
      return errorResponse(400, "INVALID_JSON", "Request body is not valid JSON.");
    }
    const values = isPlainObject(bodyRaw) && "values" in bodyRaw ? (bodyRaw as { values: unknown }).values : bodyRaw;
    const files = isPlainObject(values) ? values["files"] : undefined;
    const content = isPlainObject(files) ? files[MCP_FILE] : undefined;
    // 空且原不存在 → 不落盘(空表单未填写)。
    if (isPlainObject(content) && Object.keys(content).length === 0 && !(await fileExists(mcpPath))) {
      return jsonResponse(200, { ok: true, path: mcpPath, written: false });
    }
    await fs.mkdir(opts.agentDir, { recursive: true });
    await fs.writeFile(mcpPath, JSON.stringify(content ?? {}, null, 2) + "\n", "utf8");
    return jsonResponse(200, { ok: true, path: mcpPath, written: true });
  };

  const get = async (ctx: RequestContext): Promise<Response> => gate(ctx) ?? handleGet();
  const put = async (ctx: RequestContext): Promise<Response> => gate(ctx) ?? handlePut(ctx);

  return [
    { method: "GET", path: "/config/mcp", handler: get },
    { method: "PUT", path: "/config/mcp", handler: put },
  ];
}
