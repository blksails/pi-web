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
  LogEntry,
  LoggingConfig,
  LogLevel,
  RpcExtensionUIRequest,
  RpcExtensionUIResponse,
  RpcResponse,
  SessionLifecycleState,
  SseFrame,
  ThinkingLevel,
  UiRpcRequest,
  UiRpcResponse,
} from "@blksails/pi-web-protocol";
import { makeControlFrame, UiRpcResponseSchema } from "@blksails/pi-web-protocol";
import { isLevelEnabled, isNamespaceEnabled } from "@blksails/pi-web-logger";
import type { ResolvedSource } from "../agent-source/index.js";
import type { ExitInfo, Unsubscribe } from "../rpc-channel/index.js";
import { LogRingBuffer } from "../logging/log-ring-buffer.js";
import { StderrLogParser } from "../logging/stderr-log-parser.js";
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

/**
 * 安全默认日志门控配置：全开（enabled:true / debug / 全命名空间）。
 * 用于：(a) 无 loggingConfigProvider 注入时；(b) 配置加载失败时的 fallback。
 * 保证向后兼容（Req 6.4/6.5/6.6 / task 4.4）。
 */
const GATE_DEFAULT: LoggingConfig = {
  enabled: true,
  level: "debug",
  namespaces: undefined,
  panelDefaultLevel: "info",
};

/** 就绪探针默认超时(毫秒):超时未响应即判定 error{probe-timeout}(Req 4.1)。 */
const DEFAULT_READINESS_PROBE_TIMEOUT_MS = 30_000;

/**
 * restart 后重发探针前的 settle 延迟(毫秒):requestRestart 触发的子进程重生是异步的,
 * 此间 stdin 仍指向将死的旧进程;延迟后再发 getCommands 使其落到重生后的子进程
 * (避免写入旧 stdin 而永挂)。探针自身超时仍兜底真正失败的 restart。
 */
const RESTART_PROBE_SETTLE_MS = 500;

export class PiSession {
  readonly id: SessionId;
  readonly mode: ResolvedSource["mode"];
  readonly trust: ResolvedSource["trust"];
  /** 会话工作目录(与 spawnSpec.cwd 一致),供补全 file provider 等限定枚举范围。 */
  readonly cwd: ResolvedSource["cwd"];

  private readonly channel: SessionChannel;
  private readonly idleMs: number;
  private readonly onClosed?: (id: SessionId, reason: SessionEndReason) => void;

  private readonly emitter = new EventEmitter();
  private readonly pendingExtensionUI = new Map<string, RpcExtensionUIRequest>();
  private translationCtx: TranslationContext = createTranslationContext();
  private cache: CachedState | undefined;

  private _status: SessionStatus = "active";
  private idleTimer: ReturnType<typeof setTimeout> | undefined;

  /**
   * 会话**业务就绪态**(spec session-readiness-handshake),与通道层活动态 `_status` 正交。
   * 仅当 `readinessHandshake` 开启时驱动/广播;关闭时恒为 `initializing` 且不发任何帧。
   */
  private _lifecycle: SessionLifecycleState = "initializing";
  private _lifecycleDetail: string | undefined;
  private _lifecycleCode: string | undefined;
  private readonly readinessHandshake: boolean;
  private readonly readinessProbeTimeoutMs: number;
  private probeTimer: ReturnType<typeof setTimeout> | undefined;
  private restartSettleTimer: ReturnType<typeof setTimeout> | undefined;

  private readonly unsubs: Unsubscribe[] = [];

  /** 每会话 stderr 日志解析管道（Req 2.5 / 3.1）。 */
  private readonly logParser = new StderrLogParser();
  private readonly logBuffer = new LogRingBuffer();

  /**
   * 服务端权威日志门控（Req 6.4/6.5/6.6 / task 4.4）。
   * - `gateConfig` 在 loggingConfigProvider 解析前为 `undefined`（表示"待加载"）。
   * - 首条 stderr chunk 到来时触发异步加载；期间 chunk 入 `pendingStderr` 缓冲队列。
   * - 配置加载完成后回放缓冲队列（按门控过滤），之后 chunk 直接过门控。
   * - 无 provider 时（默认/生产默认）同步设为 GATE_DEFAULT（全开，向后兼容）。
   */
  private gateConfig: LoggingConfig | undefined;
  private gateLoading = false;
  private readonly pendingStderr: string[] = [];
  private readonly loggingConfigProvider: (() => Promise<LoggingConfig>) | undefined;

  constructor(opts: PiSessionOptions) {
    this.id = opts.id;
    this.channel = opts.channel;
    this.mode = opts.resolved.mode;
    this.trust = opts.resolved.trust;
    this.cwd = opts.resolved.cwd;
    this.idleMs = opts.idleMs ?? DEFAULT_IDLE_MS;
    this.onClosed = opts.onClosed;
    this.loggingConfigProvider = opts.loggingConfigProvider;
    this.readinessHandshake = opts.readinessHandshake ?? false;
    this.readinessProbeTimeoutMs =
      opts.readinessProbeTimeoutMs ?? DEFAULT_READINESS_PROBE_TIMEOUT_MS;

    // 无 provider 时直接使用安全默认（全开，无 async 延迟）。
    if (!this.loggingConfigProvider) {
      this.gateConfig = GATE_DEFAULT;
    }

    // EventEmitter 默认 maxListeners=10,多订阅者场景放宽。
    this.emitter.setMaxListeners(0);

    // 订阅通道三类信号(Req 1.2)。
    this.unsubs.push(
      this.channel.onEvent((event) => this.handleEvent(event)),
      this.channel.onExtensionUIRequest((req) =>
        this.handleExtensionUIRequest(req),
      ),
      this.channel.onExit((info) => this.handleExit(info)),
      // 原始行:识别 agent 侧 ui-rpc 响应约定(Tier3,Req 4.1)。
      this.channel.onLine((line) => this.handleRawLine(line)),
      // stderr 日志管道:sentinel 行→解析→ring buffer→control:"logs" 帧(Req 3.1)。
      this.channel.onStderr((chunk) => this.handleStderr(chunk)),
    );

    this.touch();

    // 就绪握手(spec session-readiness-handshake):开启时发只读探针判定真实就绪(Req 1.3)。
    // 异步、不阻塞构造;关闭时完全 no-op(既有行为不变)。
    if (this.readinessHandshake) {
      this.startReadinessProbe();
      // 重生完成信号(若通道支持):在**真实重生时机**复位 initializing 并重探针(Req 5.1),
      // 覆盖热重载与显式 restart 两条路径,且探针确定落到重生后的新子进程(根除定时器猜测的
      // 假就绪窗口)。通道不支持 onRestart 时退回 restartRunner 内的 best-effort settle 定时器。
      if (typeof this.channel.onRestart === "function") {
        this.unsubs.push(
          this.channel.onRestart(() => this.handleRunnerRestarted()),
        );
      }
    }
  }

  /** 重生完成:复位 initializing 并以新子进程重新探针(由通道 onRestart 在真实重生后触发)。 */
  private handleRunnerRestarted(): void {
    if (!this.readinessHandshake || this._status !== "active") return;
    if (this.probeTimer !== undefined) {
      clearTimeout(this.probeTimer);
      this.probeTimer = undefined;
    }
    if (this.restartSettleTimer !== undefined) {
      clearTimeout(this.restartSettleTimer);
      this.restartSettleTimer = undefined;
    }
    this.setLifecycle("initializing", undefined, undefined, { forceReset: true });
    this.startReadinessProbe();
  }

  get status(): SessionStatus {
    return this._status;
  }

  /** 当前业务就绪态(spec session-readiness-handshake);未开启握手时恒为 `initializing`。 */
  get lifecycle(): SessionLifecycleState {
    return this._lifecycle;
  }

  describe(): SessionDescriptor {
    return {
      id: this.id,
      mode: this.mode,
      trust: this.trust,
      status: this._status,
    };
  }

  // ──────────────── 就绪握手 / 生命周期(spec session-readiness-handshake) ────────────────

  /** 当前生命周期态的 `control: session-status` 帧(供广播与订阅回放复用)。 */
  private lifecycleFrame(): SseFrame {
    return makeControlFrame({
      control: "session-status",
      state: this._lifecycle,
      ...(this._lifecycleDetail !== undefined
        ? { detail: this._lifecycleDetail }
        : {}),
      ...(this._lifecycleCode !== undefined ? { code: this._lifecycleCode } : {}),
    });
  }

  /**
   * 生命周期态变更的**唯一入口**:守卫单向迁移 + 广播一帧(Req 1.5 / 2.1 / 5.3)。
   * 单向规则:相同态 → no-op;已处终态(error/ended)非 restart 复位 → 拒绝;
   * ready → initializing 非 restart 复位 → 拒绝。`forceReset` 仅由 restart 重握手使用。
   * 未开启握手时整体 no-op(不发任何生命周期帧,既有行为不变)。
   */
  private setLifecycle(
    state: SessionLifecycleState,
    code?: string,
    detail?: string,
    opts?: { forceReset?: boolean },
  ): void {
    if (!this.readinessHandshake) return;
    if (this._lifecycle === state) return;
    const force = opts?.forceReset === true;
    const isTerminal = this._lifecycle === "error" || this._lifecycle === "ended";
    if (isTerminal && !force) return;
    if (this._lifecycle === "ready" && state === "initializing" && !force) return;
    this._lifecycle = state;
    this._lifecycleCode = code;
    this._lifecycleDetail = detail;
    this.emitter.emit(FRAME_EVENT, this.lifecycleFrame());
  }

  /**
   * 发起只读就绪探针(Req 1.3 / 1.4 / 4.1):以 `getCommands` 的**首条响应**为真实就绪锚点
   * (有响应即证明 agent 读循环已起、session 已绑定);超时未响应 → error{probe-timeout};
   * 通道拒绝 → error{probe-failed}。仅在 active 且 initializing 时生效;先后到达只认首个。
   */
  private startReadinessProbe(): void {
    if (this._status !== "active" || this._lifecycle !== "initializing") return;
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      this.probeTimer = undefined;
      this.setLifecycle("error", "probe-timeout", "readiness probe timed out");
    }, this.readinessProbeTimeoutMs);
    if (typeof timer.unref === "function") timer.unref();
    this.probeTimer = timer;

    let probe: Promise<RpcResponse>;
    try {
      probe = this.channel.getCommands();
    } catch (err) {
      // 同步抛出(极少):归一为探针失败。
      settled = true;
      clearTimeout(timer);
      this.probeTimer = undefined;
      this.setLifecycle("error", "probe-failed", `readiness probe threw: ${String(err)}`);
      return;
    }
    void probe.then(
      () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        this.probeTimer = undefined;
        // 有响应(含 error 响应)即就绪:读循环已处理命令并回包(Req 1.4)。
        this.setLifecycle("ready");
      },
      () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        this.probeTimer = undefined;
        this.setLifecycle("error", "probe-failed", "readiness probe rejected");
      },
    );
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

    // 回填：若 ring buffer 非空，立即向该新订阅者发送一帧 control:"logs"，
    // 内容为当前缓冲的全部条目（Req 4.5/5.2/3.1，task 7.3）。
    // 只向刚订阅的 onFrame 发送，不广播（避免重复/打扰既有订阅者）。
    const buffered = this.logBuffer.getLogs({});
    if (buffered.length > 0) {
      frameWrap(makeControlFrame({ control: "logs", entries: buffered }));
    }

    // 回放当前生命周期态(粘性,spec session-readiness-handshake,Req 2.2/2.4):仅向**刚订阅**
    // 的 onFrame 发一帧 session-status,使迟到订阅(含 ready 先于订阅)不丢就绪通告。
    // 与日志回填同范式;未开启握手时不发(既有行为不变)。
    if (this.readinessHandshake) {
      frameWrap(this.lifecycleFrame());
    }

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

  /**
   * 原始行处理(Tier3 ui-rpc 下行约定):agent 以 `{"type":"ui_rpc_response","response":{...}}`
   * 应答 ui-rpc;识别后翻译为 `control: ui-rpc` 帧广播(按 correlationId 由客户端配对)。
   * 其余行已由 onEvent/onExtensionUIRequest 路径处理,这里忽略。
   */
  private handleRawLine(line: string): void {
    if (this._status !== "active") return;
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      return; // 非 JSON 行忽略
    }
    if (
      parsed === null ||
      typeof parsed !== "object" ||
      (parsed as { type?: unknown }).type !== "ui_rpc_response"
    ) {
      return;
    }
    const res = UiRpcResponseSchema.safeParse(
      (parsed as { response?: unknown }).response,
    );
    if (!res.success) return; // 非法响应丢弃(Req 4.5)
    this.emitter.emit(
      FRAME_EVENT,
      makeControlFrame({ control: "ui-rpc", response: res.data }),
    );
  }

  /**
   * stderr 日志管道(Req 2.5 / 3.1):喂 chunk 给 parser → 得到 LogEntry[] →
   * 每条存入 ring buffer(分配 id)→ 合并成一帧经帧 emitter 广播。
   * 非 sentinel 的非空文本行由 parser 包装为 proc:stderr 原始日志(Req 4.3)；空白行丢弃。
   *
   * 服务端权威门控（Req 6.4/6.5/6.6 / task 4.4）：
   * 若配置未加载，将 chunk 入队；配置加载完成后回放队列并按门控过滤。
   * 若配置已加载，直接按门控过滤后入 buffer/产帧。
   */
  private handleStderr(chunk: string): void {
    if (this._status !== "active") return;

    // 门控配置未就绪：缓冲 chunk，按需触发一次异步加载。
    if (this.gateConfig === undefined) {
      this.pendingStderr.push(chunk);
      if (!this.gateLoading) {
        this.gateLoading = true;
        const provider = this.loggingConfigProvider!;
        provider()
          .catch(() => GATE_DEFAULT)
          .then((config) => {
            this.gateConfig = config;
            // 回放缓冲队列（按门控过滤）。
            const pending = this.pendingStderr.splice(0);
            for (const c of pending) {
              this.processStderrChunk(c);
            }
          })
          .catch(() => {
            // 极端情况（processStderrChunk 内部抛出），吞错不崩。
          });
      }
      return;
    }

    // 门控配置已就绪：直接过滤处理。
    this.processStderrChunk(chunk);
  }

  /**
   * 实际处理 stderr chunk：解析 → 按 gateConfig 过滤 → 入 buffer → 产帧。
   * 调用前必须确保 `gateConfig` 已就绪（非 undefined）。
   */
  private processStderrChunk(chunk: string): void {
    if (this._status !== "active") return;
    const gate = this.gateConfig!;
    const raw = this.logParser.ingestChunk(chunk);
    if (raw.length === 0) return;

    const entries: (LogEntry & { id: string })[] = [];
    for (const entry of raw) {
      // 门控过滤（Req 6.4 / 6.5 / 6.6）：
      //  1. 全局开关关闭 → 全丢。
      //  2. 条目 level 低于配置 level → 丢。
      //  3. 命名空间显式关闭 → 丢。
      if (!gate.enabled) continue;
      if (!isLevelEnabled(entry.level, gate.level)) continue;
      if (!isNamespaceEnabled(entry.ns, gate.namespaces)) continue;
      entries.push(this.logBuffer.ingest(entry));
    }

    if (entries.length === 0) return;
    this.emitter.emit(
      FRAME_EVENT,
      makeControlFrame({ control: "logs", entries }),
    );
  }

  /**
   * 查询会话日志 ring buffer（Req 4.2 / 4.3）。
   * 供 REST 路由调用；不发 RPC 命令。
   */
  getLogs(query: {
    level?: LogLevel;
    limit?: number;
    since?: number;
  }): (LogEntry & { id: string })[] {
    return this.logBuffer.getLogs(query);
  }

  /**
   * Tier3 UI↔agent RPC 上行(Req 4.1):把请求经原始行约定发给 agent
   * (`{"type":"ui_rpc","request":{...}}`)。响应经 agent 的 `ui_rpc_response` 行回流,
   * 由 handleRawLine 翻译为 control 帧下行(本方法仅发送,不等待)。
   */
  uiRpc(request: UiRpcRequest): void {
    this.assertActive();
    this.touch();
    this.channel.send(JSON.stringify({ type: "ui_rpc", request }));
  }

  /**
   * 统一命令层(unified-command-result-layer)host 侧回流:服务端**主动合成** ui-rpc 响应帧,
   * 经 `control:"ui-rpc"` 广播(与 handleRawLine 的 agent 回流同形,按 correlationId 客户端配对)。
   * 用于 host 命令在服务端执行后回流结果,**不经 agent**。
   */
  emitUiRpcResponse(response: UiRpcResponse): void {
    this.assertActive();
    this.touch();
    this.emitter.emit(
      FRAME_EVENT,
      makeControlFrame({ control: "ui-rpc", response }),
    );
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

  /**
   * 重启底层 runner 子进程(以同一会话 id/env 重 spawn、重解析资源),使安装/卸载的
   * 扩展对运行中的会话生效(builtin-plugin-command 任务 2.1)。底层 channel 不支持重启时抛错,
   * 由调用方(SessionReloader)按未配置处理。
   */
  restartRunner(): Promise<void> {
    if (typeof this.channel.requestRestart !== "function") {
      return Promise.reject(
        new Error("当前会话通道不支持 runner 重启(requestRestart 未实现)"),
      );
    }
    this.channel.requestRestart();
    // 就绪握手:重启即重握手(Req 5.1)。立即复位 initializing 并广播 → 前端在重新就绪前**即刻**重新门控
    //(不等真实重生,关闭过早发送窗口)。重新探针由通道 onRestart 在**真实重生时机**驱动
    //(见 handleRunnerRestarted,确定落到新子进程);仅当通道不支持 onRestart 时,退回 settle 定时器
    // best-effort 重探针(避免探针写入将死的旧 stdin,见 RESTART_PROBE_SETTLE_MS)。
    if (this.readinessHandshake) {
      if (this.probeTimer !== undefined) {
        clearTimeout(this.probeTimer);
        this.probeTimer = undefined;
      }
      this.setLifecycle("initializing", undefined, undefined, { forceReset: true });
      if (typeof this.channel.onRestart !== "function") {
        if (this.restartSettleTimer !== undefined) {
          clearTimeout(this.restartSettleTimer);
        }
        const t = setTimeout(() => {
          this.restartSettleTimer = undefined;
          this.startReadinessProbe();
        }, RESTART_PROBE_SETTLE_MS);
        if (typeof t.unref === "function") t.unref();
        this.restartSettleTimer = t;
      }
    }
    return Promise.resolve();
  }

  /**
   * 清空当前对话上下文(统一命令层 `/clear` 的 agent 侧):经 pi RPC `new_session` 续用同一
   * 通道开新上下文。底层通道不支持时为 no-op(best-effort:UI 视图清空仍由前端 effect 完成)。
   */
  async clearContext(): Promise<void> {
    this.assertActive();
    this.touch();
    if (typeof this.channel.newSession === "function") {
      await this.channel.newSession();
    }
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
    // 就绪握手:子进程就绪前退出 → error{exit-before-ready},不停留 initializing(Req 4.2);
    // 就绪后退出由 cleanup 统一置 ended。
    if (this._lifecycle === "initializing") {
      this.setLifecycle(
        "error",
        "exit-before-ready",
        "agent exited before readiness",
      );
    }
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
      // 0) 生命周期终态(spec session-readiness-handshake,Req 5.2):置 ended 并广播
      //    (终态守卫:error/exit-before-ready 已是终态则保持不变;须在 removeAllListeners 前)。
      this.setLifecycle("ended");
      // 1) 清 idle 计时(Stopping 首步)+ 就绪握手计时器。
      if (this.idleTimer !== undefined) {
        clearTimeout(this.idleTimer);
        this.idleTimer = undefined;
      }
      if (this.probeTimer !== undefined) {
        clearTimeout(this.probeTimer);
        this.probeTimer = undefined;
      }
      if (this.restartSettleTimer !== undefined) {
        clearTimeout(this.restartSettleTimer);
        this.restartSettleTimer = undefined;
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
