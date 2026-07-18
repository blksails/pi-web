"use client";

/**
 * desktop-cloud-login 任务 5.2/5.3 · 登录组件 + 登录态指示(Req 1.1/1.2/1.3/1.4/1.5/6.3)。
 *
 * 单一头部控件,按登录态三分支渲染:
 *  - 未启用(enabled=false)→ 不渲染任何入口(Req 4.2)。
 *  - 已启用未登录 → 「登录」按钮 → 内联表单收桌面凭据 → login()。取消不写入(Req 1.4)。
 *  - 已启用已登录 → 展示用户标识 + 状态(valid/expired/refreshing/session-failed)+ 登出/切号
 *    (Req 1.3/6.3)。失效态显式提示重登(Req 3.7/6.1)。
 *
 * ★ 桌面凭据的获取:生产形态由 pi-cloud 授权流(device 授权)在此承载并回传凭据(外部契约,
 *   本仓不拥有);本组件承接「已获得凭据」这一步 → POST server + 持久化 keychain(见 useDesktopAuth)。
 *   MVP/测试下由表单直接收凭据串(授权流完成的产物)。
 */
import * as React from "react";
import { useDesktopAuth } from "./use-desktop-auth.js";

const BTN =
  "inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs hover:bg-accent";

export function LoginControl(): React.JSX.Element | null {
  const auth = useDesktopAuth();
  const [formOpen, setFormOpen] = React.useState(false);
  const [credential, setCredential] = React.useState("");
  const [error, setError] = React.useState<string | undefined>(undefined);
  const [busy, setBusy] = React.useState(false);

  // 未启用 → 无登录入口(Req 4.2)。加载中也先不渲染,避免闪烁。
  if (!auth.enabled || auth.loading) return null;

  const submit = async () => {
    const cred = credential.trim();
    if (cred.length === 0) {
      setError("请输入授权凭据");
      return;
    }
    setBusy(true);
    setError(undefined);
    const result = await auth.login(cred);
    setBusy(false);
    if (result.ok) {
      setCredential("");
      setFormOpen(false);
    } else {
      // 可读失败原因,不泄漏敏感细节(Req 1.5)。
      setError(result.reason === "expired" ? "凭据已过期,请重新授权" : "凭据无效");
    }
  };

  const cancel = () => {
    // 取消 → 不写入任一汇(Req 1.4)。
    setCredential("");
    setError(undefined);
    setFormOpen(false);
  };

  if (!auth.loggedIn) {
    if (!formOpen) {
      return (
        <button
          type="button"
          className={BTN}
          data-testid="login-open"
          onClick={() => setFormOpen(true)}
        >
          登录
        </button>
      );
    }
    return (
      <div className="flex items-center gap-1" data-testid="login-form">
        <input
          type="password"
          className="rounded-md border border-border px-2 py-1 text-xs"
          placeholder="授权凭据"
          value={credential}
          data-testid="login-credential"
          onChange={(e) => setCredential(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") void submit();
            if (e.key === "Escape") cancel();
          }}
          autoFocus
        />
        <button
          type="button"
          className={BTN}
          data-testid="login-submit"
          disabled={busy}
          onClick={() => void submit()}
        >
          确认
        </button>
        <button type="button" className={BTN} data-testid="login-cancel" onClick={cancel}>
          取消
        </button>
        {error !== undefined && (
          <span className="text-xs text-destructive" data-testid="login-error">
            {error}
          </span>
        )}
      </div>
    );
  }

  // 已登录:标识 + 状态 + 登出/切号。
  const failed = auth.status === "session-failed" || auth.status === "expired";
  return (
    <div className="flex items-center gap-1" data-testid="login-status">
      <span className="text-xs text-muted-foreground" data-testid="login-user">
        {auth.userId}
      </span>
      {failed && (
        <span className="text-xs text-destructive" data-testid="login-needs-reauth">
          需重新登录
        </span>
      )}
      {failed && (
        <button
          type="button"
          className={BTN}
          data-testid="login-reauth"
          onClick={() => {
            setFormOpen(true);
            // 切到未登录视觉不必要:直接开表单收新凭据即可(切号语义由 server set 替换)。
          }}
        >
          重新登录
        </button>
      )}
      <button
        type="button"
        className={BTN}
        data-testid="logout"
        onClick={() => void auth.logout()}
      >
        登出
      </button>
      {/* 需重登时的内联表单(与登出并存,收新凭据完成切号/续期)。 */}
      {formOpen && (
        <div className="flex items-center gap-1" data-testid="reauth-form">
          <input
            type="password"
            className="rounded-md border border-border px-2 py-1 text-xs"
            placeholder="授权凭据"
            value={credential}
            data-testid="reauth-credential"
            onChange={(e) => setCredential(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void submit();
              if (e.key === "Escape") cancel();
            }}
            autoFocus
          />
          <button
            type="button"
            className={BTN}
            data-testid="reauth-submit"
            disabled={busy}
            onClick={() => void submit()}
          >
            确认
          </button>
          <button type="button" className={BTN} data-testid="reauth-cancel" onClick={cancel}>
            取消
          </button>
          {error !== undefined && (
            <span className="text-xs text-destructive" data-testid="reauth-error">
              {error}
            </span>
          )}
        </div>
      )}
    </div>
  );
}
