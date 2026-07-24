/**
 * 登录 / 身份的 **mock 接入** —— 用 pi-clouds 的端口范式(`SupabaseAuth.AuthUser`),以 aigc-agent
 * 旧法(components/auth-status.tsx)模拟;**日后迁移到 pi-clouds**(getCurrentIdentity 换真
 * `SupabaseAuth.getUserFromToken` / cloud-app tenant 解析,tenantId 供 PLATFORM_CALLBACK 绑定)。
 *
 * 现为**纯客户端 mock**:无真凭证、无后端、不收集密码——仅演示「登录 UI + 身份传递」范式,
 * 让 example 在无 pi-clouds/Supabase 时也能呈现账号态。切勿当真认证用。
 */

/** pi-clouds `adapters-aliyun` SupabaseAuth.AuthUser 同构(userId + 可选 email),另带 AIGC 平台租户。 */
export interface AuthUser {
  readonly userId: string;
  readonly email?: string;
  /** AIGC 平台租户(pi-clouds tenant);mock 下取固定 demo 租户,日后由 pi-clouds 会话解析。 */
  readonly tenantId?: string;
}

const MOCK_KEY = "aigc-agent:mock-identity";
const SIGNED_OUT = "signed-out";
const DEFAULT_MOCK: AuthUser = { userId: "mock-user", email: "demo@aigc.local", tenantId: "demo-tenant" };

/**
 * 取当前身份。mock:从 localStorage 读(默认已登录 demo 用户;登出后返回 null)。
 * 日后 → pi-clouds:服务端从会话 access token 经 SupabaseAuth 解析 AuthUser。
 */
export function getCurrentIdentity(): AuthUser | null {
  try {
    const raw = globalThis.localStorage?.getItem(MOCK_KEY);
    if (raw === SIGNED_OUT) return null;
    if (raw != null && raw !== "") return JSON.parse(raw) as AuthUser;
  } catch {
    /* localStorage 不可用 → 回落默认 mock */
  }
  return DEFAULT_MOCK;
}

/** mock 登出(仅置本地标记;日后 → pi-clouds signOut + 清会话 cookie)。 */
export function mockSignOut(): void {
  try {
    globalThis.localStorage?.setItem(MOCK_KEY, SIGNED_OUT);
  } catch {
    /* ignore */
  }
}

/** mock 登入(清标记回默认 demo 用户;日后 → pi-clouds 登录流)。 */
export function mockSignIn(): void {
  try {
    globalThis.localStorage?.removeItem(MOCK_KEY);
  } catch {
    /* ignore */
  }
}
