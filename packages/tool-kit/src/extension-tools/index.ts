/**
 * extension-tools — pi-web 内置扩展管理（spec extension-install-agent-tools）。
 *
 * 经 `forcedExtensionPaths` 强制注入每个会话的 pi 扩展（install/uninstall/list 工具 +
 * reload-runtime 命令），用 ctx.ui 呈现安装信息/进度。门控逻辑见 {@link gateInstall}。
 *
 * 注入路径解析由消费侧（pi-handler/runner）负责：扩展文件即本目录的 `extension-manager`，
 * 经 spawn env `PI_WEB_EXT_TOOLS_ENTRY` 下发给 agent 子进程，option-mapper 加入 forcedExtensionPaths。
 */
export { default as extensionManager } from "./extension-manager.js";
export { parseListLines } from "./extension-manager.js";
export {
  checkAllowlist,
  gateInstall,
  gateMutate,
  toInstallArg,
  DEFAULT_ALLOWLIST,
  type AllowlistConfig,
  type AllowlistDecision,
  type ExtSource,
  type GateEnv,
  type GateResult,
} from "./gate.js";
