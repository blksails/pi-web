/**
 * ai-gateway-session-assembly — 本地分支的网关会话模型下发决策，抽成纯函数以便脱离
 * 真实装配单测（spec ai-gateway-session-models，design.md §D1/D3，Req 2.1/2.3/2.5/7.1）。
 *
 * 与 `ai-gateway-assembly.ts`（e2b 分支：注入 public base + scoped token）分工不同：
 * 本模块面向**本地 agent 子进程**，直接下发网关基址与真实凭据。
 *
 * ★为何本地可以下发真实凭据（design.md §D1 决策记录）：
 * `pi-handler.ts` 的本地 spawn env 本就携带 `...config.providerKeys`（真实 provider key），
 * 换钥网关（`llm-gateway`）是专为 **e2b 沙箱**那道边界建的
 * （`llm-gateway-assembly.ts:27` 写明仅 e2b 分支替换）。故本模块与既有 provider key
 * 处于**同一信任边界、同一下发形态**，不新增暴露面，也不落盘。
 *
 * ★env 命名硬约束：绝不可沿用 `AI_GATEWAY_API_KEY` —— 该名会被 pi 子进程继承并被 pi-ai
 * 当作 Vercel AI Gateway 官方凭据，劫持**全部**模型调用返回 401（pi-clouds 8.2 事故）。
 * 本模块只产出 `PI_WEB_AI_GATEWAY_SESSION_*` 前缀的键。
 */
import {
  AI_GATEWAY_PROVIDER_NAME,
  AI_GATEWAY_SESSION_INSTANCES_ENV,
  RUNNER_AI_GATEWAY_BASE_ENV,
  RUNNER_AI_GATEWAY_KEY_ENV,
  RUNNER_AI_GATEWAY_MODELS_ENV,
  isSessionCapableGatewayModel,
  sessionInstanceEnvPrefix,
} from "@blksails/pi-web-adapters/ai-gateway/index.js";
import type { GatewayModelEntry } from "@blksails/pi-web-server";
import type { AiGatewayConfig } from "@blksails/pi-web-adapters/ai-gateway/index.js";

/**
 * 模型清单序列化字节数告警阈值。
 *
 * env 单值在 Linux 上约 128KB 上限。实测 CF 白名单收敛后 470 条 ≈ 15KB；若白名单被放宽
 * 到不过滤（2465 条 ≈ 80KB）就逼近上限。超阈值时告警，使「模型莫名少了/spawn 失败」
 * 这类故障有迹可循，而不是静默截断（design.md §D3）。
 */
export const MODELS_ENV_WARN_BYTES = 64 * 1024;

/** 最小日志出口（测试可注入以断言可观测性且不泄露凭据）。 */
export interface AiGatewaySessionAssemblyLogger {
  info(msg: string, data?: Record<string, unknown>): void;
  warn(msg: string, data?: Record<string, unknown>): void;
}

/** `computeAiGatewaySessionSpawnEnv` 的结果。 */
export interface AiGatewaySessionSpawnEnvResult {
  /** 待并入本地 spawn spec 的 env 键值对；未启用/无凭据/空目录时为空对象。 */
  readonly env: Readonly<Record<string, string>>;
}

/**
 * 计算注入本地 runner 的网关会话 env（三件套：基址 / 凭据 / 模型 id 清单）。
 *
 * 纯函数：不读 `process.env`，不打网络。目录快照由调用方以
 * `GatewayModelCatalog.get()`（同步、stale-while-revalidate）取得。
 *
 * @param input.aiGatewayConfig `resolveAiGatewayConfig(process.env)` 的结果；
 *   `undefined` = 套件未启用 → 空对象（Req 2.5）。
 * @param input.apiKey 网关真实凭据（`EnvKeyResolver` 解析所得）；缺失 → 空对象。
 * @param input.catalog 已按白名单收敛的目录快照；为空 → 空对象
 *   （没有模型的 provider 无意义，注册了只会让 find 徒劳失败）。
 * @param input.logger 可选；记条目数与字节数（**绝不记凭据**，Req 2.3/7.1）。
 */
export function computeAiGatewaySessionSpawnEnv(input: {
  readonly aiGatewayConfig: AiGatewayConfig | undefined;
  readonly apiKey: string | undefined;
  readonly catalog: readonly GatewayModelEntry[];
  readonly logger?: AiGatewaySessionAssemblyLogger;
}): AiGatewaySessionSpawnEnvResult {
  const { aiGatewayConfig, apiKey, catalog, logger } = input;

  if (aiGatewayConfig === undefined) return { env: {} };

  const key = apiKey?.trim();
  if (key === undefined || key.length === 0) return { env: {} };

  // ★与 `mergeModelCatalog` 用**同一个** `isSessionCapableGatewayModel` 判据(Req 4.1)：
  // 两侧若漂移，就会出现「列表里看得到、选中却说模型未找到」的错位。
  const modelIds = catalog
    .map((e) => e.model)
    .filter((id) => id.length > 0 && isSessionCapableGatewayModel(id));
  // ★ 空模型集**不再**否决该实例(spec ai-gateway-catalog-coldstart,Req 1.1);
  //   与复数版 `computeAiGatewaySessionsSpawnEnv` 保持同一门控 —— 凭据齐备即下发
  //   BASE/KEY，MODELS 仅在非空时附带，其余由会话侧拉取补齐。
  const serialized = JSON.stringify(modelIds);
  const bytes = Buffer.byteLength(serialized, "utf8");
  if (bytes > MODELS_ENV_WARN_BYTES) {
    logger?.warn("ai-gateway session models env is large", {
      models: modelIds.length,
      bytes,
      threshold: MODELS_ENV_WARN_BYTES,
    });
  }
  logger?.info("ai-gateway session models delivered", {
    models: modelIds.length,
    bytes,
  });

  // 网关 base 取到兼容根（如 CF 的 `…/compat`），registry 需要含 `/v1` 的 OpenAI 兼容根。
  // 与 `GatewayModelCatalog` 拼 `${baseUrl}/v1/models` 同一层级约定
  // （cloudflare-chat-provider research §三：CF 容忍多出的 `/v1`，实测 200）。
  const baseUrl = `${aiGatewayConfig.baseUrl.replace(/\/+$/, "")}/v1`;

  return {
    env: {
      [RUNNER_AI_GATEWAY_BASE_ENV]: baseUrl,
      [RUNNER_AI_GATEWAY_KEY_ENV]: key,
      ...(modelIds.length > 0 ? { [RUNNER_AI_GATEWAY_MODELS_ENV]: serialized } : {}),
    },
  };
}

/** 单个网关实例的会话 spawn env 输入(多实例版,spec multi-gateway-providers 任务 3.6)。 */
export interface AiGatewaySessionInstanceInput {
  /** 实例标识(即其会话 provider 名,Req 1.2)。 */
  readonly instanceId: string;
  /** 该实例的网关 base URL(不含尾斜杠;`/v1` 由本函数补)。 */
  readonly baseUrl: string;
  /** 该实例的凭据;`undefined`/空白 → 该实例视为未启用(fail-soft,不影响其他实例)。 */
  readonly apiKey: string | undefined;
  /** 该实例已按白名单收敛的目录快照。 */
  readonly catalog: readonly GatewayModelEntry[];
}

/**
 * 计算注入本地 runner 的**多实例**网关会话 env(spec multi-gateway-providers 任务 3.6,
 * Req 1.1/1.3)。
 *
 * 纯函数,零 IO;逐实例套用与单实例版 {@link computeAiGatewaySessionSpawnEnv} 相同的
 * 门控(缺凭据 / 目录为空 → 该实例跳过,不影响其余实例——fail-soft,与
 * `resolveAiGatewaySessionSpecsFromEnv` runner 侧的解析同惯例)。
 *
 * 序列化形态按有效实例数分两态:
 * - **零个有效实例** → 空对象(套件未启用/全部实例未就绪)。
 * - **恰好一个有效实例且其标识等于缺省实例 id**({@link AI_GATEWAY_PROVIDER_NAME},
 *   即旧名单实例部署合成的那个)→ 产出**扁平三件套**(`PI_WEB_AI_GATEWAY_SESSION_
 *   BASE/_KEY/_MODELS`),与改造前逐字节一致(Req 9.1)——runner 侧
 *   `resolveAiGatewaySessionSpecFromEnv` 的回落路径按此形态解析。
 * - **其余情形**(2+ 个有效实例;或恰好 1 个但标识非缺省)→ 产出
 *   {@link AI_GATEWAY_SESSION_INSTANCES_ENV} 列出全部有效实例标识,逐实例再产出
 *   `PI_WEB_AI_GATEWAY_SESSION_<ID>_BASE/_KEY/_MODELS`(`<ID>` 派生规则见
 *   {@link sessionInstanceEnvPrefix},与 runner 侧 `resolveAiGatewaySessionSpecsFromEnv`
 *   同一函数,防止两侧漂移)——即便只有一个非缺省标识的实例,也走本形态,否则
 *   runner 会把它注册成 `ai-gateway`(缺省名),与部署级目录里该实例的真实标识错位。
 *
 * @param input.instances 逐实例输入;调用方(`lib/app/pi-handler.ts`)按
 *   `resolveGatewayInstances` 的解析结果 + 各自的 `GatewayModelCatalog.get()` 快照构造。
 * @param input.logger 可选;每个产出的实例各记一条 info(**绝不记凭据**,Req 2.3/7.1)。
 */
export function computeAiGatewaySessionsSpawnEnv(input: {
  readonly instances: readonly AiGatewaySessionInstanceInput[];
  readonly logger?: AiGatewaySessionAssemblyLogger;
}): AiGatewaySessionSpawnEnvResult {
  const { instances, logger } = input;

  interface Resolved {
    readonly instanceId: string;
    readonly baseUrl: string;
    readonly apiKey: string;
    readonly modelIds: readonly string[];
  }

  const resolved: Resolved[] = [];
  for (const instance of instances) {
    const key = instance.apiKey?.trim();
    if (key === undefined || key.length === 0) {
      // ★ 成因可判别(Req 4.1):凭据缺失此前是**静默** continue —— 在界面上与「目录还没
      //   拉到」「收敛后为空」「实例没声明」长得一模一样,排查时只能逐个试。现在指名记录。
      //   凭据本身绝不入日志(Req 4.2),这里只记实例标识与成因。
      logger?.info("ai-gateway session instance skipped", {
        instanceId: instance.instanceId,
        cause: "credential-missing",
      });
      continue;
    }
    // ★与单实例版同一判据(Req 4.1):两侧若漂移会出现「列表里看得到、选中却说模型未找到」。
    const modelIds = instance.catalog
      .map((e) => e.model)
      .filter((id) => id.length > 0 && isSessionCapableGatewayModel(id));
    // ★ 这里**不再**因「模型集为空」跳过该实例(spec ai-gateway-catalog-coldstart,Req 1.1)。
    //   目录快照是 stale-while-revalidate,首次拉取完成前恒为空集;旧的 `continue` 把这一
    //   瞬时状态当成「该实例不可用」,于是服务端重启后、目录就绪前创建的会话,其 runner
    //   里**永远**没有网关 provider(env 在 spawn 时固定,无补发路径),而部署级目录端点
    //   稍后却显示正常 —— 两条取数链不同源造成的迷惑性缺陷。
    //   现在凭据齐备即下发 BASE/KEY(声明),模型清单为空则不下发 MODELS,由会话侧拉取补齐。
    //   ★ 凭据缺失仍在上面 `continue` —— 两种成因必须保持可判别(Req 4.1)。
    resolved.push({
      instanceId: instance.instanceId,
      baseUrl: `${instance.baseUrl.replace(/\/+$/, "")}/v1`,
      apiKey: key,
      modelIds,
    });
  }

  if (resolved.length === 0) return { env: {} };

  function logDelivered(instanceId: string, modelIds: readonly string[]): void {
    const serialized = JSON.stringify(modelIds);
    const bytes = Buffer.byteLength(serialized, "utf8");
    if (bytes > MODELS_ENV_WARN_BYTES) {
      logger?.warn("ai-gateway session models env is large", {
        instanceId,
        models: modelIds.length,
        bytes,
        threshold: MODELS_ENV_WARN_BYTES,
      });
    }
    // ★ 装配期就区分两条路径(Req 4.1):清单已带全 = 快路径;清单为空 = 待会话侧拉取补齐。
    //   合并成一条「delivered: 0」会与「拉到了但收敛后确实为空」混淆,而后者是配置问题、
    //   前者只是还没到 —— 两者的处置完全不同。
    if (modelIds.length === 0) {
      logger?.info("ai-gateway session models pending backfill", {
        instanceId,
        cause: "catalog-not-ready",
      });
      return;
    }
    logger?.info("ai-gateway session models delivered", {
      instanceId,
      models: modelIds.length,
      bytes,
    });
  }

  // 恰好一个有效实例且为缺省实例 id → 扁平三件套,逐字节兼容改造前(Req 9.1)。
  if (resolved.length === 1 && resolved[0]!.instanceId === AI_GATEWAY_PROVIDER_NAME) {
    const only = resolved[0]!;
    logDelivered(only.instanceId, only.modelIds);
    return {
      env: {
        [RUNNER_AI_GATEWAY_BASE_ENV]: only.baseUrl,
        [RUNNER_AI_GATEWAY_KEY_ENV]: only.apiKey,
        // 与多实例形态同规则:空清单不下发 MODELS,由会话侧拉取补齐。
        ...(only.modelIds.length > 0
          ? { [RUNNER_AI_GATEWAY_MODELS_ENV]: JSON.stringify(only.modelIds) }
          : {}),
      },
    };
  }

  // 2+ 个有效实例,或恰好 1 个但标识非缺省 → 多实例形态(须与 runner 侧
  // `resolveAiGatewaySessionSpecsFromEnv` 的解析规则逐字一致)。
  const env: Record<string, string> = {
    [AI_GATEWAY_SESSION_INSTANCES_ENV]: resolved.map((r) => r.instanceId).join(","),
  };
  for (const r of resolved) {
    const prefix = sessionInstanceEnvPrefix(r.instanceId);
    env[`${prefix}BASE`] = r.baseUrl;
    env[`${prefix}KEY`] = r.apiKey;
    // 模型集为空 → **不下发** MODELS。runner 侧据此判为 `pendingCatalog`,在就绪后
    // 主动向宿主索取收敛后的清单(反向拉取)。下发一个空数组会与「目录已就绪但收敛后
    // 确实为空」混淆,那是另一种成因(Req 4.1)。
    if (r.modelIds.length > 0) {
      env[`${prefix}MODELS`] = JSON.stringify(r.modelIds);
    }
    logDelivered(r.instanceId, r.modelIds);
  }
  return { env };
}
