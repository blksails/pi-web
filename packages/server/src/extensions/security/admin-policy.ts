/**
 * extension-management — 管理员授权门控接缝(Req 7.x)。
 *
 * 消费 `http-api` 的 `AuthContext`(不自建认证,Req 7.5)。默认实现为**显式可见的安全
 * 决策**:默认拒绝(匿名 / 无身份判非管理员),绝不静默把任意调用方视为管理员(Req 7.3)。
 * 部署方可经配置显式开启"开发放行"或提供自定义判定。
 *
 * 安装 / 卸载 / 重载路由在入口调用;只读端点(GET /extensions)不调用(Req 7.1/7.4)。
 */
import type { AuthContext } from "../../http/index.js";
import type { AdminPolicy } from "../ext.types.js";

/**
 * 默认管理员判定:默认拒绝。仅当 `AuthContext` 标记 `anonymous === false` 且携带
 * `userId` 时,且该 `userId` 在显式 `adminUserIds` 名单内,才判为管理员。无显式名单
 * 时一律拒绝(不静默放行,Req 7.3)。
 */
export interface DefaultAdminPolicyConfig {
  /** 显式管理员 userId 名单;为空 → 永远拒绝。 */
  readonly adminUserIds?: readonly string[];
  /**
   * 显式开发放行开关(默认 false)。仅在受控开发环境显式置 true 时,放行任意已认证身份;
   * 仍不放行匿名上下文。这是显式可见的安全决策(Req 7.3)。
   */
  readonly allowAnyAuthenticated?: boolean;
}

/** 构造一个显式默认管理员判定接缝。 */
export function createDefaultAdminPolicy(
  cfg: DefaultAdminPolicyConfig = {},
): AdminPolicy {
  const adminIds = new Set(cfg.adminUserIds ?? []);
  const allowAny = cfg.allowAnyAuthenticated === true;
  return (auth: AuthContext): boolean => {
    // 匿名一律拒绝。
    if (auth.anonymous || auth.userId === undefined) {
      return false;
    }
    if (allowAny) {
      return true;
    }
    return adminIds.has(auth.userId);
  };
}

/** 默认接缝实例:默认拒绝一切(无显式名单)。 */
export const defaultAdminPolicy: AdminPolicy = createDefaultAdminPolicy();
