/**
 * 登录 / 身份 —— **真接入**(aigc-agent 老方法:读宿主 `GET /api/auth/me`),形塑为 pi-clouds
 * `adapters-aliyun` `SupabaseAuth.AuthUser` 端口范式,以便**日后无缝迁 pi-clouds**:
 * `getCurrentIdentity` 内把「读宿主会话投影」换成「pi-clouds `SupabaseAuth.getUserFromToken`
 * (会话 access token)→ AuthUser」即可,调用方(auth-status)零改。
 *
 * 非 mock:身份来自 pi-web 宿主真实登录态(packages/server AuthSnapshot),未登录则 null。
 */

/** pi-clouds `SupabaseAuth.AuthUser` 同构(userId + 可选 email),另带 AIGC 平台租户。 */
export interface AuthUser {
  readonly userId: string;
  readonly email?: string;
  /** AIGC 平台租户;宿主 AuthSnapshot 的 companyId 即租户(pi-clouds 下由会话解析)。 */
  readonly tenantId?: string;
}

/** pi-web 宿主 `GET /api/auth/me` 投影(packages/server/src/auth AuthSnapshot)。 */
type AuthMe =
  | { readonly loggedIn: false }
  | {
      readonly loggedIn: true;
      readonly userId: string;
      readonly companyId: string;
      readonly exp: number;
      readonly status: string;
    };

/**
 * 取当前身份(真):宿主 `/api/auth/me` → 映射 `AuthUser`(companyId→tenantId)。
 * 未登录 / 端点不可达 → null(优雅降级,不阻断)。
 * 日后迁 pi-clouds:此处换 `SupabaseAuth.getUserFromToken(sessionToken)`。
 */
export async function getCurrentIdentity(): Promise<AuthUser | null> {
  try {
    const res = await fetch("/api/auth/me", { credentials: "same-origin" });
    if (!res.ok) return null;
    const me = (await res.json()) as AuthMe;
    if (!me.loggedIn) return null;
    return { userId: me.userId, tenantId: me.companyId };
  } catch {
    return null;
  }
}

/** 登出(真,老方法):`DELETE /api/auth/session`。日后迁 pi-clouds signOut。 */
export async function signOut(): Promise<void> {
  try {
    await fetch("/api/auth/session", { method: "DELETE", credentials: "same-origin" });
  } catch {
    /* 忽略;调用方无论如何清本地态 */
  }
}
