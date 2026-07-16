/**
 * 分面 scoped token 的签名 secret 解析(spec sandbox-credentials-v2,Req 1.5)。
 *
 * 每个服务面(LLM 网关、附件、…)使用相互独立的 secret 族,使单一服务面的 secret
 * 泄露不波及其他面(design.md Security Considerations)。各面的解析遵循同一回退惯例:
 * 优先本面专属 env,回退复用附件系统已建立的主/子进程 secret 分发通道
 * `PI_WEB_ATTACHMENT_SECRET`;两者皆缺时抛清晰错误——代理模式下 secret 必须来自稳定
 * 来源,不可静默回退随机值(否则宿主签发的 token 校验方必然失败)。
 *
 * 注意:即便某面与附件系统共用同一 secret 值,`scoped-token.ts` 的签名域前缀
 * `pi-token.v2.<scope>.` 也确保其 token 与附件签名 URL、其他面的 token 互不可换
 * (见 scoped-token.ts 的域隔离说明与对应单测)。
 */

/** 回退复用的附件系统 secret 环境变量名(各面共享的回退源)。 */
const ATTACHMENT_SECRET_ENV = "PI_WEB_ATTACHMENT_SECRET";

/**
 * 按 secret 族解析签名 secret:优先 `primaryEnv`,回退 `PI_WEB_ATTACHMENT_SECRET`,
 * 皆缺抛错。供各服务面以自身专属 env 名参数化调用。
 *
 * @param primaryEnv 本面专属 secret 环境变量名(优先来源)。
 * @param env        环境变量来源(默认 `process.env`,便于测试注入)。
 * @param faceLabel  错误文案中标识的服务面(如 "llm-gateway"),便于运维定位。
 */
export function resolveScopedTokenSecret(
  primaryEnv: string,
  env: NodeJS.ProcessEnv = process.env,
  faceLabel = "scoped-token",
): string {
  const fromPrimary = env[primaryEnv];
  if (fromPrimary && fromPrimary.length > 0) return fromPrimary;
  const fromAttachment = env[ATTACHMENT_SECRET_ENV];
  if (fromAttachment && fromAttachment.length > 0) return fromAttachment;
  throw new Error(
    `[${faceLabel}] 缺少签名 secret:请设置 ${primaryEnv}(推荐)或 ${ATTACHMENT_SECRET_ENV}(回退复用附件系统 secret)。`,
  );
}

/** LLM 网关面专属 secret 环境变量名。 */
export const LLM_GATEWAY_SECRET_ENV = "PI_WEB_LLM_GATEWAY_SECRET";

/**
 * LLM 网关面 secret 解析(Req 1.5):优先 `PI_WEB_LLM_GATEWAY_SECRET`,回退
 * `PI_WEB_ATTACHMENT_SECRET`,皆缺抛清晰错误。
 *
 * @param env 环境变量来源(默认 `process.env`,便于测试注入)。
 */
export function resolveLlmGatewaySecret(
  env: NodeJS.ProcessEnv = process.env,
): string {
  return resolveScopedTokenSecret(LLM_GATEWAY_SECRET_ENV, env, "llm-gateway");
}
