/**
 * webext-load-client — 客户端运行时 webext 加载编排(webext-package-install 任务 3.2)。
 *
 * 当构建期注册表(resolveExtensionForSource)未命中某源时,经 `/api/webext/resolve`
 * 取已背书 manifest + baseUrl,用 loadExtension(浏览器仅 SRI,签名已服务端验)加载,
 * 返回 WebExtension 供宿主 applyExtension。任一失败回退 undefined(默认 UI),不抛。
 *
 * 纯声明扩展:零 bundle、无需 import map;代码扩展:经 browserLoaderDeps 动态加载
 * (依赖 <head> 预装 import map 把裸 specifier 解析到宿主单例)。
 */
"use client";
import * as React from "react";
import {
  loadExtension,
  browserLoaderDeps,
  type LoadOutcome,
  type GateOptions,
} from "@blksails/pi-web-react";
import type { WebExtension } from "@blksails/pi-web-kit";

/**
 * 浏览器门控选项:不含验签材料(签名已服务端验)、signaturePreVerified、仅 SRI。
 * 直接内联构造——不读 `process.env`(浏览器中整体访问 process.env 不可靠;仅具体
 * NEXT_PUBLIC_* 成员会被 Next 内联),hostApiVersion 经 NEXT_PUBLIC 成员读取。
 */
function browserGateOptions(): GateOptions {
  return {
    whitelist: [],
    requireSignature: false,
    hostApiVersion: process.env.NEXT_PUBLIC_PI_WEB_KIT_VERSION ?? "0.1.0",
    signaturePreVerified: true,
  };
}

export interface RuntimeWebextState {
  readonly extension: WebExtension | undefined;
  readonly status: "idle" | "loading" | "loaded" | "declarative" | "none" | "rejected";
  readonly reason?: string;
}

interface ResolveResponse {
  readonly found: boolean;
  readonly manifest?: Record<string, unknown>;
  readonly baseUrl?: string;
  readonly rejectedReason?: string;
}

/**
 * 解析并加载某源的运行时 webext。`skip=true`(构建期已命中)时不发起。
 * 返回响应式状态;source 变化时重载,组件卸载/切换时取消。
 */
export function useRuntimeWebext(
  source: string | undefined,
  skip: boolean,
  /** 变化即重解析+重载(装后双路生效:builtin-plugin-command 4.2 触发 webext 路)。 */
  reloadNonce = 0,
): RuntimeWebextState {
  const [state, setState] = React.useState<RuntimeWebextState>({
    extension: undefined,
    status: "idle",
  });

  React.useEffect(() => {
    if (skip || source === undefined || source.length === 0 || source === ".") {
      setState({ extension: undefined, status: "idle" });
      return;
    }
    let cancelled = false;
    setState({ extension: undefined, status: "loading" });

    void (async (): Promise<void> => {
      try {
        const res = await fetch(
          `/api/webext/resolve?source=${encodeURIComponent(source)}`,
        );
        if (!res.ok) {
          if (!cancelled) setState({ extension: undefined, status: "none" });
          return;
        }
        const data = (await res.json()) as ResolveResponse;
        if (cancelled) return;
        if (!data.found || data.manifest === undefined) {
          setState({
            extension: undefined,
            status: data.rejectedReason !== undefined ? "rejected" : "none",
            ...(data.rejectedReason !== undefined ? { reason: data.rejectedReason } : {}),
          });
          return;
        }
        // 声明式(无 entry)不需要动态 import deps;仅代码扩展才构造 browserLoaderDeps()
        // (其内部 `new Function` 在禁 unsafe-eval 的 CSP 下会抛,声明式不应被连累)。
        const isCode =
          typeof (data.manifest as { entry?: unknown }).entry === "string";
        const deps = isCode
          ? browserLoaderDeps()
          : {
              fetchBytes: (): Promise<Uint8Array> => {
                throw new Error("declarative ext needs no fetch");
              },
              importModule: (): Promise<{ default: WebExtension }> => {
                throw new Error("declarative ext needs no import");
              },
            };
        const outcome: LoadOutcome = await loadExtension({
          manifest: data.manifest as never,
          baseUrl: data.baseUrl ?? "",
          opts: browserGateOptions(),
          deps,
        });
        if (cancelled) return;
        if (outcome.status === "loaded" || outcome.status === "declarative") {
          setState({ extension: outcome.extension, status: outcome.status });
        } else {
          setState({
            extension: undefined,
            status: "rejected",
            reason: outcome.reason,
          });
        }
      } catch (err) {
        const reason = err instanceof Error ? err.message : String(err);
        // eslint-disable-next-line no-console
        console.error("[webext-load] failed:", reason);
        if (!cancelled) {
          setState({ extension: undefined, status: "rejected", reason });
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [source, skip, reloadNonce]);

  return state;
}
