/**
 * session — 会话活跃态派生(spec session-meta-index, Req 7.x)。
 *
 * 纯函数、无 IO、不读时钟:把**既有权威事实**投影成会话列表可显示的一个值。
 * 三个输入都不是本 spec 新造的 —— `busy`/`lifecycle` 来自 `SessionSnapshot`
 * (session-snapshot-authority 的权威字段),`pendingMethods` 来自 `PiSession` 的
 * extension-ui 挂起表。本模块**不新增**任何状态字段(Req 7.7)。
 *
 * ★ 为何必须按 method 过滤:服务端 `handleExtensionUIRequest` 把**所有** extension-ui 请求
 *   无条件登记进挂起表,而推送类(`notify`/`setStatus`/`setWidget`/`setTitle`/`set_editor_text`)
 *   永不回包、永久滞留。若直接用「挂起表非空」判定,任何发过一次 `notify` 的会话都会
 *   **永久**显示「等待用户交互」。故只有交互四类(protocol 的
 *   `INTERACTIVE_EXTENSION_UI_METHODS`,单一权威)才算在等用户(Req 7.2)。
 *
 * 空闲返回 `undefined` 而非 `"idle"`:列表 DTO 据此**省略**字段,前端不显示任何指示(Req 7.6)。
 */
import {
  isInteractiveExtensionUIMethod,
  type SessionActivity,
  type SessionLifecycleState,
} from "@blksails/pi-web-protocol";

export interface ActivityInput {
  /** 权威快照的 `busy`:轮次活跃区间(agent_start..agent_end)。 */
  readonly busy: boolean;
  /** 权威快照的 `lifecycle`:会话业务就绪态。 */
  readonly lifecycle: SessionLifecycleState;
  /** 当前挂起的 extension-ui 请求 method 列表(**未过滤**,含推送类)。 */
  readonly pendingMethods: readonly string[];
}

/**
 * 派生列表可见的活跃态。优先级(自高向低):
 *
 *   `awaiting-input` → `error` → `working` → 空闲(`undefined`)
 *
 * - 等待用户交互高于工作中:需要用户行动的状态信息量更大(Req 7.4;交互期间 `busy` 仍为 true)。
 * - 异常高于工作中:lifecycle 进入 error 后轮次已无意义。
 */
export function deriveActivity(input: ActivityInput): SessionActivity | undefined {
  if (input.pendingMethods.some(isInteractiveExtensionUIMethod)) {
    return "awaiting-input";
  }
  if (input.lifecycle === "error") return "error";
  if (input.busy) return "working";
  return undefined;
}
