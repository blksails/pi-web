/**
 * ai-gateway · 会话侧模型清单**反向拉取**的宿主应答实现
 * （spec ai-gateway-catalog-coldstart，任务 2.2；Req 1.1/2.1/3.1/3.3/4.1/5.3）。
 *
 * ## 它解决什么
 *
 * 装配期的目录快照是 stale-while-revalidate，**首次拉取完成前恒为空集**。旧实现把这一
 * 瞬时状态当成「该实例不可用」，于是重启后、目录就绪前创建的会话永远拿不到网关模型。
 * 现在 runner 会在自己就绪后主动索取清单，本模块就是那一问的答复方。
 *
 * ## ★ 为什么在这里等待不违反「启动不阻塞」
 *
 * 目录未就绪时本模块**会等**（`refresh()` + 超时上限）。这个等待落在**会话请求的应答
 * 路径内**——服务端启动、首个请求、其余端点一概不经过它，故 Req 3.1「启动与首个请求
 * 不等待上游目录」仍然成立。这正是选「拉」而非「推」的实质理由：等待的归属跟着请求走。
 *
 * ## 收敛口径唯一
 *
 * 清单一律取自 `GatewayModelCatalog`（归属白名单 + 模型精选白名单已在其内部施加），
 * 本模块**不再做任何过滤**。若在此另加一层，会话侧与部署级目录就会出现两套收敛结果——
 * 症状是「列表里看得到、选中却说模型未找到」（Req 5.3）。
 */
import type { GatewayModelsResolver } from "@blksails/pi-web-server";
import type {
  GatewayInstanceConfig,
  GatewayModelCatalog,
} from "@blksails/pi-web-adapters/ai-gateway/index.js";
import { isSessionCapableGatewayModel } from "@blksails/pi-web-adapters/ai-gateway/index.js";
import { createLogger } from "@blksails/pi-web-logger";

const log = createLogger({ namespace: "server:ai-gateway" });

/**
 * 实例标识类型从 `GatewayInstanceConfig` **派生**,而非新增一条跨包导出:
 * `ProviderId` 目前不在 core / adapters 的任一公开出口上,为本模块单独放开导出面
 * 是不必要的耦合。
 */
type InstanceId = GatewayInstanceConfig["id"];

/**
 * 等待目录首拉的上限。超过即以 `timeout` 如实作答，**不**无限期挂起该请求——
 * 上游不可达时挂起会让 runner 永远等不到答复，既拿不到模型也不知道为什么。
 */
export const DEFAULT_GATEWAY_MODELS_WAIT_MS = 15_000;

export interface GatewayModelsResolverDeps {
  readonly catalogs: ReadonlyMap<InstanceId, GatewayModelCatalog>;
  readonly instances: readonly GatewayInstanceConfig[];
  /** 等待上限;测试注入以避免真实计时。 */
  readonly waitMs?: number;
  /** 测试接缝:观测出口。 */
  readonly logger?: { info(msg: string, data?: Record<string, unknown>): void };
}

function withTimeout(p: Promise<void>, ms: number): Promise<"done" | "timeout"> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve("timeout"), ms);
    // 目录 refresh 自身 fail-soft(不抛),catch 仅为防御未来变更。
    void p
      .then(() => resolve("done"))
      .catch(() => resolve("done"))
      .finally(() => clearTimeout(timer));
  });
}

/**
 * 构造应答器。逐实例取收敛后的快照；快照为空且该实例从未成功拉取过时，触发一次
 * `refresh()` 并等待（带上限）后重取。
 *
 * 成因判定（Req 4.1，四者不可合并）：
 * - 请求的实例在宿主侧不存在 → `unavailable`
 * - 等待超时仍无快照 → `timeout`
 * - 有快照（哪怕收敛后为空数组）→ `ready`
 */
export function makeGatewayModelsResolver(
  deps: GatewayModelsResolverDeps,
): GatewayModelsResolver {
  const waitMs = deps.waitMs ?? DEFAULT_GATEWAY_MODELS_WAIT_MS;
  const logger = deps.logger ?? log;
  // 宿主装配产出的实例标识是权威来源;runner 传上来的是普通字符串,
  // 经本表比对后才收窄为 ProviderId(未命中即 unavailable)。
  const known = new Map<string, InstanceId>(deps.instances.map((i) => [i.id as string, i.id]));

  return async (instanceIds) => {
    const wanted = instanceIds
      .map((id) => known.get(id))
      .filter((id): id is InstanceId => id !== undefined);
    if (wanted.length === 0) {
      logger.info("gateway models request for unknown instances", {
        requested: instanceIds.length,
      });
      return { instances: [], reason: "unavailable" as const };
    }

    let timedOut = false;
    const out: Array<{ instanceId: string; models: readonly string[] }> = [];

    for (const id of wanted) {
      const catalog = deps.catalogs.get(id);
      if (catalog === undefined) continue;

      // 第一次 get() 兼有「取快照」与「若过期则触发后台刷新」两重作用。
      let entries = catalog.get();
      if (entries.length === 0) {
        const outcome = await withTimeout(catalog.refresh(), waitMs);
        if (outcome === "timeout") timedOut = true;
        entries = catalog.get();
      }

      // 与装配层同一判据(session-model-source 的 isSessionCapableGatewayModel)——
      // 两侧若漂移会出现「列表里看得到、选中却说模型未找到」。
      const models = entries
        .map((e) => e.model)
        .filter((m) => m.length > 0 && isSessionCapableGatewayModel(m));
      out.push({ instanceId: id, models });
    }

    // ★ 「等超时了」与「拉到了但收敛后为空」必须区分:前者可重试,后者是配置问题。
    const anyModels = out.some((i) => i.models.length > 0);
    const reason = timedOut && !anyModels ? ("timeout" as const) : ("ready" as const);

    logger.info("gateway models resolved for session", {
      instances: out.map((i) => ({ instanceId: i.instanceId, models: i.models.length })),
      reason,
    });
    return { instances: out, reason };
  };
}
