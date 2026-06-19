import type { NextConfig } from "next";
import fs from "node:fs";
import path from "node:path";

/** Minimal structural subset of webpack's Configuration used here. */
interface WebpackConfig {
  resolve?: {
    extensionAlias?: Record<string, string[]>;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

/**
 * Resolve a pi SDK package's real ESM entry file to an ABSOLUTE path.
 *
 * pnpm nests `@earendil-works/*` under `packages/server/node_modules` (not the
 * app root), and the packages export only an `import` condition — so neither
 * root-relative bare-specifier resolution (from `.next/server/**`) nor
 * `require.resolve` works. We read the package.json directly (bypassing the
 * strict `exports` map) and join its `import` entry, yielding an absolute path
 * webpack can externalize and Node can `import` at runtime. The package's own
 * transitive deps (e.g. pi-ai) then resolve from that real location (pnpm-safe).
 */
function piSdkEntryAbsPath(request: string): string | undefined {
  try {
    const linked = path.resolve("packages/server/node_modules", request);
    const real = fs.realpathSync(linked);
    const pkg = JSON.parse(
      fs.readFileSync(path.join(real, "package.json"), "utf8"),
    ) as {
      exports?: { ["."]?: { import?: string } };
      module?: string;
      main?: string;
    };
    const entry =
      pkg.exports?.["."]?.import ?? pkg.module ?? pkg.main ?? "index.js";
    return path.join(real, entry);
  } catch {
    return undefined;
  }
}

/**
 * Next.js config for the pi-web app shell.
 *
 * The upstream `@pi-web/*` workspace packages export raw TypeScript from their
 * `src/` directories (no build step). `transpilePackages` makes Next compile
 * them through its own toolchain so the app can consume them directly.
 */
const nextConfig: NextConfig = {
  // Allow an isolated build output dir (e.g. for browser e2e) so a production
  // build never clobbers a concurrently running `next dev` .next cache.
  // Defaults to ".next" — unchanged behavior unless NEXT_DIST_DIR is set.
  distDir: process.env.NEXT_DIST_DIR ?? ".next",
  // App code is type-checked by `pnpm typecheck` (root `tsc -p tsconfig.json`
  // which excludes `packages/`). The workspace packages are type-checked by
  // their own configs (green). Next's build-time pass would otherwise re-check
  // imported package sources under the app tsconfig and flag harmless strictness
  // differences, so it is disabled here. ESLint is likewise run separately.
  typescript: { ignoreBuildErrors: true },
  eslint: { ignoreDuringBuilds: true },
  transpilePackages: [
    "@pi-web/protocol",
    "@pi-web/react",
    "@pi-web/ui",
    "@pi-web/server",
    "@pi-web/web-kit",
  ],
  // The session API routes spawn child processes (agent runtime) and hold SSE
  // long-connections — they must run on the Node runtime, never Edge.
  // pi SDK 系列必须整体外置(运行时 Node require,不进 bundle):pi-coding-agent 经
  // trust 策略在主进程被引用,它又拉入 pi-ai —— 后者含 `node:fs/os/path` 与表达式
  // require,若被打进路由 bundle 会在 dev 下解析失败。三者一并外置。
  serverExternalPackages: [
    "jiti",
    "@earendil-works/pi-coding-agent",
    "@earendil-works/pi-ai",
  ],
  // CSP(agent-web-extension 任务 3.3 / Req 7.3):仅在 production 应用收紧策略,
  // 禁 `unsafe-eval`、收紧 `connect-src`;artifact 走 sandbox iframe(blob/data)。
  // dev 不应用(Next HMR 依赖 eval);e2e 用 production build 验证(任务 7.3)。
  async headers() {
    if (process.env.NODE_ENV !== "production") return [];
    const csp = [
      "default-src 'self'",
      // 扩展 bundle 经同源动态 import;禁 eval。'unsafe-inline' 为 Next 内联 hydration
      // bootstrap 所需(无 nonce 基建时);真正的不可信前端隔离靠 artifact sandbox iframe。
      "script-src 'self' 'unsafe-inline'",
      // 样式:宿主 + 扩展 scoped css(同源);Tailwind 运行时注入需 inline
      "style-src 'self' 'unsafe-inline'",
      // SSE/REST 同源
      "connect-src 'self'",
      // artifact:独立 origin sandbox iframe(srcdoc/blob)
      "frame-src 'self' blob: data:",
      "img-src 'self' data: blob:",
      "object-src 'none'",
      "base-uri 'self'",
    ].join("; ");
    return [
      {
        source: "/(.*)",
        headers: [{ key: "Content-Security-Policy", value: csp }],
      },
    ];
  },
  // The transpiled `@pi-web/*` packages use NodeNext-style `.js` import
  // specifiers that actually point at `.ts`/`.tsx` sources. Teach webpack to
  // resolve those extensions so the raw-TS workspace packages compile.
  webpack(
    config: WebpackConfig,
    { isServer }: { isServer: boolean },
  ): WebpackConfig {
    config.resolve = config.resolve ?? {};
    config.resolve.extensionAlias = {
      ...config.resolve.extensionAlias,
      ".js": [".ts", ".tsx", ".js", ".jsx"],
      ".jsx": [".tsx", ".jsx"],
      ".mjs": [".mts", ".mjs"],
    };
    // 在 server 编译里手动把整个 pi SDK 命名空间外置为 ESM `module`(运行时 import,
    // 匹配其 import-only exports)。原因:dev 模式 `serverExternalPackages` 对
    // transpilePackages(@pi-web/server)内 import 的 pnpm 嵌套 ESM 包不生效,会把整套
    // pi SDK(含 pi-ai 的 `node:fs/os/path`)打进路由 bundle 致解析失败;手动 externals
    // 复刻 production 的外置行为,dev/prod 一致。
    if (isServer) {
      const piSdkExternal = (
        data: { request?: string },
        callback: (err?: Error | null, result?: string) => void,
      ): void => {
        const req = data.request;
        // 仅外置 trust 直接 import 的 pi-coding-agent(主进程唯一的 pi SDK 入口)。
        // 外置后 webpack 不再进入它,故其传递依赖(pi-ai 等)不会被请求/打包,而在运行时
        // 由该包从自身位置的 node_modules 解析(pnpm 安全)。
        if (req === "@earendil-works/pi-coding-agent") {
          const abs = piSdkEntryAbsPath(req);
          // 外置为指向真实入口的绝对路径 ESM module(运行时 import 该绝对文件);
          // 解析不到则回退裸 specifier。
          callback(null, `module ${abs ?? req}`);
          return;
        }
        callback();
      };
      const prev = config.externals;
      const list: unknown[] = Array.isArray(prev)
        ? prev
        : prev !== undefined
          ? [prev]
          : [];
      config.externals = [piSdkExternal, ...list];
    }
    return config;
  },
};

export default nextConfig;
