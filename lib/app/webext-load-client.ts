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
 */
function browserGateOptions(): GateOptions {
  return {
    whitelist: [],
    requireSignature: false,
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
  const loadedExtensionRef = React.useRef<WebExtension | undefined>(undefined);

  React.useEffect(() => {
    if (skip || source === undefined || source.length === 0 || source === ".") {
      loadedExtensionRef.current = undefined;
      setState({ extension: undefined, status: "idle" });
      return;
    }
    let cancelled = false;
    const previousExtension = reloadNonce > 0 ? loadedExtensionRef.current : undefined;
    // 手动刷新保留当前扩展树，待新模块通过 SRI/动态 import 后一次替换；
    // 禁止刷新瞬间回落默认 UI，避免右栏与输入区产生可见重排。
    setState((previous) =>
      previousExtension !== undefined && previous.extension !== undefined
        ? { ...previous, status: "loading" }
        : { extension: undefined, status: "loading" },
    );

    void (async (): Promise<void> => {
      try {
        const res = await fetch(
          `/api/webext/resolve?source=${encodeURIComponent(source)}`,
        );
        if (!res.ok) {
          if (!cancelled) setState({ extension: previousExtension, status: "none" });
          return;
        }
        const data = (await res.json()) as ResolveResponse;
        if (cancelled) return;
        if (!data.found || data.manifest === undefined) {
          setState({
            extension: previousExtension,
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
          ? (() => {
              const base = browserLoaderDeps();
              // 原生 ESM 按 URL 缓存；reloadNonce 必须进入 fetch 与 import 的同一 URL，
              // 否则按钮只会重复取得旧模块实例。
              const withReload = (url: string): string =>
                reloadNonce === 0
                  ? url
                  : `${url}${url.includes("?") ? "&" : "?"}reload=${reloadNonce}`;
              return {
                fetchBytes: (url: string) => base.fetchBytes(withReload(url)),
                importModule: (url: string) => base.importModule(withReload(url)),
              };
            })()
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
          loadedExtensionRef.current = outcome.extension;
          setState({ extension: outcome.extension, status: outcome.status });
        } else {
          setState({
            extension: previousExtension,
            status: "rejected",
            reason: outcome.reason,
          });
        }
      } catch (err) {
        const reason = err instanceof Error ? err.message : String(err);
        // eslint-disable-next-line no-console
        console.error("[webext-load] failed:", reason);
        if (!cancelled) {
          setState({ extension: previousExtension, status: "rejected", reason });
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [source, skip, reloadNonce]);

  return state;
}
