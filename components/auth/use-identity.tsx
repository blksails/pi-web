"use client";

/**
 * 身份状态投影(spec: desktop-account-login,任务 7.1;Req 1.5/1.6/5.1-5.3/7.1)。
 *
 * 读 `GET /api/identity` 得四态;提供 `exchange(email,password)` / `revoke()` / `refresh()`。
 *
 * ## ★ 渲染层不得知道自己跑在哪种宿主上(Req 1.5)
 *
 * 这个文件叫 `use-identity` 而不是 `use-desktop-auth`,是刻意的。旧名字里的 "desktop"
 * 是个邀请:下一个改它的人会自然地写 `if (isDesktop) { 显示登录框 }`,而那正是 P5 端口
 * 要消灭的判断 —— 云端多租户宿主打开即已登录,桌面需要填表单,两者的差异**已经**由
 * 端口返回的 `kind` 与 `canExchange` 表达完了。命名是这条约束最廉价的执行手段。
 *
 * 判断该渲染什么,只看两个字段:
 *   - `kind === "disabled"` → 什么都不渲染(云端未配置,Req 2.5)
 *   - `kind === "anonymous" && canExchange` → 渲染登录表单
 *   - `kind === "anonymous" && !canExchange` → 不渲染表单(身份由该宿主自身路径处理)
 *   - `kind === "authenticated"` → 渲染身份 + 登出
 */
import * as React from "react";
import { getPiWebDesktopBridge } from "@/lib/app/desktop-bridge.js";

/** 身份三字段(镜像契约 `CapabilityTenant`)。 */
export interface IdentityTenant {
  readonly userId: string;
  readonly companyId: string;
  readonly role: string;
  /** 人类可读用户名(云端 `profiles.name`)。缺失时展示层退回 `userId`。 */
  readonly displayName?: string;
}

/**
 * 展示用名字:有 `displayName` 用它,否则退回 `userId`。
 *
 * 纯函数,便于单测。★ 只用于展示 —— 身份的权威标识始终是 `userId`,
 * `displayName` 可重名、可为空、可被用户随时改,不得用于任何判定。
 */
export function tenantDisplayName(tenant: IdentityTenant): string {
  const n = tenant.displayName?.trim();
  return n !== undefined && n.length > 0 ? n : tenant.userId;
}

export type IdentityUiState =
  /** 能力面未挂载(GET 404)—— 云端未配置,不该出现任何登录入口。 */
  | { readonly kind: "disabled" }
  | { readonly kind: "loading" }
  | {
      readonly kind: "authenticated";
      readonly tenant: IdentityTenant;
      readonly canExchange: boolean;
    }
  | { readonly kind: "anonymous"; readonly canExchange: boolean };

/** 交换失败原因(镜像契约 `IdentityExchangeFailure`)。 */
export type IdentityExchangeReason =
  | "invalid-credentials"
  | "no-membership"
  | "invalid-request"
  | "cloud-unreachable"
  | "capabilities-failed"
  | "unsupported";

export interface UseIdentityResult {
  readonly state: IdentityUiState;
  /** 用账号密码换身份。 */
  readonly exchange: (
    email: string,
    password: string,
  ) => Promise<{ ok: boolean; reason?: IdentityExchangeReason }>;
  /** 放弃身份(登出)。 */
  readonly revoke: () => Promise<void>;
  readonly refresh: () => Promise<void>;
  /** 会话流侦测到出口身份失效时调用 → 置需重登标记(仅 UI 提示,不改服务端)。 */
  readonly markSessionAuthFailure: () => void;
  /** 是否需要重新登录(会话流侦测到的失效)。 */
  readonly needsReauth: boolean;
}

interface IdentityViewBody {
  readonly state?: unknown;
  readonly tenant?: unknown;
  readonly canExchange?: unknown;
}

const IdentityContext = React.createContext<UseIdentityResult | null>(null);

/** 组件树内单一身份态。ChatApp 必须包一层;登录控件与列表刷新共用同一实例。 */
export function IdentityStateProvider(props: {
  readonly children: React.ReactNode;
}): React.JSX.Element {
  const value = useIdentityState();
  return <IdentityContext.Provider value={value}>{props.children}</IdentityContext.Provider>;
}

export function useIdentity(): UseIdentityResult {
  const ctx = React.useContext(IdentityContext);
  if (ctx === null) {
    throw new Error(
      "useIdentity must be used within IdentityStateProvider (shared identity state for agent-sources refresh)",
    );
  }
  return ctx;
}

/**
 * 从身份态派生身份上下文刷新依赖(纯函数,便于单测)。
 *
 * 登录 / 登出 / 切用户 / 切公司均改变返回值 → 驱动列表刷新。
 * **必须含 userId 与 companyId** —— 同一用户切公司时,runner 另经热刷帧换凭据。
 */
export function identityListKey(state: IdentityUiState): string {
  return state.kind === "authenticated"
    ? `identity:${state.tenant.userId}:${state.tenant.companyId}`
    : "no-identity";
}

function parseView(body: IdentityViewBody): IdentityUiState {
  const canExchange = body.canExchange === true;
  if (body.state === "authenticated") {
    const t = body.tenant;
    if (typeof t === "object" && t !== null) {
      const o = t as {
        userId?: unknown;
        companyId?: unknown;
        role?: unknown;
        displayName?: unknown;
      };
      if (typeof o.userId === "string") {
        // role/companyId 缺失时退回空串而非丢弃整个身份 —— Req 5.3「展示可得的最小
        // 身份信息,不得展示空白或错误」。
        return {
          kind: "authenticated",
          tenant: {
            userId: o.userId,
            companyId: typeof o.companyId === "string" ? o.companyId : "",
            role: typeof o.role === "string" ? o.role : "",
            ...(typeof o.displayName === "string" && o.displayName.trim().length > 0
              ? { displayName: o.displayName.trim() }
              : {}),
          },
          canExchange,
        };
      }
    }
    // 声称已认证却没有可用身份 —— 按未认证处理,避免渲染出一个空的用户名。
    return { kind: "anonymous", canExchange };
  }
  return { kind: "anonymous", canExchange };
}

function useIdentityState(): UseIdentityResult {
  const [state, setState] = React.useState<IdentityUiState>({ kind: "loading" });
  const [needsReauth, setNeedsReauth] = React.useState(false);

  const refresh = React.useCallback(async () => {
    try {
      const res = await fetch("/api/identity", { method: "GET" });
      if (res.status === 404) {
        // 能力面未挂载 = 云端未配置。不是错误,是「这里没有登录这回事」(Req 2.5)。
        setState({ kind: "disabled" });
        return;
      }
      if (!res.ok) {
        setState({ kind: "anonymous", canExchange: true });
        return;
      }
      setState(parseView((await res.json()) as IdentityViewBody));
    } catch {
      // 探测失败与「未启用」对用户的处置相同:不渲染入口,应用照常可用(Req 1.6)。
      setState({ kind: "disabled" });
    }
  }, []);

  React.useEffect(() => {
    void refresh();
  }, [refresh]);

  const exchange = React.useCallback(
    async (email: string, password: string) => {
      let res: Response;
      try {
        res = await fetch("/api/identity/exchange", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ method: "password", email, password }),
        });
      } catch {
        return { ok: false, reason: "cloud-unreachable" as const };
      }
      if (!res.ok) {
        // 服务端把 reason 放在 errorResponse 的字段位;502 有两种成因,只看状态码不够。
        let reason: IdentityExchangeReason =
          res.status === 401
            ? "invalid-credentials"
            : res.status === 400
              ? "invalid-request"
              : res.status === 405
                ? "unsupported"
                : "cloud-unreachable";
        try {
          const raw = await res.text();
          for (const r of [
            "capabilities-failed",
            "cloud-unreachable",
            "invalid-credentials",
            "no-membership",
            "invalid-request",
          ] as const) {
            if (raw.includes(r)) {
              reason = r;
              break;
            }
          }
        } catch {
          // 读不到响应体就用状态码推出来的那个,不影响主流程。
        }
        return { ok: false, reason };
      }
      setState(parseView((await res.json()) as IdentityViewBody));
      setNeedsReauth(false);
      // 让壳把凭据同步进钥匙串,使登录跨重启保留(Req 12)。
      // ★ 这个调用**不带凭据** —— 壳自己带 token 向本地 server 取,凭据不经渲染层(Req 12.5)。
      // best-effort:失败不影响本次会话的登录态,只是下次开应用要重登。
      await getPiWebDesktopBridge()?.syncCredential?.();
      await refresh();
      return { ok: true };
    },
    [refresh],
  );

  const revoke = React.useCallback(async () => {
    try {
      await fetch("/api/identity", { method: "DELETE" });
    } finally {
      // 登出:销毁全部 pane webview（会话已结束，不可仅隐藏）。
      await getPiWebDesktopBridge()?.destroyPaneWebviews?.();
      // 登出:同样交给壳同步一次 —— 此时 server 返回 credential:null,壳据此清钥匙串。
      // 走同一条路径(而非直接 clearCredential),避免「登录一条路、登出另一条路」各自维护。
      await getPiWebDesktopBridge()?.syncCredential?.();
      setNeedsReauth(false);
      await refresh();
    }
  }, [refresh]);

  const markSessionAuthFailure = React.useCallback(() => {
    setNeedsReauth(true);
  }, []);

  return { state, exchange, revoke, refresh, markSessionAuthFailure, needsReauth };
}
