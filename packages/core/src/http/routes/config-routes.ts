/**
 * config-routes — GET/PUT /config/:domain 端点与路由注入。
 *
 * - GET  /config/:domain → `{ formSchema, values(掩码), protocolVersion }`
 * - PUT  /config/:domain ← `{ values }` → zod 校验 → secret 合并 → codec.save → 200
 * - 未知域 → 404
 * - adminPolicy 接缝(默认放行):拒绝时 → 403
 * - GET /config/models?input=&output= → 唯一部署级模型目录查询(multi-gateway-providers
 *   任务 4.3,Req 3.1, 3.2, 3.4)。原先独立的 `GET /aigc/models`(图像)与
 *   `GET /vision/models`(视觉)两个端点已删除,其能力由本端点的类型筛选完全覆盖 ——
 *   `output=image` 等价旧 AIGC 目录,`input=image` 等价旧视觉模型清单(Req 3.2)。
 *
 * 经 `createConfigRoutes(opts)` 返回 `ReadonlyArray<InjectedRoute>`,可直接传入
 * `createPiWebHandler({ routes })` 的 `routes?` 注入接缝。
 */
import { z } from "zod";
import {
  CONFIG_FORM_SCHEMAS,
  authConfigSchema,
  loggingConfigSchema,
  settingsConfigSchema,
  sandboxConfigSchema,
  aigcConfigSchema,
  cloudConfigSchema,
} from "@blksails/pi-web-protocol";
import type { ConfigDomainId } from "@blksails/pi-web-protocol";
import { errorResponse, jsonResponse } from "../index.js";
import type { InjectedRoute, RequestContext } from "../index.js";
import type { AuthContext } from "../index.js";
import { ConfigCodec } from "../../config/config-codec.js";
import type { Workspace } from "../../workspace/index.js";
import { maskSecrets, mergeSecrets } from "../../config/secret-merge.js";
import type { ModelOptions } from "../../config/model-options.types.js";

/** 已知域的 zod 校验 schema 表。 */
const DOMAIN_SCHEMAS: Readonly<Record<ConfigDomainId, z.ZodTypeAny>> = {
  auth: authConfigSchema,
  settings: settingsConfigSchema,
  // 全局沙箱策略(方案 A):写 `<agentDir>/sandbox.json`,即 pi-sandbox 读取的全局配置。
  sandbox: sandboxConfigSchema,
  // 日志系统配置域(Req 6.1 / 6.3)。
  logging: loggingConfigSchema,
  // AIGC 图像工具设置域(aigc-tool-settings):写 `<agentDir>/aigc.json`,aigcExtension 装配期读取。
  aigc: aigcConfigSchema,
  // 云端接入域(desktop-cloud-login Req 8):写 `<agentDir>/cloud.json`,装配期解析云端登录启用与否。
  // 之所以需要它:云端地址此前只能来自 env,而打包桌面版拿不到 env → 登录入口永远不出现。
  cloud: cloudConfigSchema,
};

/** PUT body 形状。 */
const PutConfigBodySchema = z.object({
  values: z.record(z.unknown()),
});

/**
 * `GET /config/models` 的查询参数(multi-gateway-providers 任务 4.3,Req 3.1, 3.2, 3.4):
 * 按输入 / 输出类型筛选,取代此前按用途拆分的 `/aigc/models`(图像)与 `/vision/models`
 * (视觉)两个端点。原始字符串直传给注入的 `listModelOptions` 接缝——非法取值不匹配
 * 任何条目的 `input`/`output`(经 `ModelCatalogService.query()` 的 `matchesFilter`),
 * 结果为空集而非报错,故本层无需重复做取值域校验。
 */
export interface ModelsQuery {
  readonly input?: string;
  readonly output?: string;
}

/** adminPolicy 接缝类型(与 extension-management 同构)。 */
export type ConfigAdminPolicy = (auth: AuthContext) => boolean;

/** 默认放行(本地单用户,P0)。 */
const defaultConfigAdminPolicy: ConfigAdminPolicy = () => true;

export interface ConfigRoutesOptions {
  /** 可选:覆盖 codec 根目录(测试用)。 */
  readonly rootDir?: string;
  /**
   * 可选:注入的宿主状态 `Workspace`(config-workspace-injection)。提供时 config 域读写导向
   * `workspace.user`(如云端 `TenantWorkspace`,按租户隔离),而非本地 fs 的 `rootDir`。
   * 二者互斥优先:提供 `workspace` 时 `rootDir` 被忽略。
   */
  readonly workspace?: Workspace;
  /** 可选:管理员鉴权接缝,默认放行。 */
  readonly adminPolicy?: ConfigAdminPolicy;
  /**
   * 可选:运行时列模型接缝。提供时挂载数据端点 GET /config/models,前端的
   * provider/model 可搜索下拉(widget)、AIGC 模型开关、视觉模型选择器均据此渲染
   * (multi-gateway-providers 任务 4.3:端点合一后唯一的部署级目录数据源)。省略则
   * 该端点返回空集(前端回退自由文本输入)。经依赖注入而非直接调用 pi SDK,使本模块
   * 测试与 pi SDK 解耦;`query` 携带 URL 上的 `input`/`output` 筛选参数,由装配层的
   * `ModelCatalogService.query()` 消费(Req 3.4)。
   */
  readonly listModelOptions?: (query: ModelsQuery) => ModelOptions | Promise<ModelOptions>;
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
  // 注入的 Workspace 优先(config 域落 user 命名空间,§3.7);否则用 rootDir 路径(现状)。
  const codec = opts.workspace !== undefined
    ? new ConfigCodec(opts.workspace.user)
    : new ConfigCodec(opts.rootDir);
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

  // GET /config/models — 唯一部署级模型目录(multi-gateway-providers 任务 4.3,
  // Req 3.1, 3.2, 3.4):列出已配置凭证的可用 provider/模型,支持 `?input=`/`?output=`
  // 按类型筛选,取代此前拆分的 `/aigc/models`(图像)与 `/vision/models`(视觉)两个端点。
  // 无 listModelOptions 接缝或取数抛错时返回空集(前端回退自由文本输入),绝不阻断。
  const modelsHandler = async (ctx: RequestContext): Promise<Response> => {
    if (!adminPolicy(ctx.auth)) {
      return ctx.auth.anonymous
        ? errorResponse(401, "UNAUTHORIZED", "Authentication required.")
        : errorResponse(403, "FORBIDDEN", "Config access denied.");
    }
    if (opts.listModelOptions === undefined) {
      return jsonResponse(200, { providers: [], models: [] });
    }
    const query: ModelsQuery = {
      input: ctx.url.searchParams.get("input") ?? undefined,
      output: ctx.url.searchParams.get("output") ?? undefined,
    };
    try {
      const modelOptions = await opts.listModelOptions(query);
      return jsonResponse(200, {
        providers: modelOptions.providers,
        models: modelOptions.models,
      });
    } catch {
      return jsonResponse(200, { providers: [], models: [] });
    }
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

  // 注意顺序:`/config/models` 必须排在 `/config/:domain` 之前 —— 二者段数相等,
  // router 按数组顺序匹配(字面段 vs :param),否则 "models" 会被当成未知域 → 404。
  return [
    { method: "GET", path: "/config/models", handler: modelsHandler },
    { method: "GET", path: "/config/:domain", handler: getHandler },
    { method: "PUT", path: "/config/:domain", handler: putHandler },
  ];
}
