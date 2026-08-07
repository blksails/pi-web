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

export type LoginMethodId = "password" | "sms" | "wechat";

export interface UseIdentityResult {
  readonly state: IdentityUiState;
  /** 可用登录方式（服务端 methods 投影；缺省 password）。 */
  readonly methods: ReadonlyArray<LoginMethodId>;
  /** 用账号密码换身份。 */
  readonly exchange: (
    email: string,
    password: string,
  ) => Promise<{ ok: boolean; reason?: IdentityExchangeReason }>;
  readonly exchangeSms: (
    phone: string,
    code: string,
  ) => Promise<{ ok: boolean; reason?: IdentityExchangeReason }>;
  readonly sendOtp: (
    phone: string,
  ) => Promise<{ ok: boolean; reason?: IdentityExchangeReason | "rate-limited" }>;
  readonly startWechat: () => Promise<
    | {
        ok: true;
        state: string;
        appid: string;
        redirectUri: string;
        qrConnectUrl: string;
      }
    | { ok: false; reason?: IdentityExchangeReason }
  >;
  readonly pollWechat: (
    state: string,
  ) => Promise<
    | { ok: true; status: "pending" | "claimed" | "unknown" | "error"; error?: string }
    | { ok: true; status: "ready"; credential: string }
    | { ok: false; reason?: IdentityExchangeReason }
  >;
  readonly exchangeWechat: (
    state: string,
    credential: string,
  ) => Promise<{ ok: boolean; reason?: IdentityExchangeReason }>;
  readonly bindPhoneSend: (
    phone: string,
  ) => Promise<{ ok: boolean; error?: string }>;
  readonly bindPhoneVerify: (
    phone: string,
    code: string,
  ) => Promise<{ ok: boolean; error?: string }>;
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
  readonly methods?: unknown;
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

function parseExchangeReason(res: Response, raw: string): IdentityExchangeReason {
  let reason: IdentityExchangeReason =
    res.status === 401
      ? "invalid-credentials"
      : res.status === 400
        ? "invalid-request"
        : res.status === 405
          ? "unsupported"
          : "cloud-unreachable";
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
  return reason;
}

const ALL_LOGIN_METHODS: ReadonlyArray<LoginMethodId> = ["password", "sms", "wechat"];

function parseMethods(body: IdentityViewBody): LoginMethodId[] {
  // 服务端未投 methods（旧进程/未重启）时：能交换凭据则默认三法，避免只剩密码页。
  if (!Array.isArray(body.methods)) {
    return body.canExchange === true ? [...ALL_LOGIN_METHODS] : ["password"];
  }
  const out: LoginMethodId[] = [];
  for (const m of body.methods) {
    if (m === "password" || m === "sms" || m === "wechat") out.push(m);
  }
  if (out.length === 0) {
    return body.canExchange === true ? [...ALL_LOGIN_METHODS] : ["password"];
  }
  // 仅回 password 且 canExchange：多半是旧路由未挂 SMS/微信；仍展示三法，点后 404 再修云端。
  if (out.length === 1 && out[0] === "password" && body.canExchange === true) {
    return [...ALL_LOGIN_METHODS];
  }
  return out;
}

function useIdentityState(): UseIdentityResult {
  const [state, setState] = React.useState<IdentityUiState>({ kind: "loading" });
  const [methods, setMethods] = React.useState<ReadonlyArray<LoginMethodId>>([
    ...ALL_LOGIN_METHODS,
  ]);
  const [needsReauth, setNeedsReauth] = React.useState(false);

  const refresh = React.useCallback(async () => {
    try {
      const res = await fetch("/api/identity", { method: "GET" });
      if (res.status === 404) {
        setState({ kind: "disabled" });
        return;
      }
      if (!res.ok) {
        setState({ kind: "anonymous", canExchange: true });
        return;
      }
      const body = (await res.json()) as IdentityViewBody;
      setMethods(parseMethods(body));
      setState(parseView(body));
    } catch {
      setState({ kind: "disabled" });
    }
  }, []);

  React.useEffect(() => {
    void refresh();
  }, [refresh]);

  const afterLoginOk = React.useCallback(
    async (body: IdentityViewBody) => {
      setState(parseView(body));
      setMethods(parseMethods(body));
      setNeedsReauth(false);
      await getPiWebDesktopBridge()?.syncCredential?.();
      await refresh();
    },
    [refresh],
  );

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
      const raw = await res.text();
      if (!res.ok) return { ok: false, reason: parseExchangeReason(res, raw) };
      try {
        await afterLoginOk(JSON.parse(raw) as IdentityViewBody);
      } catch {
        await refresh();
      }
      return { ok: true };
    },
    [afterLoginOk, refresh],
  );

  const exchangeSms = React.useCallback(
    async (phone: string, code: string) => {
      let res: Response;
      try {
        res = await fetch("/api/identity/exchange", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ method: "sms", phone, code }),
        });
      } catch {
        return { ok: false, reason: "cloud-unreachable" as const };
      }
      const raw = await res.text();
      if (!res.ok) return { ok: false, reason: parseExchangeReason(res, raw) };
      try {
        await afterLoginOk(JSON.parse(raw) as IdentityViewBody);
      } catch {
        await refresh();
      }
      return { ok: true };
    },
    [afterLoginOk, refresh],
  );

  const sendOtp = React.useCallback(async (phone: string) => {
    let res: Response;
    try {
      res = await fetch("/api/identity/otp/send", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ phone }),
      });
    } catch {
      return { ok: false, reason: "cloud-unreachable" as const };
    }
    if (res.status === 429) return { ok: false, reason: "rate-limited" as const };
    if (!res.ok) {
      return {
        ok: false,
        reason: (res.status === 400 ? "invalid-request" : "cloud-unreachable") as const,
      };
    }
    return { ok: true };
  }, []);

  const startWechat = React.useCallback(async () => {
    let res: Response;
    try {
      res = await fetch("/api/identity/wechat/start", { method: "POST" });
    } catch {
      return { ok: false as const, reason: "cloud-unreachable" as const };
    }
    if (!res.ok) return { ok: false as const, reason: "cloud-unreachable" as const };
    try {
      const o = (await res.json()) as {
        state?: string;
        appid?: string;
        redirectUri?: string;
        qrConnectUrl?: string;
      };
      if (
        typeof o.state === "string" &&
        typeof o.appid === "string" &&
        typeof o.redirectUri === "string" &&
        typeof o.qrConnectUrl === "string"
      ) {
        return {
          ok: true as const,
          state: o.state,
          appid: o.appid,
          redirectUri: o.redirectUri,
          qrConnectUrl: o.qrConnectUrl,
        };
      }
    } catch {
      // fallthrough
    }
    return { ok: false as const, reason: "cloud-unreachable" as const };
  }, []);

  const pollWechat = React.useCallback(async (state: string) => {
    let res: Response;
    try {
      res = await fetch(`/api/identity/wechat/poll?state=${encodeURIComponent(state)}`);
    } catch {
      return { ok: false as const, reason: "cloud-unreachable" as const };
    }
    if (!res.ok) return { ok: false as const, reason: "cloud-unreachable" as const };
    try {
      const o = (await res.json()) as {
        status?: string;
        credential?: string;
        error?: string;
      };
      if (o.status === "ready" && typeof o.credential === "string") {
        return { ok: true as const, status: "ready" as const, credential: o.credential };
      }
      if (o.status === "pending" || o.status === "claimed" || o.status === "unknown") {
        return { ok: true as const, status: o.status };
      }
      if (o.status === "error") {
        return {
          ok: true as const,
          status: "error" as const,
          error: typeof o.error === "string" ? o.error : "error",
        };
      }
    } catch {
      // fallthrough
    }
    return { ok: false as const, reason: "cloud-unreachable" as const };
  }, []);

  const exchangeWechat = React.useCallback(
    async (state: string, credential: string) => {
      let res: Response;
      try {
        res = await fetch("/api/identity/exchange", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ method: "wechat", state, credential }),
        });
      } catch {
        return { ok: false, reason: "cloud-unreachable" as const };
      }
      const raw = await res.text();
      if (!res.ok) return { ok: false, reason: parseExchangeReason(res, raw) };
      try {
        await afterLoginOk(JSON.parse(raw) as IdentityViewBody);
      } catch {
        await refresh();
      }
      return { ok: true };
    },
    [afterLoginOk, refresh],
  );

  const bindPhoneSend = React.useCallback(async (phone: string) => {
    try {
      const res = await fetch("/api/identity/phone/bind/send", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ phone }),
      });
      if (!res.ok) return { ok: false, error: "发送失败" };
      return { ok: true };
    } catch {
      return { ok: false, error: "网络错误" };
    }
  }, []);

  const bindPhoneVerify = React.useCallback(async (phone: string, code: string) => {
    try {
      const res = await fetch("/api/identity/phone/bind/verify", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ phone, code }),
      });
      if (!res.ok) return { ok: false, error: "验证失败" };
      return { ok: true };
    } catch {
      return { ok: false, error: "网络错误" };
    }
  }, []);

  const revoke = React.useCallback(async () => {
    try {
      await fetch("/api/identity", { method: "DELETE" });
    } finally {
      await getPiWebDesktopBridge()?.destroyPaneWebviews?.();
      await getPiWebDesktopBridge()?.syncCredential?.();
      setNeedsReauth(false);
      await refresh();
    }
  }, [refresh]);

  const markSessionAuthFailure = React.useCallback(() => {
    setNeedsReauth(true);
  }, []);

  return {
    state,
    methods,
    exchange,
    exchangeSms,
    sendOtp,
    startWechat,
    pollWechat,
    exchangeWechat,
    bindPhoneSend,
    bindPhoneVerify,
    revoke,
    refresh,
    markSessionAuthFailure,
    needsReauth,
  };
}
