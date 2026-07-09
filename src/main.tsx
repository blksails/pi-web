/**
 * SPA 入口(spec vite-spa-migration 任务 4.2)。
 *
 * 单例桥必须在**任何代码 webext 被动态加载之前**就位:webext 的 dist 以裸 specifier 引用
 * `react` / `react/jsx-runtime` / `react-dom` / `@blksails/pi-web-kit`,`index.html` 的 import map
 * 把它们解析到 `/api/webext/singletons/*`,而那些端点只是从本对象再导出。此处在挂载 React
 * 之前同步注入,时序充裕(webext 加载发生在用户选源/会话激活之后)。
 *
 * 迁移自 `app/layout.tsx` + `lib/app/webext-singleton-bridge.tsx`。
 */
import * as React from "react";
import * as JsxRuntime from "react/jsx-runtime";
import * as ReactDom from "react-dom";
import { createRoot } from "react-dom/client";
import * as WebKit from "@blksails/pi-web-kit";
import { WEBEXT_SINGLETON_GLOBAL } from "@/lib/app/webext-singletons.js";
import { App } from "./app.js";
import "./globals.css";

(window as unknown as Record<string, unknown>)[WEBEXT_SINGLETON_GLOBAL] = {
  react: React,
  jsxRuntime: JsxRuntime,
  reactDom: ReactDom,
  webkit: WebKit,
};

const rootEl = document.getElementById("root");
if (rootEl === null) throw new Error("#root 缺失");
createRoot(rootEl).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
