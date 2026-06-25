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
} from "@blksails/pi-web-react";
import type { WebExtension } from "@blksails/pi-web-kit";
import { buildBrowserGateOptions } from "./web-ext-gate-config.js";

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
        const outcome: LoadOutcome = await loadExtension({
          manifest: data.manifest as never,
          baseUrl: data.baseUrl ?? "",
          opts: buildBrowserGateOptions(),
          deps: browserLoaderDeps(),
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
        if (!cancelled) {
          setState({
            extension: undefined,
            status: "rejected",
            reason: err instanceof Error ? err.message : String(err),
          });
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [source, skip]);

  return state;
}
