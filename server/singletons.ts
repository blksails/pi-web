/**
 * GET /api/webext/singletons/:name — 宿主单例 ESM(spec vite-spa-migration 任务 3.1)。
 *
 * 迁移自 `app/api/webext/singletons/[name]/route.ts`,逐字保留模块体。**完全框架无关**:
 * 返回的 ESM 只是从 `window.__PI_WEBEXT_SINGLETONS__`(宿主入口注入)再导出宿主同一
 * react / react/jsx-runtime / react-dom / @blksails/pi-web-kit 实例。配合 `index.html` 的
 * import map,动态加载的代码 webext 与宿主共享单例(不重复实例化 React)。
 *
 * 相对旧宿主唯一的改动:去掉 `export const runtime/dynamic`(Next 专属)。
 *
 * 本模块只导出处理器;路由注册由 `server/index.ts` 统一完成。
 */
import { WEBEXT_SINGLETON_GLOBAL } from "../lib/app/webext-singletons.js";

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

/** `:name` 已由调用方从路径提取。 */
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
