/**
 * http-api — 可插拔鉴权接缝(接口优先,默认放行)。
 *
 * 仅定义 `AuthResolver` / `AuthorizeSession` 接缝接口与默认放行实现;本 spec 不落地
 * 任何具体鉴权策略、密钥管理或多租户隔离(Req 8.6)。`Router` 在分发前调用:
 * `authResolver` 拒绝→401(Req 8.4),`authorizeSession` 返回 false→403(Req 8.5);
 * 未注入时使用此处的默认放行实现(Req 8.3)。
 */

/** 解析出的身份上下文。未注入 resolver 时为匿名上下文(`anonymous: true`)。 */
export interface AuthContext {
  readonly userId?: string;
  readonly tenantId?: string;
  readonly anonymous: boolean;
}

/** resolver 拒绝标记:返回此形状表示 401(不触达会话)。 */
export interface AuthReject {
  readonly reject: 401;
}

/** 解析请求身份;返回 `AuthContext` 通过,返回 `{ reject: 401 }` 拒绝。 */
export type AuthResolver = (
  req: Request,
) => Promise<AuthContext | AuthReject> | AuthContext | AuthReject;

/** 判定身份是否可对某会话发命令/订阅;返回 false→403。 */
export type AuthorizeSession = (input: {
  readonly auth: AuthContext;
  readonly sessionId: string;
  readonly req: Request;
}) => Promise<boolean> | boolean;

/** 判别一个 resolver 结果是否为拒绝。 */
export function isAuthReject(
  value: AuthContext | AuthReject,
): value is AuthReject {
  return (value as AuthReject).reject === 401;
}

/** 默认放行 resolver:返回匿名上下文(Req 8.3)。 */
export const defaultAuthResolver: AuthResolver = () => ({ anonymous: true });

/** 默认放行 authorize:始终返回 true(Req 8.3)。 */
export const defaultAuthorizeSession: AuthorizeSession = () => true;
