/**
 * command-marker — 纯扩展命令的历史持久化 seam（spec plugin-system-unification R13）。
 *
 * 背景：斜杠命令对 pi SDK 是**动作**——`AgentSession.prompt()` 先 `_tryExecuteExtensionCommand`，
 * 纯命令（如 `/review`，只经 `ctx.ui` 反馈、不触发对话轮）跑完 handler 即返回,**不向
 * `session.messages` 写任何 message** → `get_messages` 0 条 → 冷恢复转录区空白。R11 让前端以
 * `doSend` 渲染乐观 `/review` 气泡,遂出现"实时有气泡、刷新即消失"的反向不一致。
 *
 * 修法（R13）：在进入 `runRpcMode`(SDK 拥有 RPC 循环)**之前**包裹 `session.prompt`,以**注册表无关**
 * 的判据识别纯命令——`prompt()` 前后 `session.messages.length` 未变且 `!session.isStreaming`——
 * 恰好覆盖"跑了但没留历史"的问题集（普通消息/ skill 展开会新增 message;触发 turn 的命令进入
 * streaming——二者自动排除）。命中即以 `sessionManager.appendCustomEntry(PIWEB_COMMAND_CUSTOM_TYPE)`
 * 持久化一条 **LLM-clean** 的 session 自定义条目（session 文件条目,**不入** `session.messages` /
 * `convertToLlm`——不污染上下文、不破坏 provider 角色交替）。服务端 `GET /messages` 再据此合并 surfacing。
 *
 * 边界（诚实记录）：
 * - 仅包裹当前 `session` 实例的 `prompt`。进程内 `new_session`/`switchSession`/`fork` 换新
 *   `AgentSession` 后,`runRpcMode` rebind 到的新实例 `prompt` 未被包裹（pi-web 一进程一会话为常态,
 *   此场景罕见）。如需覆盖须在 rebind 钩子重包裹——本特性不纳入。
 * - builtin 命令（`/clear` 等）前端经 ui-rpc 通道派发、不抵达 runner,故不会被误标记（依赖前端路由不变量）。
 * - 检测以 message 计数为准,与具体扩展无关,故对任意第三方 pi 扩展零改动生效。
 */
import type { SessionManager } from "@earendil-works/pi-coding-agent";
import {
  PIWEB_COMMAND_CUSTOM_TYPE,
  type PiwebCommandMarkerData,
} from "../session-store/piweb-entries.js";

export { PIWEB_COMMAND_CUSTOM_TYPE, type PiwebCommandMarkerData };

/** 被包裹的最小 `AgentSession` 接口（仅取本 seam 所需成员,避免与 SDK 类型强耦合）。 */
interface WrappableSession {
  prompt(text: string, options?: unknown): Promise<void>;
  readonly messages: ReadonlyArray<unknown>;
  readonly isStreaming: boolean;
}

/** `appendCustomEntry` 的最小接口（同上,仅取所需）。 */
type CustomEntrySink = Pick<SessionManager, "appendCustomEntry">;

/**
 * 包裹 `session.prompt`：纯扩展命令完成后持久化 `piweb.command` 标记。**幂等性不保证**——
 * 应在每个会话仅调用一次（runtime 装配后、`runRpcMode` 之前）。
 *
 * @returns 解除包裹的还原函数（测试 / 清理用;生产通常不需要）。
 */
export function wireCommandMarkerPersistence(
  session: WrappableSession,
  sessionManager: CustomEntrySink,
): () => void {
  const original = session.prompt.bind(session);

  const wrapped = async (text: string, options?: unknown): Promise<void> => {
    const isSlash = typeof text === "string" && text.startsWith("/");
    const before = isSlash ? session.messages.length : -1;

    // 原 prompt 全程跑完再判定:普通消息/skill 展开在 turn 结束时 message 已增长;
    // 纯命令 handler 跑完即 resolve 且 message 不变。原 prompt 抛错则直接外抛、不标记。
    await original(text, options);

    if (
      isSlash &&
      session.messages.length === before &&
      !session.isStreaming
    ) {
      try {
        const data: PiwebCommandMarkerData = { text };
        sessionManager.appendCustomEntry(PIWEB_COMMAND_CUSTOM_TYPE, data);
      } catch (err) {
        // best-effort 审计:持久化失败不影响命令执行 / 不外抛。
        process.stderr.write(
          `runner: failed to persist command marker: ${String(err)}\n`,
        );
      }
    }
  };

  // 替换实例方法（runRpcMode 在调用点读 `session.prompt`,故实例级替换即生效）。
  (session as { prompt: typeof wrapped }).prompt = wrapped;

  return () => {
    (session as { prompt: WrappableSession["prompt"] }).prompt = original;
  };
}
