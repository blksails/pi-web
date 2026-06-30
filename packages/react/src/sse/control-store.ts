/**
 * control 旁路 store — useSyncExternalStore 兼容的可订阅 store。
 *
 * 持有不可变快照 { queue, stats, error, extensionUiQueue };applyControlFrame 按 control
 * 子类型(extension-ui / queue / stats / error)更新;扩展 UI 请求按 FIFO 入队 / 出队
 * (不丢弃)。读经 getSnapshot 返回稳定引用(无变更不换引用),配合 useSyncExternalStore 防撕裂。
 *
 * 类型取自 @blksails/pi-web-protocol(ControlPayload / RpcExtensionUIRequest / SessionStats)。
 */
import type {
  ControlPayload,
  RpcExtensionUIRequest,
  SessionLifecycleState,
  SessionSnapshot,
  SessionStats,
  UiRpcResponse,
} from "@blksails/pi-web-protocol";
import type { LogEntry } from "@blksails/pi-web-logger";

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

/**
 * 会话生命周期快照(来自 session-status control 帧,spec session-readiness-handshake)。
 * 初始 `initializing` 为**失败安全默认**:收到任何帧前默认不可发送,绝不抢跑。
 */
export interface SessionLifecycleSnapshot {
  readonly state: SessionLifecycleState;
  readonly detail: string | undefined;
  readonly code: string | undefined;
}

/** 推送类 notify 帧派生的通知项(帧 notifyType 缺省归一为 "info")。 */
export interface ExtensionNotification {
  /** 帧 id。 */
  readonly id: string;
  readonly message: string;
  readonly notifyType: "info" | "warning" | "error";
}

/** 推送类 setWidget 帧派生的 widget 项(帧 widgetPlacement 缺省归一为 "aboveEditor")。 */
export interface ExtensionWidget {
  readonly lines: readonly string[];
  readonly placement: "aboveEditor" | "belowEditor";
}

/** 推送类 set_editor_text 帧派生的一次性写入信号(seq 单调递增,消费方据变化触发一次)。 */
export interface EditorTextSignal {
  readonly text: string;
  readonly seq: number;
}

/** 推送类 5 方法分流出的 ambient 状态切片(无回包,不入对话框队列)。 */
export interface AmbientUiSnapshot {
  /** 有序通知列表(追加 + 按 id 移除,软上限保留最近 100)。 */
  readonly notifications: readonly ExtensionNotification[];
  /** 键控状态映射(statusKey → statusText),undefined 文本即删键。 */
  readonly statuses: Readonly<Record<string, string>>;
  /** 键控 widget 映射(widgetKey → widget),undefined lines 即删键。 */
  readonly widgets: Readonly<Record<string, ExtensionWidget>>;
  /** 会话标题(setTitle),未设置为 undefined。 */
  readonly title: string | undefined;
  /** 写入输入框的一次性信号(set_editor_text),未设置为 undefined。 */
  readonly editorText: EditorTextSignal | undefined;
}

/** 通知列表软上限:保留最近 100 条,防御非挂载场景下无限增长。 */
const NOTIFICATIONS_SOFT_CAP = 100;

/** 状态注入桥(state-injection-bridge):单个 key 的前端视图条目(value + 已应用 rev)。 */
export interface SharedStateEntry {
  readonly value: unknown;
  /** 已应用的最大 rev(用于丢弃乱序/过期下行帧)。 */
  readonly rev: number;
}

/** control store 的不可变快照。 */
export interface ControlSnapshot {
  readonly queue: QueueSnapshot;
  /** stats control 帧承载的会话统计(passthrough,按 SessionStats 解读)。 */
  readonly stats: SessionStats | undefined;
  readonly error: SessionErrorSnapshot | null;
  /** 待处理扩展 UI 请求(FIFO,不丢弃)。 */
  readonly extensionUiQueue: readonly RpcExtensionUIRequest[];
  /** 推送类方法分流出的 ambient 状态。 */
  readonly ambient: AmbientUiSnapshot;
  /** 会话生命周期态(session-readiness-handshake);初始 initializing(失败安全)。 */
  readonly lifecycle: SessionLifecycleSnapshot;
  /** 共享状态切片(state-injection-bridge):key→{value,rev},经 control:"state" 帧更新。 */
  readonly states: Readonly<Record<string, SharedStateEntry>>;
  /**
   * 服务端权威会话快照(session-snapshot-authority);收到 session-state 帧前为 undefined。
   * 唯一权威投影:busy/stats 据此派生,前端不再从消息流 status 时序推断。
   */
  readonly session: SessionSnapshot | undefined;
  /** 轮次是否进行中(权威 busy,来自 session.busy);无快照时为 false(失败安全)。 */
  readonly busy: boolean;
}

const EMPTY_QUEUE: QueueSnapshot = { steering: [], followUp: [] };

const INITIAL_LIFECYCLE: SessionLifecycleSnapshot = {
  state: "initializing",
  detail: undefined,
  code: undefined,
};

const EMPTY_AMBIENT: AmbientUiSnapshot = {
  notifications: [],
  statuses: {},
  widgets: {},
  title: undefined,
  editorText: undefined,
};

const INITIAL_SNAPSHOT: ControlSnapshot = {
  queue: EMPTY_QUEUE,
  stats: undefined,
  error: null,
  extensionUiQueue: [],
  ambient: EMPTY_AMBIENT,
  lifecycle: INITIAL_LIFECYCLE,
  states: {},
  session: undefined,
  busy: false,
};

type Listener = () => void;

/** 可订阅的 control 旁路 store。 */
export class ControlStore {
  private snapshot: ControlSnapshot = INITIAL_SNAPSHOT;
  private readonly listeners = new Set<Listener>();
  /** editorText 信号计数器(单调递增,从 1 起)。 */
  private editorTextSeq = 0;
  /** ui-rpc 下行响应监听(use-ui-rpc 订阅,按 correlationId 配对)。 */
  private readonly uiRpcListeners = new Set<(r: UiRpcResponse) => void>();
  /** control:"logs" 帧转发回调(由装配方注入,转交 logsStore.applyLogsFrame)。 */
  private _onLogsFrame: ((entries: LogEntry[]) => void) | undefined;

  /** 注册 control:"logs" 帧处理回调(由 logsStore 在装配时注入)。返回取消注册函数。 */
  readonly onLogsFrame = (cb: (entries: LogEntry[]) => void): (() => void) => {
    this._onLogsFrame = cb;
    return () => {
      if (this._onLogsFrame === cb) this._onLogsFrame = undefined;
    };
  };

  /** 订阅 ui-rpc 下行响应。返回取消订阅函数。 */
  readonly onUiRpcResponse = (cb: (r: UiRpcResponse) => void): (() => void) => {
    this.uiRpcListeners.add(cb);
    return () => {
      this.uiRpcListeners.delete(cb);
    };
  };

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
        this.routeExtensionUi(
          payload.request as unknown as RpcExtensionUIRequest,
        );
        break;
      case "ui-rpc":
        // Tier3 下行响应:不入快照,直接派发给 use-ui-rpc 监听(按 correlationId 配对)。
        for (const cb of this.uiRpcListeners) cb(payload.response);
        break;
      case "logs":
        // 实时 Node 日志帧:转发给注入的 logsStore 回调,不进 ControlSnapshot。
        if (this._onLogsFrame !== undefined) {
          this._onLogsFrame(payload.entries as LogEntry[]);
        }
        break;
      case "state":
        // 状态注入桥(state-injection-bridge):下行镜像帧,按 rev 守卫更新 states 切片。
        this.applyStateFrame(
          payload.key,
          payload.value,
          payload.rev,
          payload.deleted === true,
        );
        break;
      case "session-status":
        // 会话生命周期态(session-readiness-handshake):更新 lifecycle 切片。
        // 相同态不换引用(防 useSyncExternalStore 抖动)。
        if (
          this.snapshot.lifecycle.state !== payload.state ||
          this.snapshot.lifecycle.detail !== payload.detail ||
          this.snapshot.lifecycle.code !== payload.code
        ) {
          this.emit({
            ...this.snapshot,
            lifecycle: {
              state: payload.state,
              detail: payload.detail,
              code: payload.code,
            },
          });
        }
        break;
      case "session-state": {
        // 权威快照帧(session-snapshot-authority):吸收 snapshot 成为唯一权威投影。
        // busy 来自 snapshot.busy(替代 useChat.status 时序推断);stats 据快照同步(单一来源,
        // 不再 REST 双源 merge);lifecycle 的 detail/code 仍由 session-status 帧承载,过渡期一致,
        // 故此处不覆写 lifecycle 切片。服务端仅在变更时广播本帧,直接 emit 即可。
        const snap = payload.snapshot;
        const nextStats = (snap.stats as SessionStats | undefined) ?? this.snapshot.stats;
        this.emit({
          ...this.snapshot,
          session: snap,
          busy: snap.busy,
          stats: nextStats,
        });
        break;
      }
      default: {
        const _exhaustive: never = payload;
        void _exhaustive;
        break;
      }
    }
  }

  /**
   * 按 method 分流扩展 UI 请求:交互类(select/confirm/input/editor)入对话框
   * FIFO 队列(需回包);推送类(notify/setStatus/setWidget/setTitle/
   * set_editor_text)写入键控/列表 ambient 切片(无回包)。
   *
   * 关键不变量:推送类绝不进入 extensionUiQueue(修复推送阻塞交互对话框缺陷),
   * 交互类绝不进入 ambient。
   */
  private routeExtensionUi(request: RpcExtensionUIRequest): void {
    switch (request.method) {
      case "select":
      case "confirm":
      case "input":
      case "editor":
        this.enqueueExtensionUi(request);
        break;
      case "notify":
        this.appendNotification({
          id: request.id,
          message: request.message,
          notifyType: request.notifyType ?? "info",
        });
        break;
      case "setStatus":
        this.setStatus(request.statusKey, request.statusText);
        break;
      case "setWidget":
        this.setWidget(
          request.widgetKey,
          request.widgetLines,
          request.widgetPlacement ?? "aboveEditor",
        );
        break;
      case "setTitle":
        this.setTitle(request.title);
        break;
      case "set_editor_text":
        this.pushEditorText(request.text);
        break;
      default: {
        const _exhaustive: never = request;
        void _exhaustive;
        break;
      }
    }
  }

  /** 以新 ambient 切片发射(浅合并到既有快照)。 */
  private emitAmbient(ambient: AmbientUiSnapshot): void {
    this.emit({ ...this.snapshot, ambient });
  }

  /**
   * 应用一条状态下行帧(state-injection-bridge)。rev 守卫:仅当 `rev` 严格大于该 key 已应用
   * rev 才更新,否则丢弃(防乱序/过期回退)。`deleted` 删键。不变更则不换引用(防抖动)。
   */
  private applyStateFrame(
    key: string,
    value: unknown,
    rev: number,
    deleted: boolean,
  ): void {
    const cur = this.snapshot.states[key];
    // rev 守卫:不大于已应用 rev 即丢弃(乱序保护)。
    if (cur !== undefined && rev <= cur.rev) return;
    if (deleted) {
      if (cur === undefined) return; // 已无该键,不换引用
      const next = { ...this.snapshot.states };
      delete next[key];
      this.emit({ ...this.snapshot, states: next });
      return;
    }
    this.emit({
      ...this.snapshot,
      states: { ...this.snapshot.states, [key]: { value, rev } },
    });
  }

  /** 追加通知,超出软上限时丢弃最旧的,只保留最近 NOTIFICATIONS_SOFT_CAP 条。 */
  private appendNotification(notification: ExtensionNotification): void {
    // 按 id 幂等:同一 notify 帧(一次 ctx.ui.notify emit)会广播到多条订阅流(per-prompt + 空闲控制流),
    // 每条都 applyControlFrame → 若直接追加会重复显示同一通知。已存在同 id 则跳过(去重)。
    if (this.snapshot.ambient.notifications.some((n) => n.id === notification.id)) {
      return;
    }
    const next = [...this.snapshot.ambient.notifications, notification];
    const capped =
      next.length > NOTIFICATIONS_SOFT_CAP
        ? next.slice(next.length - NOTIFICATIONS_SOFT_CAP)
        : next;
    this.emitAmbient({ ...this.snapshot.ambient, notifications: capped });
  }

  /** 置/替换键控状态;text 为 undefined 即删该键(不存在则 no-op,不换引用)。 */
  private setStatus(key: string, text: string | undefined): void {
    const { statuses } = this.snapshot.ambient;
    if (text === undefined) {
      if (!(key in statuses)) return;
      const next = { ...statuses };
      delete next[key];
      this.emitAmbient({ ...this.snapshot.ambient, statuses: next });
      return;
    }
    this.emitAmbient({
      ...this.snapshot.ambient,
      statuses: { ...statuses, [key]: text },
    });
  }

  /** 置/替换键控 widget;lines 为 undefined 即删该键(不存在则 no-op,不换引用)。 */
  private setWidget(
    key: string,
    lines: readonly string[] | undefined,
    placement: "aboveEditor" | "belowEditor",
  ): void {
    const { widgets } = this.snapshot.ambient;
    if (lines === undefined) {
      if (!(key in widgets)) return;
      const next = { ...widgets };
      delete next[key];
      this.emitAmbient({ ...this.snapshot.ambient, widgets: next });
      return;
    }
    this.emitAmbient({
      ...this.snapshot.ambient,
      widgets: { ...widgets, [key]: { lines, placement } },
    });
  }

  /** 置/替换会话标题。 */
  private setTitle(title: string): void {
    this.emitAmbient({ ...this.snapshot.ambient, title });
  }

  /** 写入输入框一次性信号,seq 单调递增(从 1 起)。 */
  private pushEditorText(text: string): void {
    this.editorTextSeq += 1;
    this.emitAmbient({
      ...this.snapshot.ambient,
      editorText: { text, seq: this.editorTextSeq },
    });
  }

  /** 按 id 移除通知(不存在则 no-op,不换引用)。 */
  dismissNotification(id: string): void {
    const next = this.snapshot.ambient.notifications.filter((n) => n.id !== id);
    if (next.length === this.snapshot.ambient.notifications.length) return;
    this.emitAmbient({ ...this.snapshot.ambient, notifications: next });
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
