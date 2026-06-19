/**
 * config-routes — GET/PUT /config/:domain 端点与路由注入。
 *
 * - GET  /config/:domain → `{ formSchema, values(掩码), protocolVersion }`
 * - PUT  /config/:domain ← `{ values }` → zod 校验 → secret 合并 → codec.save → 200
 * - 未知域 → 404
 * - adminPolicy 接缝(默认放行):拒绝时 → 403
 *
 * 经 `createConfigRoutes(opts)` 返回 `ReadonlyArray<InjectedRoute>`,可直接传入
 * `createPiWebHandler({ routes })` 的 `routes?` 注入接缝。
 */
import { z } from "zod";
import {
  CONFIG_FORM_SCHEMAS,
  authConfigSchema,
  settingsConfigSchema,
  sandboxConfigSchema,
} from "@pi-web/protocol";
import type { ConfigDomainId } from "@pi-web/protocol";
import { errorResponse, jsonResponse } from "../http/index.js";
import type { InjectedRoute, RequestContext } from "../http/index.js";
import type { AuthContext } from "../http/index.js";
import { ConfigCodec } from "./config-codec.js";
import { maskSecrets, mergeSecrets } from "./secret-merge.js";

/** 已知域的 zod 校验 schema 表。 */
const DOMAIN_SCHEMAS: Readonly<Record<ConfigDomainId, z.ZodTypeAny>> = {
  auth: authConfigSchema,
  settings: settingsConfigSchema,
  // 全局沙箱策略(方案 A):写 `<agentDir>/sandbox.json`,即 pi-sandbox 读取的全局配置。
  sandbox: sandboxConfigSchema,
};

/** PUT body 形状。 */
const PutConfigBodySchema = z.object({
  values: z.record(z.unknown()),
});

/** adminPolicy 接缝类型(与 extension-management 同构)。 */
export type ConfigAdminPolicy = (auth: AuthContext) => boolean;

/** 默认放行(本地单用户,P0)。 */
const defaultConfigAdminPolicy: ConfigAdminPolicy = () => true;

export interface ConfigRoutesOptions {
  /** 可选:覆盖 codec 根目录(测试用)。 */
  readonly rootDir?: string;
  /** 可选:管理员鉴权接缝,默认放行。 */
  readonly adminPolicy?: ConfigAdminPolicy;
}

/** 从 URL pathname 提取 `/config/:domain` 中的 domain 段。 */
function extractDomain(url: URL): string | undefined {
  // 兼容 basePath:取最后两段,要求形如 [..., "config", "<domain>"]。
  const parts = url.pathname.split("/").filter((s) => s.length > 0);
  const configIdx = parts.lastIndexOf("config");
  if (configIdx === -1 || configIdx + 1 >= parts.length) return undefined;
  return parts[configIdx + 1];
}

function isKnownDomain(domain: string): domain is ConfigDomainId {
  return Object.prototype.hasOwnProperty.call(CONFIG_FORM_SCHEMAS, domain);
}

/**
 * 构造配置路由数组,可直接传入 `createPiWebHandler({ routes })` 的 `routes?` 接缝。
 */
export function createConfigRoutes(
  opts: ConfigRoutesOptions = {},
): ReadonlyArray<InjectedRoute> {
  const codec = new ConfigCodec(opts.rootDir);
  const adminPolicy = opts.adminPolicy ?? defaultConfigAdminPolicy;

  const getHandler = async (ctx: RequestContext): Promise<Response> => {
    // 管理员门控。
    if (!adminPolicy(ctx.auth)) {
      return ctx.auth.anonymous
        ? errorResponse(401, "UNAUTHORIZED", "Authentication required.")
        : errorResponse(403, "FORBIDDEN", "Config access denied.");
    }

    const rawDomain = extractDomain(ctx.url);
    if (rawDomain === undefined || !isKnownDomain(rawDomain)) {
      return errorResponse(404, "DOMAIN_NOT_FOUND", `Unknown config domain: "${rawDomain ?? ""}".`);
    }
    const domain = rawDomain;

    const rawValues = await codec.load(domain);
    const formSchema = CONFIG_FORM_SCHEMAS[domain];
    const values = maskSecrets(domain, rawValues, formSchema);

    return jsonResponse(200, { formSchema, values });
  };

  const putHandler = async (ctx: RequestContext): Promise<Response> => {
    // 管理员门控。
    if (!adminPolicy(ctx.auth)) {
      return ctx.auth.anonymous
        ? errorResponse(401, "UNAUTHORIZED", "Authentication required.")
        : errorResponse(403, "FORBIDDEN", "Config access denied.");
    }

    const rawDomain = extractDomain(ctx.url);
    if (rawDomain === undefined || !isKnownDomain(rawDomain)) {
      return errorResponse(404, "DOMAIN_NOT_FOUND", `Unknown config domain: "${rawDomain ?? ""}".`);
    }
    const domain = rawDomain;

    // 解析 body。
    let bodyRaw: unknown;
    try {
      const text = await ctx.req.text();
      bodyRaw = text.length === 0 ? {} : JSON.parse(text);
    } catch {
      return errorResponse(400, "INVALID_JSON", "Request body is not valid JSON.");
    }

    const bodyParsed = PutConfigBodySchema.safeParse(bodyRaw);
    if (!bodyParsed.success) {
      const fields = bodyParsed.error.issues.map((i) =>
        i.path.length > 0 ? i.path.join(".") : "(root)",
      );
      return errorResponse(400, "VALIDATION_FAILED", "Request body failed validation.", fields);
    }

    const { values: incomingValues } = bodyParsed.data;

    // 读取磁盘现有值。
    const diskValues = await codec.load(domain);
    const formSchema = CONFIG_FORM_SCHEMAS[domain];

    // 先做 secret 合并(将掩码/哨兵替换为磁盘原值)。
    const merged = mergeSecrets(domain, incomingValues, diskValues, formSchema);

    // 对合并后的结果做域 schema 校验(此时 secret 字段已是磁盘明文,可正确校验)。
    const domainSchema = DOMAIN_SCHEMAS[domain];
    const domainParsed = domainSchema.safeParse(merged);
    if (!domainParsed.success) {
      const fields = domainParsed.error.issues.map((i) =>
        i.path.length > 0 ? i.path.join(".") : "(root)",
      );
      return errorResponse(422, "SCHEMA_VALIDATION_FAILED", "Config values failed schema validation.", fields);
    }

    // `merged` 已是 mergeSecrets 合并出的权威全量对象(已读盘保留未知字段并应用删除)。
    // 覆盖写入,避免 codec 再对磁盘 deepMerge 复活已清除的密钥/provider(C2)。
    await codec.save(domain, merged, { merge: false });

    return jsonResponse(200, { ok: true });
  };

  return [
    { method: "GET", path: "/config/:domain", handler: getHandler },
    { method: "PUT", path: "/config/:domain", handler: putHandler },
  ];
}
