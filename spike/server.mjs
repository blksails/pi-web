/**
 * P0 spike server — 裸 node:http,复刻生产 CSP 与三类端点。
 *
 * CSP 逐字段抄自 `next.config.ts` 的 production headers(禁 `unsafe-eval`)。
 * 端点:
 *   /api/webext/singletons/:name  ← 抄自 app/api/webext/singletons/[name]/route.ts
 *   /ext/*                        ← 真实 webext dist 静态托管
 *   /*                            ← Vite 产物 + SPA fallback
 */
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, resolve } from "node:path";

const PORT = Number(process.env.PORT ?? 4173);
const ROOT = resolve(import.meta.dirname);
const CLIENT_DIR = join(ROOT, "dist-client");
const EXT_DIR = resolve(
  ROOT,
  "../examples/webext-renderer-agent/.pi/web/dist",
);

const CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "connect-src 'self'",
  "frame-src 'self' blob: data:",
  "img-src 'self' data: blob:",
  "object-src 'none'",
  "base-uri 'self'",
].join("; ");

const G = "globalThis.__PI_WEBEXT_SINGLETONS__";
const guard = (slot, label) =>
  `const __s=${G};const __m=__s&&__s.${slot};if(!__m)throw new Error("[pi-web] webext singleton bridge not ready: ${label}");`;
const named = (v, names) =>
  `export const ${names.map((n) => `${n}=${v}.${n}`).join(",")};`;

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

function singletonModule(name) {
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

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
};

async function serveFile(res, path) {
  try {
    const bytes = await readFile(path);
    res.writeHead(200, {
      "content-type": MIME[extname(path)] ?? "application/octet-stream",
      "content-security-policy": CSP,
      "cache-control": "no-store",
    });
    res.end(bytes);
    return true;
  } catch {
    return false;
  }
}

createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const p = url.pathname;

  const singleton = p.match(/^\/api\/webext\/singletons\/([\w-]+)$/);
  if (singleton) {
    const body = singletonModule(singleton[1]);
    if (!body) {
      res.writeHead(404, { "content-security-policy": CSP });
      return res.end("unknown singleton");
    }
    res.writeHead(200, {
      "content-type": "text/javascript; charset=utf-8",
      "content-security-policy": CSP,
      "cache-control": "no-store",
    });
    return res.end(body);
  }

  if (p.startsWith("/ext/")) {
    const rel = p.slice("/ext/".length);
    if (rel.includes("..")) {
      res.writeHead(400, { "content-security-policy": CSP });
      return res.end("bad path");
    }
    if (await serveFile(res, join(EXT_DIR, rel))) return;
    res.writeHead(404, { "content-security-policy": CSP });
    return res.end("not found");
  }

  const asset = p === "/" ? "/index.html" : p;
  if (await serveFile(res, join(CLIENT_DIR, asset))) return;
  if (await serveFile(res, join(CLIENT_DIR, "index.html"))) return; // SPA fallback
  res.writeHead(404, { "content-security-policy": CSP });
  res.end("not found");
}).listen(PORT, "127.0.0.1", () => {
  process.stdout.write(`spike server on http://127.0.0.1:${PORT}\n`);
});
