/**
 * P0 spike — 在 Vite 生产构建 + 生产 CSP 下加载真实 webext。
 *
 * 复用**真实**的 `extension-loader`(未改动),靶子是 `build-webext-examples.ts` 产出的
 * 真实 `webext-renderer` dist(裸 import `@blksails/pi-web-kit` 与 `react/jsx-runtime`,
 * 必须经 import map 解析到宿主单例)。
 *
 * 三条断言:
 *   A. 单例端点 re-export 的确实是宿主同一 react 实例(引用相等,不是结构相似)。
 *   B. loadExtension 走完 fetch → SRI 门控 → 动态 import,status === "loaded"。
 *   C. 扩展导出的 renderer 能被宿主 ReactDOM 渲染进 DOM。
 */
import * as React from "react";
import * as JsxRuntime from "react/jsx-runtime";
import * as ReactDom from "react-dom";
import { createRoot } from "react-dom/client";
import * as WebKit from "../../packages/web-kit/src/index.js";
import {
  loadExtension,
  browserLoaderDeps,
} from "../../packages/react/src/web-ext/extension-loader.js";

// 宿主单例桥(等价 lib/app/webext-singleton-bridge.tsx)。
(window as unknown as Record<string, unknown>)["__PI_WEBEXT_SINGLETONS__"] = {
  react: React,
  jsxRuntime: JsxRuntime,
  reactDom: ReactDom,
  webkit: WebKit,
};

const statusEl = document.getElementById("status") as HTMLElement;
const diagEl = document.getElementById("diag") as HTMLElement;
const mountEl = document.getElementById("ext-mount") as HTMLElement;

const diag: Record<string, unknown> = {};

function fail(stage: string, err: unknown): never {
  diag["failedStage"] = stage;
  diag["error"] = err instanceof Error ? err.message : String(err);
  statusEl.dataset["state"] = "failed";
  statusEl.textContent = "failed";
  diagEl.textContent = JSON.stringify(diag, null, 2);
  throw err;
}

async function main(): Promise<void> {
  // ── 断言 A:单例端点返回宿主同一 react 实例 ──────────────────────────
  // URL 必须经**变量**传入:对字面量,`/* @vite-ignore */` 不生效,Rollup 仍会静态
  // 解析并在构建期报 "failed to resolve"。真实 extension-loader 亦是变量形式(`u`)。
  const singletonUrl: string = "/api/webext/singletons/react";
  let singletonReact: Record<string, unknown>;
  try {
    singletonReact = (await import(/* @vite-ignore */ singletonUrl)) as Record<
      string,
      unknown
    >;
  } catch (err) {
    fail("import-singleton-endpoint", err);
  }
  diag["singletonSameInstance"] = singletonReact["useState"] === React.useState;

  // ── 断言 B:真实 loader 加载真实 webext dist ─────────────────────────
  const manifest = await (await fetch("/ext/manifest.json")).json();
  diag["manifestId"] = manifest.id;

  const outcome = await loadExtension({
    manifest,
    baseUrl: "/ext/",
    opts: {
      whitelist: [],
      requireSignature: false,
      hostApiVersion: "0.1.0",
      signaturePreVerified: true,
    },
    deps: browserLoaderDeps(),
  });
  diag["loadStatus"] = outcome.status;
  if (outcome.status !== "loaded") {
    diag["reason"] = "reason" in outcome ? outcome.reason : undefined;
    fail("load-extension", new Error(`status=${outcome.status}`));
  }

  // ── 断言 C:扩展 renderer 能被宿主 ReactDOM 渲染 ──────────────────────
  const ext = outcome.extension as {
    renderers?: { dataParts?: Record<string, React.ComponentType<any>> };
  };
  const Metric = ext.renderers?.dataParts?.["data-metric"];
  diag["hasRenderer"] = typeof Metric === "function";
  if (typeof Metric !== "function") fail("renderer-missing", new Error("no data-metric"));

  createRoot(mountEl).render(
    React.createElement(Metric, { part: { data: { label: "spike", value: 42 } } }),
  );

  // 让 React 完成一次提交后再判定成功。
  await new Promise((r) => setTimeout(r, 50));
  diag["renderedCard"] =
    mountEl.querySelector('[data-testid="metric-card"]') !== null;

  const allOk =
    diag["singletonSameInstance"] === true &&
    diag["loadStatus"] === "loaded" &&
    diag["renderedCard"] === true;

  statusEl.dataset["state"] = allOk ? "ok" : "failed";
  statusEl.textContent = allOk ? "ok" : "failed";
  diagEl.textContent = JSON.stringify(diag, null, 2);
}

void main().catch((err: unknown) => {
  // 必须把异常暴露到 console,否则 verify.mjs 的 console/CSP 收集器永远是空的,
  // 「(none)」就成了无信息的假绿。
  const msg = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
  console.error("[spike] main() failed:", msg);
});
