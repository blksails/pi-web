/**
 * bash-default — bang(`!`)shell 命令能力的「无配置」启用默认值(从 env 推导)。
 *
 * 核心契约:**默认关闭**(secure by default)。bash 是任意 shell 执行,属高危能力,
 * 远程/多用户环境必须默认关;仅由部署级 env `PI_WEB_BASH_ENABLED` 显式开启。
 *
 * 语义(与 `resolveLoggingEnvDefault` / `@blksails/logger` 的 env 解析口径一致):
 *  - `PI_WEB_BASH_ENABLED` 未设置 → 关闭。
 *  - 设置且值为 `"false"`(大小写不敏感)或 `"0"` → 关闭。
 *  - 其余非空值(如 `"1"`/`"true"`) → 开启。
 *
 * 该值仅在**服务端**读取,作为路由层安全权威门控的依据(关闭时 `/sessions/:id/bash`
 * 返回 404)。前端体验开关另由构建期内联的 `NEXT_PUBLIC_PI_WEB_BASH_ENABLED` 控制,
 * 二者故意分离,使服务端可彻底关死。
 *
 * 纯函数(env 显式传入),便于单测。
 */
export function resolveBashEnabled(
  env: Record<string, string | undefined> = process.env,
): boolean {
  const raw = env.PI_WEB_BASH_ENABLED;
  if (raw === undefined) return false;
  const v = raw.toLowerCase();
  return v !== "false" && v !== "0";
}
