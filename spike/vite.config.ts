import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";

/**
 * P0 spike 的 Vite 配置。
 *
 * 两个与 webext 加载直接相关的设置:
 *  - `build.target: "esnext"` —— 保证原生 `import()` 不被降级为需要 `unsafe-eval`
 *    的 polyfill(低 target 下 Vite/esbuild 可能引入 `new Function`)。
 *  - `modulePreload.polyfill: false` —— 该 polyfill 会注入内联脚本并改写动态 import
 *    的加载路径;webext 的 entry 是外部 URL,不应被 preload 逻辑触碰。
 */
export default defineConfig({
  plugins: [react()],
  root: __dirname,
  build: {
    target: "esnext",
    outDir: resolve(__dirname, "dist-client"),
    emptyOutDir: true,
    modulePreload: { polyfill: false },
    minify: false, // spike:保留可读产物以便静态审计 new Function / eval
  },
});
