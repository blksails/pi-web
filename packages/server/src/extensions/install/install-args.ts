/**
 * extension-management — pi 命令参数装配 + 非交互 env(纯函数,Req 2.5/9.2/9.3/10.1)。
 *
 * - `pi install` 始终含 `--ignore-scripts`(禁 npm 生命周期脚本 RCE)。
 * - `pi remove` 装配卸载参数。
 * - git 源注入非交互 env(`GIT_TERMINAL_PROMPT=0`、`GIT_SSH_COMMAND` BatchMode、
 *   `GCM_INTERACTIVE=never`)。
 * - 返回的 args/env 不含敏感凭据(规范化来源不携带 token)。
 *
 * 非交互 git env 的名/值与 `agent-source-resolver` 的 `nonInteractiveGitEnv` 对齐
 * (单一事实来源在该模块;此处内联同一组键值以保持纯函数无 IO)。
 */
import type { ExtSource, InstallArgs } from "../ext.types.js";

/** 强制非交互的 git 执行 env(与 agent-source-resolver 对齐)。 */
export function gitInstallEnv(): Record<string, string> {
  return {
    GIT_TERMINAL_PROMPT: "0",
    GIT_SSH_COMMAND: "ssh -o BatchMode=yes -o StrictHostKeyChecking=accept-new",
    GCM_INTERACTIVE: "never",
  };
}

/** 把已规范化来源还原为传给 `pi install` 的来源标识。 */
function sourceArg(source: ExtSource): string {
  switch (source.kind) {
    case "npm":
      return source.scope !== undefined
        ? `${source.scope}/${source.name}@${source.version}`
        : `${source.name}@${source.version}`;
    case "git":
      return `https://${source.host}/${source.repoPath}#${source.ref}`;
    case "local":
      return source.path;
  }
}

/** 装配 `pi install <source> --ignore-scripts`(+ git 源非交互 env)。 */
export function assembleInstallArgs(source: ExtSource): InstallArgs {
  const args = ["install", sourceArg(source), "--ignore-scripts"];
  const env: Record<string, string> =
    source.kind === "git" ? gitInstallEnv() : {};
  return { args, env };
}

/** 装配 `pi remove <source>`(非交互)。 */
export function assembleRemoveArgs(sourceId: string): InstallArgs {
  return { args: ["remove", sourceId], env: {} };
}
