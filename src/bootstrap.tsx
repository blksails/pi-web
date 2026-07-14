/**
 * 运行时配置的获取与门控(spec vite-spa-migration 任务 4.1,Req 2.1/3.5)。
 *
 * 取代两处 Next 专属的注入:
 *  1. server component 经 props 下传 `defaultSource/defaultModel/defaultCwd/autoStart`;
 *  2. 15 个 `NEXT_PUBLIC_*` 的**构建期内联**(故 CLI 运行时设置它们其实无效)。
 *
 * 配置到达前**不渲染**依赖门控的子树(Req 3.5):否则 Tier4 隔离表面等以门控决定挂载与否的
 * 组件会先按缺省值渲染一次再纠正,产生闪烁与误导。
 */
import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { setRuntimeFeatures } from "@/lib/app/runtime-features.js";

export interface BootstrapFeatures {
  readonly canvas: boolean;
  readonly sourcePicker: boolean;
  readonly launcherRail: boolean;
  readonly bashEnabled: boolean;
  readonly sessionsGlobal: boolean;
  readonly sessionsManage: boolean;
  readonly sessionsSlot: string;
  readonly extensionCommands: string;
  readonly extensionAllowlist: string;
  readonly extensionBaseUrl: string;
  readonly disableReadinessHandshake: boolean;
}

export interface BootstrapPayload {
  readonly defaultSource?: string;
  readonly defaultModel?: string;
  readonly defaultCwd: string;
  readonly autoStart: boolean;
  readonly multiTenant: boolean;
  readonly hostApiVersion: string;
  readonly features: BootstrapFeatures;
  readonly supabase?: { readonly url: string; readonly anonKey: string };
  readonly resumeSource?: string;
}

export type BootstrapState =
  | { readonly status: "loading" }
  | { readonly status: "ready"; readonly config: BootstrapPayload }
  | { readonly status: "error"; readonly message: string };

const BootstrapContext = createContext<BootstrapState>({ status: "loading" });

/** 已就绪的配置。仅可在 `<BootstrapGate>` 内部调用。 */
export function useBootstrap(): BootstrapPayload {
  const state = useContext(BootstrapContext);
  if (state.status !== "ready") {
    throw new Error("useBootstrap 只能在 <BootstrapGate> 就绪后的子树中调用");
  }
  return state.config;
}

/** 原始状态(供测试与加载态渲染判断)。 */
export function useBootstrapState(): BootstrapState {
  return useContext(BootstrapContext);
}

/**
 * 拉取 `/api/bootstrap`。`sessionId` 存在时一并请求该会话的 agent 源恢复
 * (Req 3.3:否则刷新后 webext 扩展表面静默消失)。
 */
export async function fetchBootstrap(
  sessionId?: string,
  fetchImpl: typeof fetch = fetch,
): Promise<BootstrapPayload> {
  const url =
    sessionId !== undefined && sessionId.length > 0
      ? `/api/bootstrap?sessionId=${encodeURIComponent(sessionId)}`
      : "/api/bootstrap";
  const res = await fetchImpl(url);
  if (!res.ok) throw new Error(`bootstrap ${res.status}`);
  return (await res.json()) as BootstrapPayload;
}

export function BootstrapGate({
  children,
  sessionId,
  fetchImpl,
}: {
  readonly children: ReactNode;
  /** 会话详情路由传入,使冷加载能恢复 agent 源。 */
  readonly sessionId?: string;
  /** 测试注入。 */
  readonly fetchImpl?: typeof fetch;
}): React.JSX.Element {
  const [state, setState] = useState<BootstrapState>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;
    setState({ status: "loading" });
    fetchBootstrap(sessionId, fetchImpl)
      .then((config) => {
        if (!cancelled) setState({ status: "ready", config });
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setState({
          status: "error",
          message: err instanceof Error ? err.message : String(err),
        });
      });
    return () => {
      cancelled = true;
    };
  }, [sessionId, fetchImpl]);

  if (state.status === "loading") {
    return (
      <div
        data-pi-bootstrap="loading"
        className="flex h-dvh w-full items-center justify-center text-sm opacity-60"
      >
        正在加载配置…
      </div>
    );
  }

  if (state.status === "error") {
    return (
      <div
        data-pi-bootstrap="error"
        className="flex h-dvh w-full items-center justify-center text-sm text-red-600"
      >
        配置加载失败：{state.message}
      </div>
    );
  }

  // 门控注入必须早于任何消费者的首次读取(`chat-app` 的门控是惰性 + 记忆化的)。
  // 这里是同步的 render 期调用:children 在本次 render 中才被创建,故顺序有保证。
  setRuntimeFeatures({
    ...state.config.features,
    hostApiVersion: state.config.hostApiVersion,
  });

  return (
    <BootstrapContext.Provider value={state}>
      <div data-pi-bootstrap="ready" className="contents">
        {children}
      </div>
    </BootstrapContext.Provider>
  );
}
