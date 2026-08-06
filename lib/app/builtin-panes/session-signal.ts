/**
 * 会话事实 → 宿主具名信号(spec host-builtin-panes,任务 3.2)。
 *
 * 内置 pane 拿不到会话信息:五种 guest 操作里没有「读会话信息」这一项。宿主具名信号
 * (`pane:signal`)的设计意图正是搬运「只存在于宿主 realm 的东西」,语义是**最后值即真值**
 * —— 新建连接时宿主重推全部当前值,故 pane 晚连、重连、刷新后重建都不丢。见 design D4。
 *
 * ## 载荷边界
 *
 * 会话信号只放会话标识、agent 源、工作目录；身份信号只放递增版本号。
 * **不含凭据、不含 token、不含宿主环境变量**。
 * 工作目录对该会话的 agent 本已可见(它就在那里跑),故不构成新增暴露面。
 */

/** 与 guest 侧 `panes/session-info/view.ts` 约定的信号名。 */
export const SESSION_SIGNAL_NAME = "host:session";
/** 仅通知 pane 重取当前宿主身份数据；不携带用户或公司标识。 */
export const IDENTITY_REVISION_SIGNAL_NAME = "host:identityRevision";

export interface SessionSignalFacts {
  readonly sessionId: string;
  readonly agentSource: string;
  readonly cwd: string;
}

export interface SessionSignalInput {
  readonly sessionId?: string | undefined;
  /** 会话创建请求里的 agent 源标识。 */
  readonly agentSource?: string | undefined;
  /** 会话创建请求里的工作目录。注意这是**请求值**,agent 侧解析后可能另有其所。 */
  readonly cwd?: string | undefined;
}

/**
 * 组装信号映射。
 *
 * 缺字段就不放进载荷 —— guest 侧逐字段校验,缺的会显示占位符,从而「宿主漏推了哪一个」
 * 在界面上直接可见。这比补一个空字符串好:空串与「真的是空目录」无法区分。
 *
 * 三个字段全缺时返回**空映射**(而非含空对象的映射):宿主没有任何可说的事实时,不该推一条
 * 内容为空的信号 —— 那会让 guest 从「从未推送」的空态切到「推了但没内容」的空态,两者的
 * 排查方向完全不同。
 */
export function buildSessionSignals(
  input: SessionSignalInput,
): Readonly<Record<string, unknown>> {
  const facts: Record<string, string> = {};
  if (input.sessionId !== undefined && input.sessionId.length > 0) {
    facts.sessionId = input.sessionId;
  }
  if (input.agentSource !== undefined && input.agentSource.length > 0) {
    facts.agentSource = input.agentSource;
  }
  if (input.cwd !== undefined && input.cwd.length > 0) {
    facts.cwd = input.cwd;
  }
  if (Object.keys(facts).length === 0) return {};
  return { [SESSION_SIGNAL_NAME]: facts };
}
