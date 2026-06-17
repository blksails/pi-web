/**
 * session-engine — PiSession 有状态外壳。
 *
 * 持有注入的 `SessionChannel`(rpc-channel 通道)与 `ResolvedSource`,订阅通道
 * `onEvent`/`onExtensionUIRequest`/`onExit`,把事件经纯函数 `translateEvent` 翻译为
 * protocol 帧并经内部 EventEmitter 广播给所有订阅者(同序一致,Req 3.x);维护
 * extension UI 挂起表(Req 5.x)与最近状态缓存(Req 6.x);转发命令(仅转发不改写
 * 语义,Req 2.x);管理生命周期(idle 回收 / stop 幂等 / 崩溃清理,Req 7.x)。
 *
 * 去注册接缝:PiSession 不持有 SessionStore;进入 stopped 时在清理原语末尾调用
 * 构造时由 SessionManager 注入的 `onClosed(id, reason)` 回调一次(Req 7.5 / 9.4)。
 */
import { EventEmitter } from "node:events";
import type {
  AgentEvent,
  ImageContent,
  RpcExtensionUIRequest,
  RpcExtensionUIResponse,
  RpcResponse,
  SseFrame,
  ThinkingLevel,
} from "@pi-web/protocol";
import { makeControlFrame } from "@pi-web/protocol";
import type { ResolvedSource } from "../agent-source/index.js";
import type { ExitInfo, Unsubscribe } from "../rpc-channel/index.js";
import {
  SessionStoppedError,
  UnknownExtensionUIError,
} from "./session.errors.js";
import {
  type CachedState,
  DEFAULT_IDLE_MS,
  type FrameListener,
  type PiSessionOptions,
  type SessionChannel,
  type SessionDescriptor,
  type SessionEndListener,
  type SessionEndReason,
  type SessionId,
  type SessionStatus,
  type SubscribeHandle,
} from "./session.types.js";
import { translateEvent } from "./translate/translate-event.js";
import {
  createTranslationContext,
  type TranslationContext,
} from "./translate/translation-context.js";

const FRAME_EVENT = "frame";
const END_EVENT = "end";

export class PiSession {
  readonly id: SessionId;
  readonly mode: ResolvedSource["mode"];
  readonly trust: ResolvedSource["trust"];

  private readonly channel: SessionChannel;
  private readonly idleMs: number;
  private readonly onClosed?: (id: SessionId, reason: SessionEndReason) => void;

  private readonly emitter = new EventEmitter();
  private readonly pendingExtensionUI = new Map<string, RpcExtensionUIRequest>();
  private translationCtx: TranslationContext = createTranslationContext();
  private cache: CachedState | undefined;

  private _status: SessionStatus = "active";
  private idleTimer: ReturnType<typeof setTimeout> | undefined;

  private readonly unsubs: Unsubscribe[] = [];

  constructor(opts: PiSessionOptions) {
    this.id = opts.id;
    this.channel = opts.channel;
    this.mode = opts.resolved.mode;
    this.trust = opts.resolved.trust;
    this.idleMs = opts.idleMs ?? DEFAULT_IDLE_MS;
    this.onClosed = opts.onClosed;

    // EventEmitter 默认 maxListeners=10,多订阅者场景放宽。
    this.emitter.setMaxListeners(0);

    // 订阅通道三类信号(Req 1.2)。
    this.unsubs.push(
      this.channel.onEvent((event) => this.handleEvent(event)),
      this.channel.onExtensionUIRequest((req) =>
        this.handleExtensionUIRequest(req),
      ),
      this.channel.onExit((info) => this.handleExit(info)),
    );

    this.touch();
  }

  get status(): SessionStatus {
    return this._status;
  }

  describe(): SessionDescriptor {
    return {
      id: this.id,
      mode: this.mode,
      trust: this.trust,
      status: this._status,
    };
  }

  // ───────────────────────── 广播订阅(Req 3.x) ─────────────────────────

  subscribe(
    onFrame: FrameListener,
    onEnd?: SessionEndListener,
  ): SubscribeHandle {
    if (this._status !== "active") {
      throw new SessionStoppedError(this.id);
    }
    this.touch();
    const frameWrap = (frame: SseFrame): void => {
      // 隔离单个订阅者回调异常,不阻断其余分发(Req 3.5)。
      try {
        onFrame(frame);
      } catch {
        // 吞掉:订阅者自身错误不影响会话与其他订阅者。
      }
    };
    const endWrap = (reason: SessionEndReason): void => {
      try {
        onEnd?.(reason);
      } catch {
        // 同上。
      }
    };
    this.emitter.on(FRAME_EVENT, frameWrap);
    this.emitter.on(END_EVENT, endWrap);
    return {
      unsubscribe: () => {
        this.emitter.off(FRAME_EVENT, frameWrap);
        this.emitter.off(END_EVENT, endWrap);
      },
    };
  }

  /** 当前订阅者数量(测试/诊断用)。 */
  subscriberCount(): number {
    return this.emitter.listenerCount(FRAME_EVENT);
  }

  private handleEvent(event: AgentEvent): void {
    if (this._status !== "active") return;
    this.touch();
    // 纯函数翻译:推进上下文并广播产出帧(同序,Req 3.1 / 3.3)。
    const { frames, ctx } = translateEvent(event, this.translationCtx);
    this.translationCtx = ctx;
    for (const frame of frames) {
      this.emitter.emit(FRAME_EVENT, frame);
    }
  }

  // ───────────────────────── 命令转发(Req 2.x） ─────────────────────────

  private assertActive(): void {
    if (this._status !== "active") {
      throw new SessionStoppedError(this.id);
    }
  }

  /** 包裹一次命令转发:停止校验 + 活动重置(纯转发,不改写语义)。 */
  private forward<T extends RpcResponse>(
    call: () => Promise<T>,
  ): Promise<T> {
    try {
      this.assertActive();
    } catch (err) {
      return Promise.reject(err);
    }
    this.touch();
    return call();
  }

  prompt(
    message: string,
    options?: {
      images?: readonly ImageContent[];
      streamingBehavior?: "steer" | "followUp";
    },
  ): Promise<RpcResponse> {
    return this.forward(() => this.channel.prompt(message, options));
  }

  steer(
    message: string,
    options?: { images?: readonly ImageContent[] },
  ): Promise<RpcResponse> {
    return this.forward(() => this.channel.steer(message, options));
  }

  followUp(
    message: string,
    options?: { images?: readonly ImageContent[] },
  ): Promise<RpcResponse> {
    return this.forward(() => this.channel.followUp(message, options));
  }

  abort(): Promise<RpcResponse> {
    return this.forward(() => this.channel.abort());
  }

  setModel(provider: string, modelId: string): Promise<RpcResponse> {
    return this.forward(async () => {
      const res = await this.channel.setModel(provider, modelId);
      this.refreshCacheFromResponse(res);
      return res;
    });
  }

  cycleModel(): Promise<RpcResponse> {
    return this.forward(async () => {
      const res = await this.channel.cycleModel();
      this.refreshCacheFromResponse(res);
      return res;
    });
  }

  getAvailableModels(): Promise<RpcResponse> {
    return this.forward(() => this.channel.getAvailableModels());
  }

  setThinkingLevel(level: ThinkingLevel): Promise<RpcResponse> {
    return this.forward(async () => {
      const res = await this.channel.setThinkingLevel(level);
      // set_thinking_level 无 data;以入参更新缓存的 thinkingLevel。
      this.cache = {
        ...(this.cache ?? {}),
        thinkingLevel: level,
        updatedAt: Date.now(),
      };
      return res;
    });
  }

  getState(): Promise<RpcResponse> {
    return this.forward(async () => {
      const res = await this.channel.getState();
      this.refreshCacheFromResponse(res);
      return res;
    });
  }

  getMessages(): Promise<RpcResponse> {
    return this.forward(() => this.channel.getMessages());
  }

  getSessionStats(): Promise<RpcResponse> {
    return this.forward(async () => {
      const res = await this.channel.getSessionStats();
      this.refreshCacheFromResponse(res);
      return res;
    });
  }

  getCommands(): Promise<RpcResponse> {
    return this.forward(() => this.channel.getCommands());
  }

  /** 经 `fork` 命令在给定 entry 处创建同级版本(纯转发,Req 8.2)。 */
  fork(entryId: string): Promise<RpcResponse> {
    return this.forward(() => this.channel.fork(entryId));
  }

  /** 经 `get_fork_messages` 命令加载分支消息序列(纯转发,Req 8.3)。 */
  getForkMessages(): Promise<RpcResponse> {
    return this.forward(() => this.channel.getForkMessages());
  }

  // ───────────────────────── 最近状态缓存(Req 6.x） ─────────────────────────

  /** 由状态类响应刷新缓存(Req 2.3 / 6.1)。仅在成功且带 data 时刷新对应字段。 */
  private refreshCacheFromResponse(res: RpcResponse): void {
    if (!res.success || !("data" in res)) return;
    const data = (res as { data: unknown }).data;
    const now = Date.now();
    switch (res.command) {
      case "get_state":
        this.cache = { ...(this.cache ?? {}), state: data, updatedAt: now };
        break;
      case "get_session_stats":
        this.cache = { ...(this.cache ?? {}), stats: data, updatedAt: now };
        break;
      case "set_model":
        this.cache = { ...(this.cache ?? {}), model: data, updatedAt: now };
        break;
      case "cycle_model":
        this.cache = { ...(this.cache ?? {}), model: data, updatedAt: now };
        break;
      default:
        break;
    }
  }

  /** 读取最近状态缓存(不发命令);无任何观察时返回 undefined(Req 6.2 / 6.3)。 */
  getCachedState(): CachedState | undefined {
    return this.cache;
  }

  // ───────────────────────── extension UI 往返(Req 5.x） ─────────────────────────

  private handleExtensionUIRequest(req: RpcExtensionUIRequest): void {
    if (this._status !== "active") return;
    this.touch();
    // 登记挂起表(Req 5.1)。
    this.pendingExtensionUI.set(req.id, req);
    // 经事件广播以旁路 control 帧通知订阅者(Req 5.1)。
    const { frames, ctx } = translateEvent(req, this.translationCtx);
    this.translationCtx = ctx;
    for (const frame of frames) {
      this.emitter.emit(FRAME_EVENT, frame);
    }
  }

  /** 为某挂起的扩展 UI 请求提交回复:经通道写回并移除(Req 5.2 / 5.3）。 */
  respondExtensionUI(id: string, response: RpcExtensionUIResponse): void {
    this.assertActive();
    if (!this.pendingExtensionUI.has(id)) {
      throw new UnknownExtensionUIError(id);
    }
    this.touch();
    this.pendingExtensionUI.delete(id);
    this.channel.respondExtensionUI(id, response);
  }

  /** 当前挂起的扩展 UI 请求 id 列表。 */
  listPendingExtensionUI(): readonly string[] {
    return [...this.pendingExtensionUI.keys()];
  }

  // ───────────────────────── 生命周期(Req 7.x） ─────────────────────────

  /** 活动重置 idle 计时(Req 7.2)。 */
  private touch(): void {
    if (this._status !== "active") return;
    if (this.idleTimer !== undefined) {
      clearTimeout(this.idleTimer);
    }
    if (this.idleMs <= 0 || !Number.isFinite(this.idleMs)) {
      this.idleTimer = undefined;
      return;
    }
    const timer = setTimeout(() => {
      void this.stop("idle");
    }, this.idleMs);
    if (typeof timer.unref === "function") timer.unref();
    this.idleTimer = timer;
  }

  /** 子进程退出/崩溃:走统一清理,以 crashed reason 广播(Req 7.5)。 */
  private handleExit(info: ExitInfo): void {
    if (this._status === "stopped" || this._status === "stopping") return;
    const reason: SessionEndReason =
      info.code === 0 ? "stopped" : "crashed";
    if (reason === "crashed") {
      // 崩溃以可见错误帧告知订阅者(不外泄敏感 env,仅退出码/信号摘要)。
      try {
        const summary =
          info.signal !== null
            ? `signal ${info.signal}`
            : `exit code ${info.code ?? "null"}`;
        this.emitter.emit(FRAME_EVENT, this.errorFrame(`agent crashed: ${summary}`));
      } catch {
        // 忽略广播错误。
      }
    }
    void this.cleanup(reason, /* closeChannel */ false);
  }

  private errorFrame(message: string): SseFrame {
    return makeControlFrame({ control: "error", message });
  }

  /** 显式停止会话(幂等,Req 7.3 / 7.4)。 */
  stop(reason: SessionEndReason = "stopped"): Promise<void> {
    return this.cleanup(reason, /* closeChannel */ true);
  }

  /**
   * 统一清理原语:供 stop / idle / crash / 优雅停机复用。状态机去重保证幂等
   * (Req 7.4):仅 active 时执行清理,stopping/stopped 直接返回已决议 Promise。
   */
  private cleanup(reason: SessionEndReason, closeChannel: boolean): Promise<void> {
    if (this._status !== "active") {
      return this.closingPromise ?? Promise.resolve();
    }
    this._status = "stopping";

    this.closingPromise = (async () => {
      // 1) 清 idle 计时(Stopping 首步)。
      if (this.idleTimer !== undefined) {
        clearTimeout(this.idleTimer);
        this.idleTimer = undefined;
      }
      // 2) 退订通道信号。
      for (const u of this.unsubs) {
        try {
          u();
        } catch {
          // 忽略。
        }
      }
      this.unsubs.length = 0;
      // 3) 关通道(crash 路径通道已退出,跳过关闭以免重复)。
      if (closeChannel) {
        try {
          await this.channel.close();
        } catch {
          // 忽略关闭错误,不阻断清理。
        }
      }
      // 4) 清挂起表与缓存(Req 5.4)。
      this.pendingExtensionUI.clear();
      this.cache = undefined;
      // 5) 向订阅者广播会话结束(Req 7.3 / 7.5)。
      this.emitter.emit(END_EVENT, reason);
      // 6) 置 stopped 并移除订阅者监听。
      this._status = "stopped";
      this.emitter.removeAllListeners();
      // 7) 去注册接缝:回调一次 onClosed,由 manager 执行 store.delete(Req 7.5 / 9.4)。
      try {
        this.onClosed?.(this.id, reason);
      } catch {
        // 忽略 manager 回调错误,不阻断会话收尾。
      }
    })();

    return this.closingPromise;
  }

  private closingPromise: Promise<void> | undefined;
}
