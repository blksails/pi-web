// @pi-web/server — 聚合导出(各模块实现后在此 re-export)。
//
// 注意:不再从此主入口 re-export `./runner/index.js`。runner 模块在加载时即
// 静态导入完整 pi SDK(@earendil-works/pi-coding-agent / pi-ai)与 jiti——一旦
// 经此 barrel 进入 Next 服务端 bundle,会触发 webpack "Critical dependency" 告警
// 并把整套 SDK 打进路由。runner 仅由 cwd-无关的引导脚本(runner-bootstrap.mjs)
// 经 jiti 直接加载 `./runner/runner.ts` 在子进程中运行,App / Handler 从不直接
// 导入 runner。需要 runner 符号的(测试)请从 `./runner/index.js` 子路径导入。
export {};
export * from "./rpc-channel/index.js";
export * from "./agent-source/index.js";
export * from "./session/index.js";
export * from "./session-store/index.js";
export * from "./http/index.js";
export * from "./extensions/index.js";
export { runnerBootstrapPath } from "./runner-bootstrap-path.js";
