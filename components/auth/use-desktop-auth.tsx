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
 *
 * desktop-hybrid-agent-sources:状态经 {@link DesktopAuthProvider} **共享**——LoginControl 与
 * ChatApp 必须读同一实例,否则登录/登出不会 bump agent-sources 刷新信号。
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

const DesktopAuthContext = React.createContext<UseDesktopAuthResult | null>(null);

/**
 * 组件树内单一桌面登录态。ChatApp 必须包一层;LoginControl 与列表刷新共用同一 state。
 */
export function DesktopAuthProvider(props: {
  readonly children: React.ReactNode;
}): React.JSX.Element {
  const value = useDesktopAuthState();
  return (
    <DesktopAuthContext.Provider value={value}>
      {props.children}
    </DesktopAuthContext.Provider>
  );
}

/**
 * 读共享桌面登录态。**必须**在 {@link DesktopAuthProvider} 内调用。
 */
export function useDesktopAuth(): UseDesktopAuthResult {
  const ctx = React.useContext(DesktopAuthContext);
  if (ctx === null) {
    throw new Error(
      "useDesktopAuth must be used within DesktopAuthProvider (shared login state for agent-sources refresh)",
    );
  }
  return ctx;
}

/**
 * 从登录身份键派生 agent-sources 列表刷新依赖(纯函数,便于单测)。
 * 登录/登出/切号均改变返回值 → 驱动 refreshSignal bump。
 */
export function desktopAuthListIdentity(auth: {
  readonly loggedIn: boolean;
  readonly userId?: string;
}): string {
  if (!auth.loggedIn) return "logged-out";
  return `logged-in:${auth.userId ?? ""}`;
}

/** 实际状态实现(仅 Provider 使用)。 */
function useDesktopAuthState(): UseDesktopAuthResult {
  const [state, setState] = React.useState<DesktopAuthState>(NOT_ENABLED);
  const [loading, setLoading] = React.useState(true);

  const refresh = React.useCallback(async () => {
    try {
      const res = await fetch("/api/auth/me", { method: "GET" });
      if (res.status === 404) {
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
