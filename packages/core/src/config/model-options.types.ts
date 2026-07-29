/**
 * model-options.types — 列模型结果的纯类型(无运行时依赖,尤其不引 pi SDK)。
 *
 * 供 config-routes(注入签名 + /config/models 端点)与 model-options(pi SDK 取数)
 * 共用,使 config-routes 的单测不被迫加载 pi SDK。前端经 GET /api/config/models
 * 拿到同形状 JSON,自行渲染可搜索下拉。
 */

/** 单个可选模型(provider + id + 展示名)。 */
export interface ModelOption {
  readonly provider: string;
  readonly id: string;
  readonly name: string;
  /**
   * 来源标记(ai-gateway-providers spec,Req 4.2):`"ai-gateway"` = 网关托管目录,
   * `"self"` = 自配 provider 目录。仅经 `ai-gateway/model-catalog.ts` 的
   * `mergeModelCatalog` 聚合后才会附带;未启用 ai-gateway 套件时该字段不存在
   * (与启用前逐字节一致,Req 1.2)。
   */
  readonly source?: "ai-gateway" | "self";
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
}

/** 列模型结果:去重后的 provider 名 + 模型清单。 */
export interface ModelOptions {
  readonly providers: readonly string[];
  readonly models: readonly ModelOption[];
}
