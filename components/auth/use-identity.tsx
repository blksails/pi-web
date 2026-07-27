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
 * 从身份态派生 agent-sources 列表刷新依赖(纯函数,便于单测)。
 *
 * 登录 / 登出 / 切号均改变返回值 → 驱动 refreshSignal bump。**必须含 userId** ——
 * 只看「是否已登录」的话,A 换成 B 时值不变,列表不会刷新,用户会看到上一个账号的源。
 */
export function identityListKey(state: IdentityUiState): string {
  return state.kind === "authenticated" ? `identity:${state.tenant.userId}` : "no-identity";
}

function parseView(body: IdentityViewBody): IdentityUiState {
  const canExchange = body.canExchange === true;
  if (body.state === "authenticated") {
    const t = body.tenant;
    if (typeof t === "object" && t !== null) {
      const o = t as { userId?: unknown; companyId?: unknown; role?: unknown };
      if (typeof o.userId === "string") {
        // role/companyId 缺失时退回空串而非丢弃整个身份 —— Req 5.3「展示可得的最小
        // 身份信息,不得展示空白或错误」。
        return {
          kind: "authenticated",
          tenant: {
            userId: o.userId,
            companyId: typeof o.companyId === "string" ? o.companyId : "",
            role: typeof o.role === "string" ? o.role : "",
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
      // 桌面壳持久化 at-rest 副本。★ 这里**不传密码**,由壳自己去服务端取凭据的时代
      // 尚未到来 —— 当前壳桥的 storeCredential 需要凭据串,而凭据不进渲染层(Req 8.2),
      // 故此处只触发一次刷新,持久化由服务端启动播种链路承担。
      await refresh();
      return { ok: true };
    },
    [refresh],
  );

  const revoke = React.useCallback(async () => {
    try {
      await fetch("/api/identity", { method: "DELETE" });
    } finally {
      await getPiWebDesktopBridge()?.clearCredential?.();
      setNeedsReauth(false);
      await refresh();
    }
  }, [refresh]);

  const markSessionAuthFailure = React.useCallback(() => {
    setNeedsReauth(true);
  }, []);

  return { state, exchange, revoke, refresh, markSessionAuthFailure, needsReauth };
}
