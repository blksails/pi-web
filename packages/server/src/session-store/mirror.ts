/**
 * session-store-adapters — 把 pi `SessionManager` 的写入镜像到 `SessionEntryStore`。
 *
 * 背景:pi 的 `SessionManager` 持久化写死为 fs JSONL(或内存),不可插拔。要把会话也
 * 落到 sqlite/postgres,只能**旁路镜像**:拦截 SM 实例上的 `append*` 方法,在原方法
 * 执行后取回该 entry 并异步写入一份到配置的 `SessionEntryStore`。
 *
 * 实现要点:
 *  - **不改第三方代码**,只在运行进程内替换 SM **实例**的 append 方法;原方法仍以真实
 *    实例为 `this` 调用,故其私有字段不受影响(规避 Proxy 的私有字段陷阱)。
 *  - 镜像为 best-effort 旁路:异步、每会话保序、失败仅回调 `onError`,不阻塞/不拖垮 agent。
 *  - fs 后端由 pi 原生负责,调用方不应对 fs 启用镜像(否则双写同一文件)。
 */
import type { SessionManager } from "@earendil-works/pi-coding-agent";
import type { SessionEntry, SessionEntryStore, SessionHeader } from "./types.js";

/** SM 上所有"追加一条 entry 并返回其 id"的方法名(按存在性逐一 patch)。 */
const APPEND_METHODS = [
  "appendMessage",
  "appendModelChange",
  "appendThinkingLevelChange",
  "appendCompaction",
  "appendBranchSummary",
  "appendLabelChange",
  "appendCustomEntry",
  "appendCustomMessageEntry",
  "appendSessionInfo",
] as const;

export interface SessionMirror {
  /** 等待当前已入队的镜像写入全部落盘(主要用于测试/优雅停机)。 */
  flush(): Promise<void>;
}

type AppendFn = (...args: unknown[]) => unknown;

/**
 * 开始把 `sm` 的写入镜像到 `store`。先把会话头部写入 store,再 patch append* 方法。
 * 返回的 {@link SessionMirror} 可用于 `flush()` 等待镜像队列清空。
 */
export async function mirrorSessionManagerToStore(
  sm: SessionManager,
  store: SessionEntryStore,
  onError: (err: unknown) => void = () => {},
): Promise<SessionMirror> {
  const sessionId = sm.getSessionId();
  const header = sm.getHeader();
  if (header) {
    try {
      await store.create(header as unknown as SessionHeader);
    } catch (err) {
      onError(err);
    }
  }

  let chain: Promise<unknown> = Promise.resolve();
  const enqueue = (entry: SessionEntry): void => {
    chain = chain.then(() => store.append(sessionId, entry)).catch(onError);
  };

  const target = sm as unknown as Record<string, AppendFn>;
  for (const name of APPEND_METHODS) {
    const original = target[name];
    if (typeof original !== "function") continue;
    const bound = original.bind(sm) as AppendFn;
    target[name] = (...args: unknown[]): unknown => {
      const id = bound(...args);
      if (typeof id === "string") {
        const entry = sm.getEntry(id);
        if (entry) enqueue(entry as unknown as SessionEntry);
      }
      return id;
    };
  }

  return { flush: () => chain.then(() => undefined) };
}
