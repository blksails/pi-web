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
  RUNNER_AI_GATEWAY_BASE_ENV,
  RUNNER_AI_GATEWAY_KEY_ENV,
  RUNNER_AI_GATEWAY_MODELS_ENV,
  isSessionCapableGatewayModel,
} from "@blksails/pi-web-adapters/ai-gateway/index.js";
import type {
  GatewayModelEntry,
} from "@blksails/pi-web-server";
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
  if (modelIds.length === 0) return { env: {} };

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
      [RUNNER_AI_GATEWAY_MODELS_ENV]: serialized,
    },
  };
}
