/**
 * `@blksails/pi-web-core` 主入口 —— headless 内核的聚合导出面
 * (spec: core-package-extraction,任务 5.1)。
 *
 * ★ 本文件**只聚合 core 层模块**。装配层(主 barrel、默认能力面清单)、runner 实现与
 *   adapters 一律不在此 —— 它们住在 `@blksails/pi-web-server`。这不是风格偏好:
 *   内核包的价值就是"只要会话引擎的宿主不必安装云沙箱 SDK 与数据库驱动",
 *   往这里加一条 adapters 的 re-export 就等于把那个价值撤销掉。
 *
 * ★ 这份清单**逐条对应**兼容层主 barrel 原有的 core 导出,顺序与写法一并保留 ——
 *   包括那些刻意用具名导出(而非 `export *`)的条目。它们的窄是有意为之:
 *   `sourceKey` / `resolveSandboxEntry` / `builtin-agents/entry-path` 都只放出路径与
 *   标识,把含 pi SDK 值导入的取数闭包挡在外面。**不要"顺手补全"**(R2.4)。
 *
 * ★ 刻意**不在**此处导出的:`config/model-options`、`vision-settings/vision-model-options`
 *   (值导入 agent 运行时 SDK)与 `workspace/testing`(测试套件,进主入口会随之进运行期
 *   产物)。三者各有独立子路径。
 */
export * from "./rpc-channel/index.js";
export * from "./agent-source/index.js";
export * from "./builtin-agents/entry-path.js";
export * from "./session/index.js";
export * from "./session-store/index.js";
export * from "./http/index.js";
export * from "./attachment/index.js";
export * from "./attachment-bridge/index.js";
export * from "./completion/index.js";
export * from "./commands/host-command-registry.js";
export { sourceKey, isSourceKey } from "./source-key.js";
export * from "./config/index.js";
export * from "./session-list/index.js";
// session-meta(session-meta-index):会话展示元数据索引(端口 + 集中 JSON 文件实现)。
// 仅 node builtins,无 pi SDK 值导入,可安全经 barrel 重导出。
export * from "./session-meta/index.js";
export * from "./agent-source-list/index.js";
export * from "./aigc-settings/index.js";
export * from "./vision-settings/index.js";
export * from "./session-actions/index.js";
export { resolveSandboxEntry } from "./sandbox/entry.js";
export * from "./model-catalog/index.js";
export * from "./host-contract-version.js";
export * from "./workspace/index.js";
export * from "./capability/index.js";
export * from "./parent-watchdog.js";
export * from "./host-manifest/index.js";
export * from "./config-domain/index.js";
