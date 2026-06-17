/**
 * control 旁路 store — useSyncExternalStore 兼容的可订阅 store。
 *
 * 持有不可变快照 { queue, stats, error, extensionUiQueue };applyControlFrame 按 control
 * 子类型(extension-ui / queue / stats / error)更新;扩展 UI 请求按 FIFO 入队 / 出队
 * (不丢弃)。读经 getSnapshot 返回稳定引用(无变更不换引用),配合 useSyncExternalStore 防撕裂。
 *
 * 类型取自 @pi-web/protocol(ControlPayload / RpcExtensionUIRequest / SessionStats)。
 */
import type {
  ControlPayload,
  RpcExtensionUIRequest,
  SessionStats,
} from "@pi-web/protocol";

/** steering / followUp 队列快照(来自 queue control 帧)。 */
export interface QueueSnapshot {
  readonly steering: readonly string[];
  readonly followUp: readonly string[];
}

/** 会话级错误快照(来自 error control 帧)。 */
export interface SessionErrorSnapshot {
  readonly message: string;
  readonly code: string | undefined;
}

/** control store 的不可变快照。 */
export interface ControlSnapshot {
  readonly queue: QueueSnapshot;
  /** stats control 帧承载的会话统计(passthrough,按 SessionStats 解读)。 */
  readonly stats: SessionStats | undefined;
  readonly error: SessionErrorSnapshot | null;
  /** 待处理扩展 UI 请求(FIFO,不丢弃)。 */
  readonly extensionUiQueue: readonly RpcExtensionUIRequest[];
}

const EMPTY_QUEUE: QueueSnapshot = { steering: [], followUp: [] };

const INITIAL_SNAPSHOT: ControlSnapshot = {
  queue: EMPTY_QUEUE,
  stats: undefined,
  error: null,
  extensionUiQueue: [],
};

type Listener = () => void;

/** 可订阅的 control 旁路 store。 */
export class ControlStore {
  private snapshot: ControlSnapshot = INITIAL_SNAPSHOT;
  private readonly listeners = new Set<Listener>();

  /** 订阅变更(useSyncExternalStore 用)。返回取消订阅函数。 */
  readonly subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  /** 返回当前不可变快照(无变更时引用稳定)。 */
  readonly getSnapshot = (): ControlSnapshot => this.snapshot;

  private emit(next: ControlSnapshot): void {
    this.snapshot = next;
    for (const listener of this.listeners) listener();
  }

  /** 按子类型应用一个 control 帧负载,更新对应快照切片。 */
  applyControlFrame(payload: ControlPayload): void {
    switch (payload.control) {
      case "queue":
        this.emit({
          ...this.snapshot,
          queue: { steering: payload.steering, followUp: payload.followUp },
        });
        break;
      case "stats":
        this.emit({
          ...this.snapshot,
          stats: payload.stats as SessionStats,
        });
        break;
      case "error":
        this.emit({
          ...this.snapshot,
          error: { message: payload.message, code: payload.code },
        });
        break;
      case "extension-ui":
        this.enqueueExtensionUi(
          payload.request as unknown as RpcExtensionUIRequest,
        );
        break;
      default: {
        const _exhaustive: never = payload;
        void _exhaustive;
        break;
      }
    }
  }

  /** 扩展 UI 请求入队(FIFO,末尾追加)。 */
  enqueueExtensionUi(request: RpcExtensionUIRequest): void {
    this.emit({
      ...this.snapshot,
      extensionUiQueue: [...this.snapshot.extensionUiQueue, request],
    });
  }

  /** 按 id 出队扩展 UI 请求(响应成功后调用)。不存在则不变更。 */
  dequeueExtensionUi(id: string): void {
    const next = this.snapshot.extensionUiQueue.filter((r) => r.id !== id);
    if (next.length === this.snapshot.extensionUiQueue.length) return;
    this.emit({ ...this.snapshot, extensionUiQueue: next });
  }

  /** 清空会话级错误。 */
  clearError(): void {
    if (this.snapshot.error === null) return;
    this.emit({ ...this.snapshot, error: null });
  }
}
