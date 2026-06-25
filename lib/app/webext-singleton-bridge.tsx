/**
 * webext-singleton-bridge — 宿主单例桥接(webext-package-install 任务 2.4/3.1)。
 *
 * 把宿主运行时的 react / react/jsx-runtime / react-dom / @blksails/pi-web-kit 实例挂到
 * `window.__PI_WEBEXT_SINGLETONS__`,供单例 ESM 端点 re-export。须在任何代码 webext 动态
 * import 之前就位——本组件在 app-shell 早期渲染即同步注入(webext 加载发生在用户选源/会话
 * 激活之后,时序充裕)。
 */
"use client";
import * as React from "react";
import * as JsxRuntime from "react/jsx-runtime";
import * as ReactDom from "react-dom";
import * as WebKit from "@blksails/pi-web-kit";
import { WEBEXT_SINGLETON_GLOBAL } from "./webext-singletons.js";

if (typeof window !== "undefined") {
  (window as unknown as Record<string, unknown>)[WEBEXT_SINGLETON_GLOBAL] = {
    react: React,
    jsxRuntime: JsxRuntime,
    reactDom: ReactDom,
    webkit: WebKit,
  };
}

export function WebextSingletonBridge(): null {
  return null;
}
