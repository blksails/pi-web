/**
 * AuthStatus — 账号状态槽(webext `headerRight`)。
 *
 * 登录**自定义扩展**的 mock 实现:webext 承载登录/身份 UI(Agent Routes 只读、跑子进程,
 * 不能建/写宿主会话,故登录归 webext);现为纯客户端 mock(见 ./auth/mock-identity),
 * **日后迁移到 pi-clouds**(SupabaseAuth 真登录 + tenant → PLATFORM_CALLBACK token)。
 */
import * as React from "react";
import {
  getCurrentIdentity,
  mockSignIn,
  mockSignOut,
  type AuthUser,
} from "./auth/mock-identity.js";

export function AuthStatus(): React.JSX.Element {
  const [me, setMe] = React.useState<AuthUser | null>(() => getCurrentIdentity());
  const label = me?.email ?? me?.userId ?? "未登录";
  const initial = [...label][0] ?? "·";

  const signOut = (): void => {
    mockSignOut();
    setMe(null);
  };
  const signIn = (): void => {
    mockSignIn();
    setMe(getCurrentIdentity());
  };

  const box: React.CSSProperties = {
    display: "flex",
    alignItems: "center",
    gap: 8,
    fontSize: 12,
  };

  if (me === null) {
    return (
      <div style={box} title="登录为 mock 占位,日后接 pi-clouds">
        <button type="button" onClick={signIn} style={{ cursor: "pointer" }}>
          登录(mock)
        </button>
      </div>
    );
  }

  return (
    <div style={box} title={`mock 身份 · tenant=${me.tenantId ?? "-"}(日后接 pi-clouds)`}>
      <span
        aria-hidden="true"
        style={{
          display: "inline-grid",
          placeItems: "center",
          width: 22,
          height: 22,
          borderRadius: "50%",
          background: "#eef2ff",
          color: "#4338ca",
        }}
      >
        {initial}
      </span>
      <span style={{ maxWidth: 140, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {label}
      </span>
      <button type="button" onClick={signOut} style={{ cursor: "pointer" }} aria-label="登出">
        登出
      </button>
    </div>
  );
}
