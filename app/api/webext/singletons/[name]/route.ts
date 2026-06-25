/**
 * GET /api/webext/singletons/<name> — 宿主单例 ESM(webext-package-install 任务 2.4)。
 *
 * 返回的 ESM 从 `window.__PI_WEBEXT_SINGLETONS__`(宿主桥接注入)re-export 宿主同一
 * react / react/jsx-runtime / react-dom / @blksails/pi-web-kit 实例。配合 import map,
 * 使动态加载的代码 webext 与宿主共享单例(不重复实例化 React)。
 */
import { WEBEXT_SINGLETON_GLOBAL } from "@/lib/app/webext-singletons";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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

function moduleFor(name: string): string | undefined {
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

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ name: string }> },
): Promise<Response> {
  const { name } = await ctx.params;
  const body = moduleFor(name);
  if (body === undefined) return new Response("unknown singleton", { status: 404 });
  return new Response(body, {
    status: 200,
    headers: {
      "content-type": "text/javascript; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}
