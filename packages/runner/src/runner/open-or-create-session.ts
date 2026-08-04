/**
 * runner · 会话打开或新建 `openOrCreateSession`(SRP:从 `startRunner` 组合根剥离)。
 *
 * open-or-create by id(对齐 pi CLI main.js:255-261):给定 `sessionId` 时,若该 id 的会话文件
 * 已存在则 `open` 加载历史(恢复),否则以该 id 新建——使持久化文件 id 与主进程 sessionId 对齐,
 * 支撑 URL 冷恢复。未给 id 则保持既有行为(随机新建)。
 */
import { SessionManager } from "@earendil-works/pi-coding-agent";

export interface OpenOrCreateSessionResult {
  readonly sessionManager: SessionManager;
  /** 是否为**新建**会话(true=新建;false=打开了已有会话文件)。 */
  readonly isNewSession: boolean;
}

/**
 * 按 `cwd` + 可选 `sessionId` 打开或新建会话。
 *
 * @param cwd       会话工作目录。
 * @param sessionId 显式会话 id(URL 冷恢复);未给则随机新建。
 * @param sessionDir 可选会话根目录;省略则跟随 `PI_CODING_AGENT_SESSION_DIR`。
 */
export async function openOrCreateSession(
  cwd: string,
  sessionId: string | undefined,
  sessionDir?: string,
): Promise<OpenOrCreateSessionResult> {
  const configuredSessionDir = sessionDir ?? process.env["PI_CODING_AGENT_SESSION_DIR"];
  const resolvedSessionDir = configuredSessionDir === "" ? undefined : configuredSessionDir;
  if (sessionId === undefined) {
    return {
      sessionManager: SessionManager.create(cwd, resolvedSessionDir),
      isNewSession: true,
    };
  }
  const existing = (await SessionManager.list(cwd, resolvedSessionDir)).find(
    (s) => s.id === sessionId,
  );
  if (existing !== undefined) {
    return {
      sessionManager: SessionManager.open(existing.path, resolvedSessionDir, cwd),
      isNewSession: false,
    };
  }
  return {
    sessionManager: SessionManager.create(cwd, resolvedSessionDir, { id: sessionId }),
    isNewSession: true,
  };
}
