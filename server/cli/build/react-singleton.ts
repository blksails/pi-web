/**
 * react-singleton — pane bundle 的运行时库单例解析插件(spec cli-agent-build,任务 3.4,
 * Req 4.3;design.md「react-singleton」)。
 *
 * pane 产物走 IIFE 打包(opaque-origin iframe,无 import map),`react`/`react-dom` 必须被
 * **内联**进产物(与 webext 的 external 化方向相反,见 `externals-guard.ts` 头注)。当
 * agent source 与 pi-web 宿主各自安装了一份 react 时,esbuild 默认按「就近导入者」逐个解析
 * 裸说明符——agent 入口拿到 agent 的副本,而入口打包进来的宿主侧代码(如
 * `@blksails/pi-web-canvas-ui` 组件)按自身文件位置解析,会拿到宿主的副本。两份副本同时
 * 打包进同一个 IIFE ⇒ hooks 状态错位、"Invalid hook call" 白屏。
 *
 * 本插件强制**全部** `react`/`react-dom`(含子路径,如 `react/jsx-runtime`、
 * `react-dom/client`)的解析都收敛到同一处——**agent source 根**,而不是本插件自身/CLI
 * 所在位置(research.md R-5:解析基准若取 CLI 位置,会反向解析到 pi-web 自己的副本)。
 * 解析基准之所以取 agent source 根而非某个具体入口文件,是因为它需要对**任意**导入者一视
 * 同仁地生效,不论该导入者物理上位于 agent source 内还是被打包进来的宿主侧依赖。
 */
import { createRequire } from "node:module";
import { join } from "node:path";
import type { Plugin } from "esbuild";

/** 命中 `react`/`react-dom` 及其子路径(`react/jsx-runtime`、`react-dom/client` 等)。 */
const REACT_SPECIFIER_FILTER = /^(react|react-dom)(\/.+)?$/;

/**
 * 以 `sourceRoot` 为解析基准强制收敛 `react`/`react-dom` 的裸说明符解析。
 *
 * 用 `createRequire` 构造一个「仿佛从 `sourceRoot` 内某文件发起 require」的解析器——
 * Node 的模块解析算法会从该目录起自下而上遍历 `node_modules`,与该目录下实际安装的副本
 * 天然一致,无需额外读取 `package.json` 或手写候选路径表。
 */
export function createReactSingletonPlugin(sourceRoot: string): Plugin {
  // `createRequire` 按传入路径的**目录部分**建立解析基准,文件本身不必真实存在——
  // 用一个 sourceRoot 内的占位文件名,确保 dirname(filename) 恰为 sourceRoot。
  const resolveFromSource = createRequire(join(sourceRoot, "__react_singleton_resolve__.js"));

  return {
    name: "react-singleton",
    setup(build) {
      build.onResolve({ filter: REACT_SPECIFIER_FILTER }, (args) => {
        try {
          return { path: resolveFromSource.resolve(args.path) };
        } catch (err) {
          const reason = err instanceof Error ? err.message : String(err);
          return {
            errors: [
              {
                text:
                  `无法从 agent source 根解析运行时库 "${args.path}"(基准: ${sourceRoot})。` +
                  `请确认该 agent source 已安装 react/react-dom。原始错误: ${reason}`,
              },
            ],
          };
        }
      });
    },
  };
}
