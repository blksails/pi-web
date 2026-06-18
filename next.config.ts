import type { NextConfig } from "next";

/** Minimal structural subset of webpack's Configuration used here. */
interface WebpackConfig {
  resolve?: {
    extensionAlias?: Record<string, string[]>;
    [key: string]: unknown;
  };
  [key: string]: unknown;
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
  ],
  // The session API routes spawn child processes (agent runtime) and hold SSE
  // long-connections — they must run on the Node runtime, never Edge.
  serverExternalPackages: ["jiti", "@earendil-works/pi-coding-agent"],
  // The transpiled `@pi-web/*` packages use NodeNext-style `.js` import
  // specifiers that actually point at `.ts`/`.tsx` sources. Teach webpack to
  // resolve those extensions so the raw-TS workspace packages compile.
  webpack(config: WebpackConfig): WebpackConfig {
    config.resolve = config.resolve ?? {};
    config.resolve.extensionAlias = {
      ...config.resolve.extensionAlias,
      ".js": [".ts", ".tsx", ".js", ".jsx"],
      ".jsx": [".tsx", ".jsx"],
      ".mjs": [".mts", ".mjs"],
    };
    return config;
  },
};

export default nextConfig;
