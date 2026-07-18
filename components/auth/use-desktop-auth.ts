"use client";

/**
 * desktop-cloud-login 任务 5.1 · 鉴权 hook(Req 1.1/3.6/3.7/6.1)。
 *
 * 读 `GET /api/auth/me` 得登录态;提供 login(credential)/logout;暴露「云端登录是否启用」
 * (端点 404 = 未启用 → 无登录入口,Req 4.2)。会话流 egress 失效(外部经 `markSessionAuthFailure`
 * 通知)→ 置「需重登」态并停止以失效身份继续(Req 3.6/3.7/6.1)。
 *
 * login 成功后**双汇**:① 已写入 server 进程内登录态(POST 返回即代表);② 经桌面壳桥持久化
 * keychain(Req 2.1/2.3),失败不阻断登录态(内存态仍有效)。
 */
import * as React from "react";
import { getPiWebDesktopBridge } from "@/lib/app/desktop-bridge.js";

/** 登录态投影(镜像 server AuthSnapshot,不含凭据明文)。 */
export interface DesktopAuthState {
  /** 云端登录是否启用(端点存在)。未启用 → 不渲染登录入口。 */
  readonly enabled: boolean;
  /** 是否已登录。 */
  readonly loggedIn: boolean;
  readonly userId?: string;
  readonly companyId?: string;
  readonly exp?: number;
  /** valid / expired / refreshing;或本地感知的会话失效 `session-failed`。 */
  readonly status?: "valid" | "expired" | "refreshing" | "session-failed";
}

export interface UseDesktopAuthResult extends DesktopAuthState {
  /** 加载中(首次 /auth/me 未回)。 */
  readonly loading: boolean;
  /** 用桌面凭据登录:POST server + 持久化 keychain。返回是否成功。 */
  readonly login: (credential: string) => Promise<{ ok: boolean; reason?: string }>;
  /** 登出:清 server 登录态 + 清 keychain。 */
  readonly logout: () => Promise<void>;
  /** 会话流侦测到 egress 身份失效时调用 → 置需重登态(不改 server,仅 UI 提示)。 */
  readonly markSessionAuthFailure: () => void;
  /** 重新拉取 /auth/me。 */
  readonly refresh: () => Promise<void>;
}

type MeResponse =
  | { loggedIn: false }
  | {
      loggedIn: true;
      userId: string;
      companyId: string;
      exp: number;
      status: "valid" | "expired" | "refreshing";
    };

const NOT_ENABLED: DesktopAuthState = { enabled: false, loggedIn: false };

export function useDesktopAuth(): UseDesktopAuthResult {
  const [state, setState] = React.useState<DesktopAuthState>(NOT_ENABLED);
  const [loading, setLoading] = React.useState(true);

  const refresh = React.useCallback(async () => {
    try {
      const res = await fetch("/api/auth/me", { method: "GET" });
      if (res.status === 404) {
        // 端点未挂载 = 云端登录未启用(Req 4.2)。
        setState(NOT_ENABLED);
        return;
      }
      if (!res.ok) {
        setState({ enabled: true, loggedIn: false });
        return;
      }
      const body = (await res.json()) as MeResponse;
      if (body.loggedIn) {
        setState({
          enabled: true,
          loggedIn: true,
          userId: body.userId,
          companyId: body.companyId,
          exp: body.exp,
          status: body.status,
        });
      } else {
        setState({ enabled: true, loggedIn: false });
      }
    } catch {
      // 网络/契约缺失:降级为未启用(无登录入口,本地路径可用,Req 7.3)。
      setState(NOT_ENABLED);
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    void refresh();
  }, [refresh]);

  const login = React.useCallback(
    async (credential: string): Promise<{ ok: boolean; reason?: string }> => {
      const res = await fetch("/api/auth/session", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ credential }),
      });
      if (!res.ok) {
        const reason = res.status === 401 ? "expired" : "invalid";
        return { ok: false, reason };
      }
      // 双汇之二:持久化到 keychain(桌面壳态;浏览器态无桥,静默跳过)。失败不阻断。
      await getPiWebDesktopBridge()?.storeCredential?.(credential);
      await refresh();
      return { ok: true };
    },
    [refresh],
  );

  const logout = React.useCallback(async () => {
    try {
      await fetch("/api/auth/session", { method: "DELETE" });
    } finally {
      await getPiWebDesktopBridge()?.clearCredential?.();
      await refresh();
    }
  }, [refresh]);

  const markSessionAuthFailure = React.useCallback(() => {
    setState((prev) =>
      prev.loggedIn ? { ...prev, status: "session-failed" } : prev,
    );
  }, []);

  return {
    ...state,
    loading,
    login,
    logout,
    markSessionAuthFailure,
    refresh,
  };
}
