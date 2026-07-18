/**
 * ai-gateway-assembly — e2b 分支的 ai-gateway 会话 token 注入决策,抽成纯函数以便脱离
 * 真实 e2b/ws-runner 传输单测(spec ai-gateway-providers,design.md §2.5,Req 4.5)。
 *
 * 与 `llm-gateway-assembly.ts` 的 `computeE2bProviderEnv`(**替换**真实 provider key 的
 * 强制credential-switch)不同,ai-gateway 是**增量可选**能力:未配置 `AI_GATEWAY_BASE_URL`
 * 时零注入(Req 1.2);配置后,若同时也配置了 llm-gateway 的 sandbox-reachable public
 * base(`PI_WEB_LLM_GATEWAY_PUBLIC_BASE`——ai-gateway 路由与 llm-gateway 路由挂载在同一
 * pi-web 部署 `/api` 之下,复用同一 public base 概念),则为该会话铸造一枚
 * `scope="ai-gateway"` 的短期 token,连同网关可达 base 一并经 `PI_AI_GATEWAY_BASE` /
 * `PI_AI_GATEWAY_TOKEN` env 下发进 e2b 沙箱——供沙箱内 agent(经烘焙镜像/models.json 自定义
 * provider,超出本仓范围)按需选用 ai-gateway 目录模型时换钥转发到 `/ai-gateway/*`。
 *
 * 缺 public base 时(ai-gateway 已启用但 llm-gateway 未配置 sandbox-reachable base)
 * 不注入、不报错——沙箱内没有可达路径,注入了也无用;返回一条待记的 warn,提示运维如需
 * 在 e2b 沙箱内使用 ai-gateway 模型需额外配置 `PI_WEB_LLM_GATEWAY_PUBLIC_BASE`。
 *
 * 本地(非 e2b)分支不调用本函数——本地 agent 进程与 pi-web server 同机,是否需要类似
 * 注入留待后续切片按实际 agent-side 消费方式接线(design.md §6 交付边界)。
 */
import { mintScopedToken, resolveAiGatewaySecret } from "@blksails/pi-web-server";
import type { AiGatewayConfig } from "@blksails/pi-web-server";

/** ai-gateway 会话 token 的 scope(`verifyScopedToken({ expectedScope: "ai-gateway" })` 对齐)。 */
export const AI_GATEWAY_TOKEN_SCOPE = "ai-gateway";

/** sandbox-reachable ai-gateway base env 名(沙箱内 agent 读取)。 */
export const AI_GATEWAY_SANDBOX_BASE_ENV = "PI_AI_GATEWAY_BASE";

/** sandbox-reachable ai-gateway scoped token env 名(沙箱内 agent 读取)。 */
export const AI_GATEWAY_SANDBOX_TOKEN_ENV = "PI_AI_GATEWAY_TOKEN";

/** `computeAiGatewaySessionEnv` 的结果。 */
export interface AiGatewaySessionEnvResult {
  /** 待并入 `e2bSpec.env` 的键值对;未启用/缺 public base 时为空对象。 */
  readonly env: Readonly<Record<string, string>>;
  /** `env` 的键集合,调用方须同步并入 `envPassthrough` 白名单才真正可达沙箱。 */
  readonly passthroughKeys: readonly string[];
  /** 仅在"已启用但缺 public base"时出现:待记的 warn 文案。 */
  readonly warn?: string;
}

/**
 * 计算 e2b 分支的 ai-gateway 会话 token 注入(design.md §2.5,Req 4.5)。纯函数:不读
 * `process.env`,调用方显式传入 `env`/`publicBase`,便于测试注入。
 *
 * @param input.aiGatewayConfig  `resolveAiGatewayConfig(process.env)` 的结果;`undefined`
 *   = 套件未启用,零注入(Req 1.2)。
 * @param input.sessionId 绑定 token 的会话标识(与 llm-gateway token 同一会话身份)。
 * @param input.env 环境变量来源(装配处传 `process.env`,便于测试注入 secret)。
 * @param input.publicBase 沙箱可达的本部署 base URL(通常复用 `PI_WEB_LLM_GATEWAY_PUBLIC_BASE`
 *   解析结果);`undefined` = 没有可达路径,不注入(仅 warn)。
 * @param input.tokenTtlMs token 有效期(毫秒);通常与 llm-gateway token 同一 TTL 推导值。
 */
export function computeAiGatewaySessionEnv(input: {
  readonly aiGatewayConfig: AiGatewayConfig | undefined;
  readonly sessionId: string;
  readonly env: NodeJS.ProcessEnv;
  readonly publicBase: string | undefined;
  readonly tokenTtlMs: number;
}): AiGatewaySessionEnvResult {
  const { aiGatewayConfig, sessionId, env, publicBase, tokenTtlMs } = input;

  if (aiGatewayConfig === undefined) {
    return { env: {}, passthroughKeys: [] };
  }

  if (publicBase === undefined || publicBase.length === 0) {
    return {
      env: {},
      passthroughKeys: [],
      warn:
        "ai-gateway 套件已启用(AI_GATEWAY_BASE_URL 已配置),但未配置沙箱可达的部署 " +
        "public base(PI_WEB_LLM_GATEWAY_PUBLIC_BASE):e2b 沙箱内 agent 暂无法换钥转发到 " +
        "/ai-gateway/*。如需在沙箱内使用 ai-gateway 目录模型,请配置该变量。",
    };
  }

  const secret = resolveAiGatewaySecret(env);
  const token = mintScopedToken({
    scope: AI_GATEWAY_TOKEN_SCOPE,
    sessionId,
    ttlMs: tokenTtlMs,
    secret,
  });
  const base = publicBase.replace(/\/+$/, "");
  const sandboxEnv: Record<string, string> = {
    [AI_GATEWAY_SANDBOX_BASE_ENV]: `${base}/api/ai-gateway`,
    [AI_GATEWAY_SANDBOX_TOKEN_ENV]: token,
  };
  return { env: sandboxEnv, passthroughKeys: Object.keys(sandboxEnv) };
}
