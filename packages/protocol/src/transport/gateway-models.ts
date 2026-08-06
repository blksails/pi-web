/**
 * ai-gateway · 会话侧网关模型清单的**反向拉取**帧对
 * （spec ai-gateway-catalog-coldstart，Req 1.1/1.2/4.1）。
 *
 * ## 为什么需要这对帧
 *
 * 会话侧网关模型此前只经 spawn env **推送**：宿主在装配期读目录快照，算好模型 id 清单
 * 塞进子进程环境。但目录是 stale-while-revalidate，**首次拉取完成前恒为空集** ——
 * 服务端重启后、目录就绪前创建的会话因此永远拿不到网关模型（env 在 spawn 时固定，
 * 无补发路径），而部署级目录端点稍后却显示正常。
 *
 * 改为拉取后，时序归属发生转移：**由接收方（runner）在自己就绪时发起**，宿主不必猜
 * 「什么时候推才安全」。更关键的是，目录未就绪时的等待落在**这一次应答内**，而不是
 * 启动期 —— Req 3.1「启动与首个请求不等待上游目录」因此仍然成立。
 *
 * ## ★ 本仓首个「runner 发起 + 宿主应答」的关联往返
 *
 * 既有的关联往返（`ui_rpc`↔`ui_rpc_response`、
 * `agent_attachment_catalog`↔`piweb_attachment_catalog_result`）**全部是宿主发起**。
 * 两个传输方向各自都有先例（runner 上行经 fd1 直写、宿主下行经 stdin），但这个**组合**
 * 是新的：在途表这次落在 runner 侧。
 *
 * 命名沿用既有前缀约定：runner 发起用 `agent_*`，宿主下行用 `piweb_*`。
 *
 * ⚠ 新增上行帧须同时加入 runner 侧上行帧白名单，否则会被静默丢弃 ——
 * 这是既有教训（spec `runner-ready-frame`）。
 */
import { z } from "zod";

/**
 * runner→宿主 请求帧（fd1 直写行）：为列出的实例索取**收敛后**的模型 id 清单。
 *
 * `instanceIds` 只列 runner 侧判定为「待补」（`pendingCatalog`）的实例 —— 装配期已带全
 * 清单的实例走快路径，不产生往返。
 */
export const GatewayModelsRequestFrameSchema = z.object({
  type: z.literal("agent_gateway_models"),
  id: z.string().min(1),
  instanceIds: z.array(z.string().min(1)).min(1),
});
export type GatewayModelsRequestFrame = z.infer<typeof GatewayModelsRequestFrameSchema>;

/**
 * 单个实例的应答条目。
 *
 * `models` 为**收敛后**的清单（归属白名单 + 模型精选白名单已施加），与部署级目录同源 ——
 * runner 侧不得再套用任何过滤，否则两侧收敛口径会漂移，症状是「列表里看得到、选中却说
 * 模型未找到」（Req 5.3）。
 */
export const GatewayModelsInstanceResultSchema = z.object({
  instanceId: z.string().min(1),
  models: z.array(z.string().min(1)),
});
export type GatewayModelsInstanceResult = z.infer<typeof GatewayModelsInstanceResultSchema>;

/**
 * 应答成因（Req 4.1 的可判别性靠它承载，四种成因不可合并成一个「没有」）：
 *
 * - `ready`     — 目录已就绪，`models` 是权威读数（可能确实为空 = 收敛后为空）
 * - `timeout`   — 等待目录首拉超过上限，本次给不出；会话保持既有 fail-soft，可稍后重试
 * - `unavailable` — 该实例在宿主侧不存在或未启用（例如 runner 侧 env 与宿主装配不一致）
 */
export const GatewayModelsResultReasonSchema = z.enum(["ready", "timeout", "unavailable"]);
export type GatewayModelsResultReason = z.infer<typeof GatewayModelsResultReasonSchema>;

/** 宿主→runner 应答帧：按 `id` 回配请求。未知/迟到 id 由 runner 侧在途表安全丢弃。 */
export const GatewayModelsResultFrameSchema = z.object({
  type: z.literal("piweb_gateway_models_result"),
  id: z.string().min(1),
  instances: z.array(GatewayModelsInstanceResultSchema),
  reason: GatewayModelsResultReasonSchema,
});
export type GatewayModelsResultFrame = z.infer<typeof GatewayModelsResultFrameSchema>;

/** 帧类型字面量(单一权威,两侧共用,避免字符串各写一份而漂移)。 */
export const GATEWAY_MODELS_REQUEST_FRAME_TYPE = "agent_gateway_models" as const;
export const GATEWAY_MODELS_RESULT_FRAME_TYPE = "piweb_gateway_models_result" as const;
