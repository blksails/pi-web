/**
 * attachment-tool-bridge · 临时文件登记器 `TempFileTracker`
 * (task 2.1;Req 2.1, 2.2, 2.3, 2.4)。
 *
 * 远程后端(S3 风格)`localPath()` 懒下载会在本地产生临时文件;本登记器按**工具调用维度**
 * 与**会话维度**登记这些临时文件,提供「调用结束回收」(`cleanupForCall`)与「会话结束回收」
 * (`cleanupForSession`)两入口,避免临时文件随会话累积堆积(Req 2.1/2.2/2.3)。
 *
 * 设计约束(design.md §TempFileTracker / §Error Handling):
 * - **本地后端不登记**:LocalFs `localPath()` 直返落盘文件路径(`<root>/<id>`),无临时文件、无需回收;
 *   调用方对本地后端**不调用 `track`**,故未登记的本地落盘文件不会被任何回收入口删除(no-op,Req 2.4)。
 * - **吞错不阻断**:回收时单个文件删除失败(不存在/权限等)**吞错记日志**(默认经 @pi-web/logger `core:attachment` 命名空间 .error),
 *   不抛出、不阻断同批其它文件回收,也不阻断主流程(尽力回收,design §Error Handling「临时文件回收失败」)。
 * - **本切片 LocalFs 落地**:S3 懒下载真实实现 future;本登记器为可切换接口预留,逻辑与后端无关
 *   (登记什么删什么),故本地后端只要不 `track` 即天然 no-op。
 *
 * 删除使用 `node:fs/promises.rm({ force: true })`:`force` 使「文件不存在」不抛(幂等),
 * 仍捕获其它异常(权限等)走吞错路径。
 */
import { rm } from "node:fs/promises";
import { createLogger } from "@pi-web/logger";
import type { Sink } from "@pi-web/logger";

/** 临时文件登记与两级回收(design.md §TempFileTracker 契约)。 */
export interface TempFileTracker {
  /**
   * 登记一个懒下载产生的临时文件,关联其工具调用与会话维度,供后续按调用/按会话回收(Req 2.1)。
   *
   * 仅远程后端懒下载临时文件需登记;本地后端 `localPath()` 直返落盘文件,**不应** `track`(Req 2.4)。
   */
  track(toolCallId: string, sessionId: string, path: string): void;
  /** 一次工具调用结束:回收该调用期间登记的全部临时文件(Req 2.2)。失败吞错,不抛。 */
  cleanupForCall(toolCallId: string): Promise<void>;
  /** 一个会话结束:回收该会话残留的、尚未被回收的全部临时文件(Req 2.3)。失败吞错,不抛。 */
  cleanupForSession(sessionId: string): Promise<void>;
}

/** 登记的单条临时文件记录(内部)。 */
interface TempEntry {
  readonly toolCallId: string;
  readonly sessionId: string;
  readonly path: string;
}

/** {@link createTempFileTracker} 选项。 */
export interface TempFileTrackerOptions {
  /**
   * 回收失败时的日志钩子(可注入覆盖,向后兼容);若提供则优先使用覆盖而非默认 logger。
   * 默认经 createLogger({ namespace: "core:attachment" }).error 产出。
   * design §Error Handling:「`cleanup` 内部吞错 + 记日志,不阻断主流程」。
   */
  onError?: (message: string, error: unknown) => void;
  /**
   * 注入 logger 的 sink(仅测试用);未注入时使用默认 sink (node: stderr / browser: bus)。
   */
  loggerSink?: Sink;
}

/**
 * 创建一个内存内的临时文件登记器。
 *
 * 状态为进程内瞬态映射(`toolCallId → 记录[]`、`sessionId → 记录[]`),仅远程后端场景非空;
 * 本地后端因调用方不 `track` 而天然为空(no-op,Req 2.4)。
 */
export function createTempFileTracker(
  options: TempFileTrackerOptions = {},
): TempFileTracker {
  const _logger = createLogger({
    namespace: "core:attachment",
    ...(options.loggerSink !== undefined ? { sink: options.loggerSink } : {}),
  });
  const onError =
    options.onError !== undefined
      ? options.onError
      : (message: string, error: unknown) => {
          // 吞错记日志(不抛、不阻断);不打印文件内容,仅路径与错因。
          _logger.error(message, error);
        };

  // 按两维度索引同一批记录,使按调用/按会话回收都能 O(命中) 定位。
  const byCall = new Map<string, TempEntry[]>();
  const bySession = new Map<string, TempEntry[]>();

  /** 从两维度索引里移除一条记录(回收后清理登记,避免重复回收 / 内存泄漏)。 */
  function forget(entry: TempEntry): void {
    const callList = byCall.get(entry.toolCallId);
    if (callList) {
      const next = callList.filter((e) => e !== entry);
      if (next.length === 0) byCall.delete(entry.toolCallId);
      else byCall.set(entry.toolCallId, next);
    }
    const sessionList = bySession.get(entry.sessionId);
    if (sessionList) {
      const next = sessionList.filter((e) => e !== entry);
      if (next.length === 0) bySession.delete(entry.sessionId);
      else bySession.set(entry.sessionId, next);
    }
  }

  /** 尽力删除一批记录:逐个删,单个失败吞错记日志,不阻断其它;成功/失败都解除登记。 */
  async function recycle(entries: readonly TempEntry[]): Promise<void> {
    for (const entry of entries) {
      try {
        // force:true → 文件不存在不抛(幂等);其它异常(权限等)走 catch 吞错。
        await rm(entry.path, { force: true });
      } catch (error) {
        onError(
          `[attachment-bridge] failed to recycle temp file: ${entry.path}`,
          error,
        );
      } finally {
        // 无论删成功与否都解除登记:避免后续重复尝试 / 残留映射。
        forget(entry);
      }
    }
  }

  return {
    track(toolCallId, sessionId, path) {
      const entry: TempEntry = { toolCallId, sessionId, path };
      const callList = byCall.get(toolCallId);
      if (callList) callList.push(entry);
      else byCall.set(toolCallId, [entry]);
      const sessionList = bySession.get(sessionId);
      if (sessionList) sessionList.push(entry);
      else bySession.set(sessionId, [entry]);
    },

    async cleanupForCall(toolCallId) {
      // 取该调用登记的快照(recycle 内会改 map,故先复制)。
      const entries = byCall.get(toolCallId);
      if (entries === undefined || entries.length === 0) return; // 未知/已清 → no-op。
      await recycle([...entries]);
    },

    async cleanupForSession(sessionId) {
      const entries = bySession.get(sessionId);
      if (entries === undefined || entries.length === 0) return; // 未知/已清 → no-op。
      await recycle([...entries]);
    },
  };
}
