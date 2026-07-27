/**
 * webext 运行时车道 · 单例桥(泛用宿主机制,与框架无关)。
 *
 * 代码 webext 的 `.mjs` 以**裸 specifier** 引用宿主共享依赖(react / react/jsx-runtime /
 * react-dom / @blksails/pi-web-kit)。宿主页面注入的 import map 把这些裸名映射到「单例 ESM
 * 端点」,端点返回的模块从 `window.__PI_WEBEXT_SINGLETONS__`(宿主入口注入)**再导出宿主同一
 * 运行时实例**,保证不重复实例化 React(hooks/context 才能跨扩展共享)。
 *
 * 本模块只产字符串与标准 `Response`,不碰 fs、不依赖任何 HTTP 框架 —— 故 Vite SPA 宿主、
 * Next App Router 宿主、以及任何自建宿主皆可直接接线(历史上本实现即在 Next 与 Vite 两侧
 * 各存在过一份;上提至此以止重复)。
 */

export const WEBEXT_SINGLETON_GLOBAL = "__PI_WEBEXT_SINGLETONS__";

/** 宿主页面须内联的 import map(裸名 → 单例端点)。 */
export const WEBEXT_IMPORT_MAP: { imports: Record<string, string> } = {
  imports: {
    react: "/api/webext/singletons/react",
    "react/jsx-runtime": "/api/webext/singletons/react-jsx-runtime",
    "react-dom": "/api/webext/singletons/react-dom",
    "@blksails/pi-web-kit": "/api/webext/singletons/webkit",
  },
};

const G = `globalThis.${WEBEXT_SINGLETON_GLOBAL}`;

function guard(slot: string, label: string): string {
  return `const __s=${G};const __m=__s&&__s.${slot};if(!__m)throw new Error("[pi-web] webext singleton bridge not ready: ${label}");`;
}

function named(localVar: string, names: readonly string[]): string {
  return `export const ${names.map((n) => `${n}=${localVar}.${n}`).join(",")};`;
}

const REACT_NAMES = [
  "Children", "Component", "Fragment", "Profiler", "PureComponent",
  "StrictMode", "Suspense", "cloneElement", "createContext", "createElement",
  "createRef", "forwardRef", "isValidElement", "lazy", "memo", "startTransition",
  "useCallback", "useContext", "useDebugValue", "useDeferredValue", "useEffect",
  "useId", "useImperativeHandle", "useInsertionEffect", "useLayoutEffect",
  "useMemo", "useReducer", "useRef", "useState", "useSyncExternalStore",
  "useTransition", "version",
];

const JSX_NAMES = ["Fragment", "jsx", "jsxs", "jsxDEV"];
const REACT_DOM_NAMES = ["createPortal", "flushSync", "version"];
const WEBKIT_NAMES = ["defineWebExtension", "SLOTS"];

/** 单例名 → ESM 源码;未知名回 undefined(调用方回 404)。 */
export function singletonModuleFor(name: string): string | undefined {
  switch (name) {
    case "react":
      return `${guard("react", "react")}export default __m;${named("__m", REACT_NAMES)}`;
    case "react-jsx-runtime":
      return `${guard("jsxRuntime", "react/jsx-runtime")}${named("__m", JSX_NAMES)}`;
    case "react-dom":
      return `${guard("reactDom", "react-dom")}export default __m;${named("__m", REACT_DOM_NAMES)}`;
    case "webkit":
      return `${guard("webkit", "@blksails/pi-web-kit")}export default __m;${named("__m", WEBKIT_NAMES)}`;
    default:
      return undefined;
  }
}

/** `GET /api/webext/singletons/:name` 的处理器(`:name` 由调用方从路径提取)。 */
export function handleSingleton(name: string): Response {
  const body = singletonModuleFor(name);
  if (body === undefined) return new Response("unknown singleton", { status: 404 });
  return new Response(body, {
    status: 200,
    headers: {
      "content-type": "text/javascript; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}
