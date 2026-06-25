/**
 * webext-singletons — 单例 import map 规格(webext-package-install 任务 2.4/3.1)。
 *
 * 代码 webext 的 .mjs 以裸 specifier 引用宿主共享依赖(react / react/jsx-runtime /
 * react-dom / @blksails/pi-web-kit)。import map 把这些裸名映射到「单例 ESM 端点」,
 * 端点返回的模块从 `window.__PI_WEBEXT_SINGLETONS__`(宿主桥接注入)re-export 宿主**同一**
 * 运行时实例,保证不重复实例化(hooks/context 共享)。
 */
export const WEBEXT_SINGLETON_GLOBAL = "__PI_WEBEXT_SINGLETONS__";

export const WEBEXT_IMPORT_MAP: { imports: Record<string, string> } = {
  imports: {
    react: "/api/webext/singletons/react",
    "react/jsx-runtime": "/api/webext/singletons/react-jsx-runtime",
    "react-dom": "/api/webext/singletons/react-dom",
    "@blksails/pi-web-kit": "/api/webext/singletons/webkit",
  },
};
