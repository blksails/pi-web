import { defineConfig } from "vite";
import type { Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

/**
 * pi-web SPA 前端构建(spec vite-spa-migration 任务 2.2)。
 *
 * 两个与 webext 加载 + 生产 CSP 直接相关的设置,不可改动(design 决策 / P0 实证):
 *
 *  - `build.target: "esnext"` —— 低 target 下 Vite 会为动态 import 注入需要
 *    `unsafe-eval` 的 polyfill。生产 CSP 禁 `unsafe-eval`,注入即导致代码扩展
 *    加载失败。
 *  - `modulePreload.polyfill: false` —— 该 polyfill 注入内联脚本并改写动态
 *    import 的加载路径;webext 的 entry 是**外部 URL**,不应被 preload 逻辑触碰。
 *
 * 另注:`extension-loader` 的 `import(/* webpackIgnore: true *\/ u)` 中 `u` 是**变量**,
 * Vite 原样保留为原生运行时 import。若把 URL 写成字面量,`/* @vite-ignore *\/` 不生效,
 * Rollup 仍会静态解析并在构建期报 `failed to resolve import`。
 */
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const r = (p: string): string => path.resolve(__dirname, p);

/**
 * Vite hashes pane HTML imported by static webexts, but does not follow the
 * HTML's sibling `<script src="pane-*.js">`.  Copy and rewrite each pair so
 * native WebViews never receive the SPA fallback instead of the guest script.
 */
function repairStaticPaneAssets(): Plugin {
  return {
    name: "pi-web-repair-static-pane-assets",
    apply: "build",
    generateBundle(_options, bundle) {
      const scriptByHtml = new Map<string, string>();
      const examplesRoot = r("examples");
      if (existsSync(examplesRoot)) {
        for (const entry of readdirSync(examplesRoot, { recursive: true })) {
          const relative = String(entry).replaceAll("\\", "/");
          const match = /(?:^|\/)\.pi\/web\/dist\/(pane-[^/]+)\.html$/.exec(relative);
          if (match === null) continue;
          const htmlPath = path.join(examplesRoot, ...relative.split("/"));
          const scriptPath = path.join(path.dirname(htmlPath), `${match[1]}.js`);
          if (!existsSync(scriptPath)) continue;
          scriptByHtml.set(readFileSync(htmlPath, "utf8"), readFileSync(scriptPath, "utf8"));
        }
      }
      for (const [fileName, output] of Object.entries(bundle)) {
        if (
          output.type !== "asset" ||
          !fileName.startsWith("assets/pane-") ||
          !fileName.endsWith(".html")
        ) continue;
        const html = typeof output.source === "string"
          ? output.source
          : new TextDecoder().decode(output.source);
        const scriptMatch = /<script\s+[^>]*src=["'](?:\.\/)?(pane-[^"']+\.js)["'][^>]*>/i.exec(html);
        const scriptTag = scriptMatch?.[1] === "pane-chrome.js" ? null : scriptMatch;
        const hasChrome = /src=["'](?:\.\/)?pane-chrome\.js["']/i.test(html);
        if (scriptTag === null && !hasChrome) continue;
        let rewritten = html.replace(
          /(src=["'])\.\/pane-chrome\.js(["'])/g,
          "$1../pane-chrome.js$2",
        );
        if (scriptTag !== null) {
          const script = scriptByHtml.get(html);
          if (script === undefined) continue;
          const scriptFile = `${fileName.slice(0, -5)}.js`;
          const rewrittenTag = scriptTag[0].replace(
            /((?:src=["']))(?:\.\/)?pane-[^"']+\.js(["'])/i,
            `$1./${path.basename(scriptFile)}$2`,
          );
          rewritten = rewritten.replace(scriptTag[0], rewrittenTag);
          bundle[scriptFile] ??= {
            type: "asset",
            fileName: scriptFile,
            source: script,
            name: scriptFile,
            names: [scriptFile],
            originalFileName: null,
            originalFileNames: [],
            needsCodeReference: false,
          };
        }
        output.source = rewritten;
      }
    },
  };
}

export default defineConfig({
  plugins: [react(), repairStaticPaneAssets()],
  // `public/` 原样拷入 `dist/client/`(含 Tier4 隔离表面的 webext-artifact/artifact.html)。
  publicDir: r("public"),
  resolve: {
    // ⚠ 必须复刻 `tsconfig.json` 的 `paths` 全表。
    //
    // 其中 canvas-kit / primitives / agent-kit **未在根 node_modules 链接**(它们不是 app 的
    // 直接依赖),旧宿主靠 Next 读 tsconfig paths 解析。构建期 webext 注册表
    // (`lib/app/webext-registry.ts`)静态 import 了 `examples/**/web.config.tsx`,而那些
    // config 引用上述包 —— 缺别名则 Rollup 报 `failed to resolve import`。
    //
    // tool-kit 的子路径导出指向 .ts 源(无 dist),vite 不解析工作区子路径 exports,同样须显式
    // 别名(否则 pi-handler 经子路径 import 时 handler 集成路径全崩)。
    // 与 `vitest.node-e2e.config.ts` 的别名表保持一致。
    alias: {
      "@": r("."),
      // CSS 子路径导出必须排在**主入口之前**:alias 是前缀匹配,
      // `@blksails/pi-web-canvas-ui` 在前会把 `/styles.css` 一起吞掉,拼出 `index.ts/styles.css`。
      // 另注:裸包 CSS specifier 走 vite 的 node 解析在本仓极慢(实测构建挂住 >10min),
      // 显式别名把它变成一次文件系统命中。
      "@blksails/pi-web-ui/styles.css": r("packages/ui/src/styles.css"),
      "@blksails/pi-web-canvas-ui/styles.css": r("packages/canvas-ui/src/styles.css"),
      "@blksails/pi-web-logger": r("packages/logger/src/index.ts"),
      "@blksails/pi-web-agent-kit": r("packages/agent-kit/src/index.ts"),
      "@blksails/pi-web-canvas-kit": r("packages/canvas-kit/src/index.ts"),
      "@blksails/pi-web-primitives": r("packages/primitives/src/index.ts"),
      "@blksails/pi-web-canvas-ui": r("packages/canvas-ui/src/index.ts"),
      // 子路径别名必须排在主入口**之前**:vite 按声明顺序做前缀匹配,
      // 主入口在前会把 `@blksails/pi-web-tool-kit/commands` 也吞掉。
      "@blksails/pi-web-tool-kit/aigc-canvas-schema": r(
        "packages/tool-kit/src/aigc/canvas/schema.ts",
      ),
      "@blksails/pi-web-tool-kit/commands": r("packages/tool-kit/src/commands/index.ts"),
      "@blksails/pi-web-tool-kit/extension-entry": r(
        "packages/tool-kit/src/extension-tools/entry-path.ts",
      ),
      "@blksails/pi-web-tool-kit/auto-title-entry": r(
        "packages/tool-kit/src/auto-title/entry-path.ts",
      ),
      "@blksails/pi-web-tool-kit/runtime": r("packages/tool-kit/src/runtime.ts"),
      "@blksails/pi-web-tool-kit": r("packages/tool-kit/src/index.ts"),
    },
  },
  build: {
    target: "esnext",
    outDir: r(process.env.PI_WEB_CLIENT_OUT ?? "dist/client"),
    emptyOutDir: true,
    modulePreload: { polyfill: false },
  },
  server: {
    port: Number(process.env.PI_WEB_DEV_CLIENT_PORT ?? 5173),
    strictPort: true,
    // Driver/download artifacts can be locked by WebDriver on Windows. Watching them
    // makes chokidar emit an unhandled EBUSY and tears down the whole desktop chain.
    watch: { ignored: ["**/.tmp/**", "**/src-tauri/target/**"] },
    // Pane iframe 带 sandbox，故其 origin 为 null；Vite 注入的 HMR/React Refresh 脚本
    // 仍从 5173 取。开发服务器须回 ACAO，否则功能虽可用，控制台持续报 CORS。
    cors: true,
    // 开发期把 API 面代理到独立跑的宿主进程(server/index.ts),
    // 使前端 HMR 与后端会话进程解耦——这正是脱离 Next 后消失的那类 dev 冲突。
    proxy: {
      "/api": {
        target: `http://127.0.0.1:${process.env.PI_WEB_DEV_API_PORT ?? 3000}`,
        changeOrigin: false,
      },
    },
  },
});
