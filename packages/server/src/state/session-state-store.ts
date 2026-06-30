/**
 * 状态注入桥 · 子进程内权威状态核 `SessionStateStore`(纯逻辑,可单测)。
 *
 * 一份会话级、可变、可订阅的 key→value KV,**权威副本位于 agent 子进程**(由 pi-web 自建;
 * pi 0.79.6 无原生可变 KV)。活在 LLM 对话历史之外(context 外):工具经 globalThis seam 同步
 * 读写,变更经 subscribe 由 `wireStateBridge` 镜像到 UI。核心**不**直接推 UI —— 那是宿主之责。
 *
 * 不变量:每个 key 的 `rev` 从 0 起、跨 set/delete 严格单调递增。
 */

/** 一次状态变更(派发给订阅者,供宿主镜像到 UI / 落库)。 */
export interface StateChange {
  readonly key: string;
  /** delete 时为 undefined。 */
  readonly value: unknown;
  /** 该 key 的单调递增修订号。 */
  readonly rev: number;
  readonly deleted: boolean;
}

/** 单个 key 的快照条目。 */
export interface StateEntry {
  readonly value: unknown;
  readonly rev: number;
}

/** 会话级权威状态核。 */
export interface SessionStateStore {
  /** 读 key 当前值;未初始化返回 undefined(不报错)。 */
  get(key: string): unknown;
  /** 全量快照(key→{value,rev}),只读。 */
  snapshot(): ReadonlyMap<string, StateEntry>;
  /** 写入 key,返回新 rev。 */
  set(key: string, value: unknown): number;
  /** 删除 key;返回是否实际删除(原本存在)。删除仍推进 rev。 */
  delete(key: string): boolean;
  /** 订阅变更,返回取消订阅函数。 */
  subscribe(listener: (change: StateChange) => void): () => void;
}

/** 创建一个全新的会话级状态核。 */
export function createSessionStateStore(): SessionStateStore {
  const entries = new Map<string, StateEntry>();
  /** 每 key 的下一个 rev(从 0 起,跨 set/delete 连续单调)。 */
  const nextRev = new Map<string, number>();
  const listeners = new Set<(change: StateChange) => void>();

  const bumpRev = (key: string): number => {
    const rev = nextRev.get(key) ?? 0;
    nextRev.set(key, rev + 1);
    return rev;
  };

  const emit = (change: StateChange): void => {
    for (const listener of listeners) listener(change);
  };

  return {
    get(key) {
      return entries.get(key)?.value;
    },
    snapshot() {
      return new Map(entries);
    },
    set(key, value) {
      const rev = bumpRev(key);
      entries.set(key, { value, rev });
      emit({ key, value, rev, deleted: false });
      return rev;
    },
    delete(key) {
      const existed = entries.has(key);
      const rev = bumpRev(key);
      entries.delete(key);
      emit({ key, value: undefined, rev, deleted: true });
      return existed;
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
