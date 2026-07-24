/**
 * AuthStatus — 账号状态槽(webext `headerRight`)。
 *
 * 登录**自定义扩展**:webext 承载登录/身份 UI(Agent Routes 只读、跑子进程,不能建/写宿主
 * 会话,故登录归 webext)。**真接入**——身份读 pi-web 宿主真实登录态 `GET /api/auth/me`
 * (aigc-agent 老方法),形塑为 pi-clouds `AuthUser` 范式(见 ./auth/identity),日后无缝迁 pi-clouds。
 * 未登录不渲染不占位(与老法一致;宿主守卫另挡)。
 */
import * as React from "react";
import { getCurrentIdentity, signOut, type AuthUser } from "./auth/identity.js";

export function AuthStatus(): React.JSX.Element | null {
  const [me, setMe] = React.useState<AuthUser | null>(null);
  const [loaded, setLoaded] = React.useState(false);

  React.useEffect(() => {
    let alive = true;
    void getCurrentIdentity().then((u) => {
      if (alive) {
        setMe(u);
        setLoaded(true);
      }
    });
    return () => {
      alive = false;
    };
  }, []);

  // 未登录 / 尚未加载 → 不渲染不占位。
  if (!loaded || me === null) return null;

  const label = me.email ?? me.userId;
  const initial = [...label][0] ?? "·";
  const doSignOut = (): void => {
    void signOut().then(() => setMe(null));
  };

  return (
    <div
      style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12 }}
      title={`tenant=${me.tenantId ?? "-"}`}
    >
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
      <button type="button" onClick={doSignOut} style={{ cursor: "pointer" }} aria-label="登出">
        登出
      </button>
    </div>
  );
}
