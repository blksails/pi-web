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
 */
export async function openOrCreateSession(
  cwd: string,
  sessionId: string | undefined,
): Promise<OpenOrCreateSessionResult> {
  if (sessionId === undefined) {
    return { sessionManager: SessionManager.create(cwd), isNewSession: true };
  }
  const existing = (await SessionManager.list(cwd)).find((s) => s.id === sessionId);
  if (existing !== undefined) {
    return {
      sessionManager: SessionManager.open(existing.path, undefined, cwd),
      isNewSession: false,
    };
  }
  return {
    sessionManager: SessionManager.create(cwd, undefined, { id: sessionId }),
    isNewSession: true,
  };
}
