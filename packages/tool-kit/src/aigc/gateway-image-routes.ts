/**
 * 按网关实例生成图像路由(spec desktop-aigc-egress,任务 3.3/3.4)。
 *
 * ## 与既有静态路由表的关系
 *
 * `tools/image-generation.ts` 的 `AI_GATEWAY_IMAGE_ROUTES` 与 `tools/image-edit.ts` 的
 * `AI_GATEWAY_IMAGE_EDIT_ROUTES` **原样保留、不动**。它们服务于存量的单实例 env 形态
 * (`BLKSAILS_GATEWAY_BASE_URL`),其 baseUrl / apiKey 走 env 占位符。改动它们等于改动
 * 既有部署的行为,而本 spec 的第一承诺是"未启用时逐字节一致"(Req 1.2)。
 *
 * 本模块是**并行的新增路径**:对每个解析到的网关实例(env 多实例 或 云端授予),各生成
 * 一组路由,其 baseUrl 是该实例的字面量、凭据取该实例自己的 env 变量名、展示归属等于
 * 实例标识。
 *
 * ## ★ 路由键唯一性
 *
 * 多实例并存时,同一个模型会出现多次。若沿用同一个路由键,后注册的会覆盖先注册的 ——
 * 使用者看到一个模型,却不知道它走哪个网关。故非缺省实例一律加 `-<instanceId>` 后缀。
 * 缺省实例(`ai-gateway`)保持既有键不变,使存量部署的模型枚举逐字节不动。
 *
 * ## 双入口边界
 *
 * 本模块**不读 `process.env`** —— 实例信息一律由入参传入(见 `tech.md` §双入口边界)。
 */
import type { ImageRoute } from "./types.js";
import type { Pricing } from "../engine/endpoint-types.js";
import type { GatewayImageInstance } from "./gateway-instances.js";
import {
  createGatewayInstanceImage,
  createGatewayInstanceImageEdit,
  gatewayInstanceImageConfig,
} from "./providers/ai-gateway.js";

/** 缺省实例标识(存量单实例形态的 provider 名)。 */
const DEFAULT_INSTANCE_ID = "ai-gateway";

/** 一个可经网关暴露的图像模型声明(生成与编辑共用)。 */
interface GatewayImageModelDecl {
  /** 发往网关的 model 名,同时是内置白名单的成员。 */
  readonly model: string;
  readonly label: string;
  /** 缺省实例下的路由键(保持与既有静态表逐字一致)。 */
  readonly defaultRouteKey: string;
  readonly pricing: Pricing;
}

/**
 * 内置图像模型白名单。
 *
 * ★ 与既有静态表同源同序,取值刻意一致 —— 那张表的注释写明"首批仅纳入**已真机验证可
 * 出图**的模型,不照文档全量写入,否则选择器会列出本账号网关上实际不可用的模型"。
 * 本模块沿用该纪律:白名单是上界,云端授予的清单在此之上再取交集(见
 * {@link createGatewayImageRoutes})。
 */
export const GATEWAY_IMAGE_MODEL_WHITELIST: readonly GatewayImageModelDecl[] = [
  {
    model: "gpt-image-1",
    label: "GPT Image 1",
    defaultRouteKey: "gpt-image-1",
    pricing: { amount: 0.04, currency: "USD", unit: "image" },
  },
  {
    model: "gpt-image-2",
    label: "GPT Image 2",
    // ★ 既有静态表把它的路由键定为 `gpt-image-2-ai-gateway`(与 NewAPI 的 `gpt-image-2`、
    //   sufy 的 `gpt-image-2-sufy` 区分)。缺省实例下必须沿用,否则存量枚举变了。
    defaultRouteKey: "gpt-image-2-ai-gateway",
    pricing: { amount: 0.04, currency: "USD", unit: "image" },
  },
  {
    model: "qwen-image",
    label: "Qwen Image",
    defaultRouteKey: "qwen-image",
    pricing: { amount: 0.2, currency: "CNY", unit: "image" },
  },
];

/** 派生该实例凭据所在的 env 变量名(与跨进程契约的键名规则一致)。 */
function instanceKeyEnvVar(instanceId: string): string {
  if (instanceId === DEFAULT_INSTANCE_ID) return "PI_WEB_AI_GATEWAY_SESSION_KEY";
  const safe = instanceId.toUpperCase().replace(/-/g, "_");
  return `PI_WEB_AI_GATEWAY_SESSION_${safe}_KEY`;
}

/** 派生路由键:缺省实例沿用既有键,其余加实例后缀以保证唯一。 */
function routeKeyFor(decl: GatewayImageModelDecl, instanceId: string): string {
  return instanceId === DEFAULT_INSTANCE_ID
    ? decl.defaultRouteKey
    : `${decl.model}-${instanceId}`;
}

/**
 * 取该实例应暴露的模型集合(Req 4.1/4.2)。
 *
 * - 授予**未声明**图像清单(`undefined`)→ 内置白名单全集(与本特性引入前一致)。
 * - 授予声明了清单 → 与白名单取**交集**。
 *
 * ★ 空数组必须产出空集,不能当成"未声明"回退全集 —— 那会让"云端明确说这个账号没有
 *   图像模型"变成"列出全部白名单模型,选中才失败"(Req 4.2 的反面)。
 */
export function selectGatewayImageModels(
  instance: GatewayImageInstance,
): readonly GatewayImageModelDecl[] {
  if (instance.imageModels === undefined) return GATEWAY_IMAGE_MODEL_WHITELIST;
  const allowed = new Set(instance.imageModels.map((m) => m.trim()));
  return GATEWAY_IMAGE_MODEL_WHITELIST.filter((d) => allowed.has(d.model));
}

/** 一个实例产出的两组路由。 */
export interface GatewayImageRouteSet {
  readonly generation: readonly ImageRoute[];
  readonly edit: readonly ImageRoute[];
}

/**
 * 为单个网关实例生成图像路由(文生图 + 图像编辑)。
 *
 * 展示归属 = 实例标识(Req 5.1/5.2):部署方把实例指向哪个网关,界面上就显示哪个,不再是
 * 写死的名字。
 */
export function createGatewayImageRoutes(
  instance: GatewayImageInstance,
): GatewayImageRouteSet {
  const config = gatewayInstanceImageConfig({
    instanceId: instance.instanceId,
    baseUrl: instance.baseUrl,
    apiKeyVar: instanceKeyEnvVar(instance.instanceId),
  });
  const decls = selectGatewayImageModels(instance);
  const generation: ImageRoute[] = [];
  const edit: ImageRoute[] = [];
  for (const decl of decls) {
    const routeKey = routeKeyFor(decl, instance.instanceId);
    const args = {
      model: decl.model,
      label: `${decl.label} · ${instance.instanceId}`,
      description: `${decl.label} via gateway instance ${instance.instanceId}.`,
      providerModel: decl.model,
    };
    generation.push(
      createGatewayInstanceImage(config, args, { model: routeKey, pricing: decl.pricing }),
    );
    edit.push(
      createGatewayInstanceImageEdit(config, args, { model: routeKey, pricing: decl.pricing }),
    );
  }
  return { generation, edit };
}

/**
 * 为一批实例生成并拼接路由。
 *
 * 实例间路由键已由 {@link routeKeyFor} 保证不撞;此处不再去重,以免掩盖上游的标识冲突。
 */
export function createGatewayImageRoutesForAll(
  instances: readonly GatewayImageInstance[],
): GatewayImageRouteSet {
  const generation: ImageRoute[] = [];
  const edit: ImageRoute[] = [];
  for (const inst of instances) {
    const set = createGatewayImageRoutes(inst);
    generation.push(...set.generation);
    edit.push(...set.edit);
  }
  return { generation, edit };
}
