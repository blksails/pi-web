/**
 * mcp-config-routes — 内置 MCP 客户端的配置端点族(spec: builtin-mcp-client,任务 3.1/3.3)。
 *
 * 从「装了 pi-mcp-adapter 才出现的裸 JSON 编辑器」改造为**结构化配置面**:
 *  - `GET·PUT /config/mcp`        —— 结构化读写(zod 校验 + secret 三态 + 未识别内容保留)
 *  - `GET  /config/mcp/status`    —— 只读缓存的连接状态(不触发连接)
 *  - `POST /config/mcp/probe`     —— 按需真实探测并刷新缓存
 *
 * ⚠ 契约:宿主契约 v1 §5.3 已冻结 capability id `config.mcp`,本工厂即其内容,**不得**并入
 * 通用 `/config/:domain`(否则该 id 失去内容,两端须重新表态);且在能力清单中必须**排在
 * `config.domains` 之前**,否则 `/config/:domain` 会抢占 `GET /config/mcp`。
 *
 * 落盘仍是 `<agentDir>/mcp.json`(路径不变 → 既有配置继续有效,Req 5.3)。
 */
import { promises as fs } from "node:fs";
import { join } from "node:path";
import {
  mcpConfigSchema,
  mcpFormSchema,
  normalizeMcpConfig,
  buildMcpConfigForWrite,
  type McpServerConfig,
} from "@blksails/pi-web-protocol";
import { errorResponse, jsonResponse } from "../http/index.js";
import type { AuthContext, InjectedRoute, RequestContext } from "../http/index.js";
import { maskMcpSecrets, mergeMcpSecrets } from "./mcp-secrets.js";
import { McpProbeService } from "./mcp-probe.js";

const MCP_FILE = "mcp.json";

export type McpAdminPolicy = (auth: AuthContext) => boolean;

export interface McpConfigRoutesOptions {
  readonly agentDir: string;
  readonly adminPolicy?: McpAdminPolicy;
  /** 注入点:便于测试替换探测行为。 */
  readonly probeService?: McpProbeService;
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

async function readRawConfig(path: string): Promise<unknown> {
  try {
    return JSON.parse(await fs.readFile(path, "utf8"));
  } catch {
    // 缺文件/损坏 → 视为空配置(配置面仍可用,用户可直接新建条目)。
    return undefined;
  }
}

export function createMcpConfigRoutes(opts: McpConfigRoutesOptions): ReadonlyArray<InjectedRoute> {
  const adminPolicy = opts.adminPolicy ?? (() => true);
  const mcpPath = join(opts.agentDir, MCP_FILE);
  const probeService = opts.probeService ?? new McpProbeService();

  const gate = (ctx: RequestContext): Response | undefined => {
    if (adminPolicy(ctx.auth)) return undefined;
    return ctx.auth.anonymous
      ? errorResponse(401, "UNAUTHORIZED", "Authentication required.")
      : errorResponse(403, "FORBIDDEN", "Config access denied.");
  };

  /** 读盘 → 规范化。两处路径共用,保证状态与配置看到的是同一批条目。 */
  const loadNormalized = async (): Promise<ReturnType<typeof normalizeMcpConfig>> =>
    normalizeMcpConfig(await readRawConfig(mcpPath));

  const handleGet = async (): Promise<Response> => {
    const normalized = await loadNormalized();
    // Req 4.3 / 7.2:凭据以掩码回吐,明文绝不回读浏览器。
    const values = maskMcpSecrets({ servers: normalized.servers });
    return jsonResponse(200, {
      values,
      formSchema: mcpFormSchema,
      // 供配置面提示"存在未被识别的内容,已保留"(Req 5.4)
      unrecognized: normalized.unrecognizedServers.map((u) => ({
        name: u.name,
        reason: u.reason,
      })),
      migratedFromObjectMap: normalized.migratedFromObjectMap,
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
    const incoming =
      isPlainObject(bodyRaw) && "values" in bodyRaw
        ? (bodyRaw as { values: unknown }).values
        : bodyRaw;

    const existing = await loadNormalized();

    // secret 三态:keep 取磁盘原值 / clear 移除 / set 采用新值(Req 7.3, 7.4)。
    const resolved = mergeMcpSecrets(incoming, { servers: existing.servers });

    // Req 2.5:校验失败须指明缺失字段。
    const parsed = mcpConfigSchema.safeParse(isPlainObject(resolved) ? resolved : {});
    if (!parsed.success) {
      return jsonResponse(400, {
        error: {
          code: "INVALID_CONFIG",
          message: "MCP configuration is invalid.",
          issues: parsed.error.issues.map((i) => ({
            path: i.path.join("."),
            message: i.message,
          })),
        },
      });
    }

    const nextServers = parsed.data.servers as readonly McpServerConfig[];
    // Req 5.4:未识别条目与未识别顶层键随写回一并保留。
    const out = buildMcpConfigForWrite(nextServers, existing);

    await fs.mkdir(opts.agentDir, { recursive: true });
    await fs.writeFile(mcpPath, `${JSON.stringify(out, null, 2)}\n`, "utf8");
    probeService.retain(nextServers.map((s) => s.name));

    return jsonResponse(200, { ok: true, path: mcpPath, written: true });
  };

  const handleStatus = async (): Promise<Response> => {
    const normalized = await loadNormalized();
    return jsonResponse(200, { statuses: probeService.status(normalized.servers) });
  };

  const handleProbe = async (ctx: RequestContext): Promise<Response> => {
    let only: string | undefined;
    try {
      const text = await ctx.req.text();
      if (text.length > 0) {
        const body: unknown = JSON.parse(text);
        if (isPlainObject(body) && typeof body["name"] === "string") only = body["name"];
      }
    } catch {
      return errorResponse(400, "INVALID_JSON", "Request body is not valid JSON.");
    }
    const normalized = await loadNormalized();
    const statuses = await probeService.probe(normalized.servers, only);
    return jsonResponse(200, { statuses });
  };

  const get = async (ctx: RequestContext): Promise<Response> => gate(ctx) ?? handleGet();
  const put = async (ctx: RequestContext): Promise<Response> => gate(ctx) ?? handlePut(ctx);
  const status = async (ctx: RequestContext): Promise<Response> => gate(ctx) ?? handleStatus();
  const probe = async (ctx: RequestContext): Promise<Response> => gate(ctx) ?? handleProbe(ctx);

  return [
    // ⚠ 更具体的路径必须排在 `/config/mcp` 之前,避免被前者遮蔽。
    { method: "GET", path: "/config/mcp/status", handler: status },
    { method: "POST", path: "/config/mcp/probe", handler: probe },
    { method: "GET", path: "/config/mcp", handler: get },
    { method: "PUT", path: "/config/mcp", handler: put },
  ];
}
