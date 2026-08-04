/**
 * model-options.types — 列模型结果的纯类型(无运行时依赖,尤其不引 pi SDK)。
 *
 * 供 config-routes(注入签名 + /config/models 端点)与 model-options(pi SDK 取数)
 * 共用,使 config-routes 的单测不被迫加载 pi SDK。前端经 GET /api/config/models
 * 拿到同形状 JSON,自行渲染可搜索下拉。
 *
 * `input`/`output` 与放宽后的 `source` 类型(multi-gateway-providers spec 任务 4.1,
 * design.md「core / ModelCatalogService(重构)」组件块;Req 3.3, 3.5, 4.1)是为
 * `ModelCatalogService.query()` 的统一投影铺路:两个字段目前仍是可选 —— 本任务只声明
 * 类型形状,尚无来源在构造 `ModelOption` 时实际填充它们(由后续任务 4.2「使各来源的模型
 * 条目携带类型信息」补齐);`query()` 内部经 `normalizeModalities` 对缺省值兜底补齐。
 */
import type { Modality } from "../model-catalog/modality.js";

/** 单个可选模型(provider + id + 展示名)。 */
export interface ModelOption {
  readonly provider: string;
  readonly id: string;
  readonly name: string;
  /**
   * 来源标记(ai-gateway-providers spec,Req 4.2;放宽为 `string`——
   * multi-gateway-providers spec 任务 4.1,Req 3.5):标明模型条目出自本地配置、
   * 某个网关实例,还是云端下发,不再限定于 `"ai-gateway" | "self"` 两值联合。
   * 仅经 `ai-gateway/model-catalog.ts` 的 `mergeModelCatalog` 聚合后才会附带;
   * 未启用 ai-gateway 套件时该字段不存在(与启用前逐字节一致,Req 1.2)。
   */
  readonly source?: string;
  /**
   * 网关上游渠道名(model-catalog spec,Req 2.3):原网关目录的 `owned_by`
   * (如 `openai-compat`),仅供界面二级分组展示,不进入 providers 列表。
   * 仅经 `ai-gateway/model-catalog.ts` 的 `mergeModelCatalog` 聚合后才会附带;
   * 未启用 ai-gateway 套件时该字段不存在(与启用前逐字节一致,Req 5.4)。
   */
  readonly channel?: string;
  /**
   * 可用性标记(model-catalog spec,Req 3.2/5.4):`"session"` = agent 会话可跑,
   * `"catalog"` = 仅目录展示(网关条目未接入会话选择器)。
   * 仅经 `ai-gateway/model-catalog.ts` 的 `mergeModelCatalog` 聚合后才会附带;
   * 未启用 ai-gateway 套件时该字段不存在(与启用前逐字节一致,Req 5.4)。
   */
  readonly availability?: "session" | "catalog";
  /**
   * 输入类型声明(multi-gateway-providers spec,Req 4.1, 4.7):可选,未声明时
   * `ModelCatalogService.query()` 经 `normalizeModalities` 缺省补齐为空集。
   */
  readonly input?: readonly Modality[];
  /**
   * 输出类型声明(multi-gateway-providers spec,Req 4.1, 4.3, 4.7):可选,未声明时
   * `ModelCatalogService.query()` 经 `normalizeModalities` 按对话模型缺省补齐为
   * `["text"]`。
   */
  readonly output?: readonly Modality[];
}

/** 列模型结果:去重后的 provider 名 + 模型清单。 */
export interface ModelOptions {
  readonly providers: readonly string[];
  readonly models: readonly ModelOption[];
}
