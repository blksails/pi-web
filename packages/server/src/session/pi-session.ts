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
  SessionSnapshot,
  SlashCompletionDecl,
  SseFrame,
  ThinkingLevel,
  UiRpcRequest,
  UiRpcResponse,
} from "@blksails/pi-web-protocol";
import type { ClearQueueResponse } from "@blksails/pi-web-protocol";
import {
  makeControlFrame,
  makeUiMessageChunkFrame,
  SlashCompletionsFrameSchema,
  UiRpcResponseSchema,
  StateDownLineSchema,
  ClearQueueResultLineSchema,
} from "@blksails/pi-web-protocol";
import { randomUUID } from "node:crypto";
import { createLogger, isLevelEnabled, isNamespaceEnabled } from "@blksails/pi-web-logger";

// 命名空间 session:tool —— 主进程侧工具调用边界:server 收到 runner 的 tool_execution_* 事件
// 的时刻(对照 runner 内部 toolkit:* 计时,定位时间花在哪一段)。主进程日志落 server stderr,
// 受 configureLogger(主进程门控)约束,默认关。
const toolLog = createLogger({ namespace: "session:tool" });

// 命名空间 session:lifecycle —— 会话生命周期里程碑:就绪握手/生命周期跃迁(ready/ended/error/
// initializing)、退出与崩溃语义、cleanup 清理、turn 边界(agent_start/agent_end)。主进程日志落
// server stderr,受 configureLogger(主进程门控)约束,默认关。
const lifecycleLog = createLogger({ namespace: "session:lifecycle" });
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
import { INITIAL_SNAPSHOT, reduceSnapshot } from "./reduce-snapshot.js";
import { StickyFrameRegistry } from "./sticky-registry.js";
import {
  createTranslationContext,
  type TranslationContext,
} from "./translate/translation-context.js";

const FRAME_EVENT = "frame";

/**
 * R11：斜杠命令 prompt 到 `agent_start` 的等待窗口（毫秒）。窗口内无 agent_start → 视为纯命令，
 * 合成 finish 收尾。需足够覆盖"命令处理器运行 + 触发 turn 的 followUp 排队到 agent_start"，
 * 又不至于让纯命令输入卡太久（纯命令此窗口后才解除 streaming）。
 */
const COMMAND_TURN_WINDOW_MS = 1500;
/** message-queue-ui「取回」clearQueue 请求→结果行的关联超时(子进程无回写即 reject)。 */
const CLEAR_QUEUE_TIMEOUT_MS = 5000;
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
  /**
   * message-queue-ui「取回」在途请求(clearQueue):按关联 id 配对子进程回写的
   * `piweb_clear_queue_result` 行。隔离于 PiRpcProcess 的 RPC pending map(pi 自身对请求行回的
   * Unknown-command 不在此表 → 丢弃)。超时或会话收尾时 reject 以免悬挂。
   */
  private readonly pendingClearQueue = new Map<
    string,
    { resolve: (r: ClearQueueResponse) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> }
  >();
  private translationCtx: TranslationContext = createTranslationContext();
  private cache: CachedState | undefined;
  /**
   * agent 装配期经 `slash_completions` 帧声明的静态 slash 补全候选(spec
   * agent-slash-completion)。按会话缓存,供 completion provider 读取实现 per-agent gating。
   */
  private slashCompletions: readonly SlashCompletionDecl[] = [];

  /**
   * 服务端**唯一权威**会话快照(session-snapshot-authority):lifecycle/busy/turn/stats/model/title。
   * 任一字段变更经 `applySnapshot` 广播 `control: session-state` 帧;订阅时回放当前态(粘性)。
   * 与 `readinessHandshake` 解耦:busy/stats 等不依赖握手开关,恒可用。
   */
  private _snapshot: SessionSnapshot = INITIAL_SNAPSHOT;

  /**
   * 粘性帧注册表(session-snapshot-authority):承载 last-value 粘性态(session-status /
   * session-state)的最新帧,订阅时统一重放,使迟到订阅者收敛。logs 仍走 ring-buffer 单独回放。
   */
  private readonly sticky = new StickyFrameRegistry();

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
  /**
   * 权威快照机制开关(session-snapshot-authority)。默认 `false`:不广播/不回放 session-state
   * 帧,完全保留既有行为(单测/legacy 零回归)。生产 app 接线开启(见 pi-handler)。
   * 关 → 开 / 开 → 关 即一步回退(Req 8.2/8.4)。
   */
  private readonly snapshotAuthority: boolean;
  private probeTimer: ReturnType<typeof setTimeout> | undefined;
  private restartSettleTimer: ReturnType<typeof setTimeout> | undefined;
  /**
   * R11（扩展命令消息流一致性）：斜杠命令 prompt 后在窗口内观察是否有 `agent_start`（真 turn）。
   * 有 → 真 turn，照常走到真 finish；窗口内无 → 纯命令（不发任何 message 生命周期帧）→ 合成一个
   * `finish` 帧让前端 per-prompt 流干净收尾，避免 useChat 永久 streaming。**仅命令路径触发**
   * （普通消息必有 agent_start，watcher 在 start 时即取消，对普通流零影响）。
   */
  private commandTurnTimer: ReturnType<typeof setTimeout> | undefined;
  private awaitingCommandTurn = false;

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
    this.snapshotAuthority = opts.snapshotAuthority ?? false;
    this.readinessProbeTimeoutMs =
      opts.readinessProbeTimeoutMs ?? DEFAULT_READINESS_PROBE_TIMEOUT_MS;

    // 无 provider 时直接使用安全默认（全开，无 async 延迟）。
    if (!this.loggingConfigProvider) {
      this.gateConfig = GATE_DEFAULT;
    }

    // EventEmitter 默认 maxListeners=10,多订阅者场景放宽。
    this.emitter.setMaxListeners(0);

    // 粘性帧 seed:开启对应机制时登记初始 last-value,使**任何时刻**订阅都能回放当前态
    //(含变更前订阅:lifecycle=initializing / snapshot=初始 busy:false)。机制关闭则不登记 → legacy。
    if (this.readinessHandshake) {
      this.sticky.set("session-status", this.lifecycleFrame());
    }
    if (this.snapshotAuthority) {
      this.sticky.set("session-state", this.snapshotFrame());
    }

    // 冷恢复标题回填(方案A):有初始标题时 seed 一帧粘性 setTitle,使任何订阅者(含首个)回放即得
    // ambient.title。冷恢复无 agent 侧 setTitle 帧,否则顶栏无标题。仅 resume 分支传入,新建不受影响。
    if (opts.initialTitle !== undefined && opts.initialTitle.length > 0) {
      this.seedInitialTitle(opts.initialTitle);
    }

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
    const from = this._lifecycle;
    this._lifecycle = state;
    this._lifecycleCode = code;
    this._lifecycleDetail = detail;
    // 生命周期里程碑(真正跃迁才记一条,early-return 守卫已在上方拦截 no-op/终态)。
    if (state === "error") {
      lifecycleLog.error("lifecycle transition", { session: this.id, from, to: state, code, detail });
    } else if (state === "ready" || state === "ended") {
      lifecycleLog.info("lifecycle transition", { session: this.id, from, to: state, code, detail });
    } else {
      lifecycleLog.debug("lifecycle transition", { session: this.id, from, to: state, code, detail });
    }
    this.emitter.emit(FRAME_EVENT, this.lifecycleFrame());
    // 更新粘性表(订阅回放最新生命周期态)。
    this.sticky.set("session-status", this.lifecycleFrame());
    // 同步入权威快照(单一内部权威:lifecycle 既走 session-status 又入 session-state)。
    this.setSnapshot({ lifecycle: state });
  }

  // ──────────────── 权威会话快照(session-snapshot-authority) ────────────────

  /** 当前权威快照(测试/诊断用)。 */
  get snapshot(): SessionSnapshot {
    return this._snapshot;
  }

  /** 当前快照的 `control: session-state` 帧(供广播与订阅回放复用)。 */
  private snapshotFrame(): SseFrame {
    return makeControlFrame({ control: "session-state", snapshot: this._snapshot });
  }

  /**
   * 应用一份完整新快照:与现态不同则替换并广播一帧 session-state(变更才广播)。
   * 引用相同(纯归约返回原引用)或逐字段相等时为 no-op。
   */
  private applySnapshot(next: SessionSnapshot): void {
    // 逐字段相等即 no-op(Req 1.2「字段变更才广播」):避免 getStats/setModel 等重复响应
    // 产生冗余 session-state 帧 churn 前端投影。turn/stats/model 用引用比较(归约/缓存每次新对象)。
    const cur = this._snapshot;
    if (
      next === cur ||
      (next.lifecycle === cur.lifecycle &&
        next.busy === cur.busy &&
        next.turn === cur.turn &&
        next.stats === cur.stats &&
        next.model === cur.model &&
        next.title === cur.title)
    ) {
      return;
    }
    this._snapshot = next;
    // 始终维护内部权威态;仅在机制开启时广播帧 + 更新粘性表(关闭=legacy 零回归)。
    if (this.snapshotAuthority) {
      const frame = this.snapshotFrame();
      this.sticky.set("session-state", frame);
      this.emitter.emit(FRAME_EVENT, frame);
    }
  }

  /** 以局部补丁更新权威快照(合并后经 applySnapshot 广播)。 */
  private setSnapshot(patch: Partial<SessionSnapshot>): void {
    this.applySnapshot({ ...this._snapshot, ...patch });
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

    // 回放全部粘性 last-value 帧(session-status / session-state):统一经注册表向**刚订阅**
    // 的 onFrame 重放,使迟到订阅者收敛到当前态(Req 4.1/4.3)。未开启对应机制时注册表无该键
    //（不登记 → 不回放),既有行为不变。新增可重放态只需登记键,无需改此处(Req 4.2)。
    this.sticky.replayInto(frameWrap);

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
    // R11:真 turn 开始 → 取消命令-turn watcher,由真 finish 收尾(不合成,避免重复/早切)。
    if (event.type === "agent_start" && this.awaitingCommandTurn) {
      this.cancelCommandTurnWatcher();
    }
    // turn 边界(轻量字段;tool start/end 已由 toolLog 记,此处不重复)。
    if (event.type === "agent_start") {
      lifecycleLog.debug("turn start", { session: this.id });
    } else if (event.type === "agent_end") {
      lifecycleLog.debug("turn end", {
        session: this.id,
        willRetry: event.willRetry,
        messages: event.messages.length,
      });
    }
    // 权威快照归约(session-snapshot-authority):busy/turn 由轮次边界派生,变更才广播。
    // **必须先于** translate 帧广播:agent_end 翻译出的 finish 帧触发前端关流;若 busy=false 的
    // session-state 帧排在 finish 之后,会在该 per-prompt 流被丢弃 → 前端 busy 永久卡 true
    //(browser e2e 实测捕获)。先发快照即规避。busy=true 先于 start 帧亦语义正确(轮次已开始)。
    this.applySnapshot(reduceSnapshot(this._snapshot, event, Date.now()));
    // 工具调用边界日志(server 侧,与 runner 内部计时对照)。
    this.logToolEvent(event);
    // 纯函数翻译:推进上下文并广播产出帧(同序,Req 3.1 / 3.3)。
    const { frames, ctx } = translateEvent(event, this.translationCtx);
    this.translationCtx = ctx;
    for (const frame of frames) {
      // message-queue-ui:把 control:"queue" 登记为粘性帧(与 session-state 对称),使重连/迟到订阅者
      // 回放即得当前排队快照——否则忙时重连后 busy 回放为 true 但 queue 空,取回回环静默不可用。
      if (frame.kind === "control" && frame.payload.control === "queue") {
        this.sticky.set("queue", frame);
      }
      this.emitter.emit(FRAME_EVENT, frame);
    }
  }

  /**
   * 工具调用边界日志:server 从 RPC 流收到 runner 的 tool_execution 事件即记一笔(start/end)。
   * 与 runner 内部 toolkit:* 计时配合,可定位时间花在执行内部还是 RPC/翻译往返。仅 tool 事件,
   * 其余事件(message_update 等)不记,避免噪声。
   */
  private logToolEvent(event: AgentEvent): void {
    switch (event.type) {
      case "tool_execution_start":
        toolLog.info("tool start", {
          session: this.id,
          toolCallId: event.toolCallId,
          tool: event.toolName,
        });
        break;
      case "tool_execution_end":
        toolLog.info("tool end", {
          session: this.id,
          toolCallId: event.toolCallId,
          isError: event.isError === true,
        });
        break;
      default:
        break;
    }
  }

  /**
   * 原始行处理(Tier3 ui-rpc 下行约定):agent 以 `{"type":"ui_rpc_response","response":{...}}`
   * 应答 ui-rpc;识别后翻译为 `control: ui-rpc` 帧广播(按 correlationId 由客户端配对)。
   * 其余行已由 onEvent/onExtensionUIRequest 路径处理,这里忽略。
   */
  private handleRawLine(line: string): void {
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      return; // 非 JSON 行忽略
    }
    if (parsed === null || typeof parsed !== "object") return;
    const type = (parsed as { type?: unknown }).type;
    // 状态注入桥(state-injection-bridge):子进程上报的权威态变更 → control:"state" 帧。
    if (type === "piweb_state") {
      const state = StateDownLineSchema.safeParse(parsed);
      if (!state.success) return; // 畸形行丢弃,不广播
      this.emitter.emit(
        FRAME_EVENT,
        makeControlFrame({
          control: "state",
          key: state.data.key,
          value: state.data.value,
          rev: state.data.rev,
          ...(state.data.deleted ? { deleted: true } : {}),
        }),
      );
      return;
    }

    // message-queue-ui「取回」:子进程回写的 clearQueue 结果行 → 按 id 配对 pending 请求 resolve。
    // 置于 active gate 之前:结果关联在途请求,晚到亦应解析(超时已删除则安全丢弃)。
    if (type === "piweb_clear_queue_result") {
      const parsedRes = ClearQueueResultLineSchema.safeParse(parsed);
      if (!parsedRes.success) return; // 畸形结果行丢弃
      const pending = this.pendingClearQueue.get(parsedRes.data.id);
      if (pending === undefined) return; // 未知/已超时 id → 丢弃
      this.pendingClearQueue.delete(parsedRes.data.id);
      clearTimeout(pending.timer);
      pending.resolve({
        steering: parsedRes.data.steering,
        followUp: parsedRes.data.followUp,
      });
      return;
    }

    // agent-slash-completion:装配期 `slash_completions` 帧(早于就绪/无 active 约束)。
    // 置于 active gate 之前识别并按会话缓存,避免被早期 gate 丢弃。
    if (type === "slash_completions") {
      const sc = SlashCompletionsFrameSchema.safeParse(parsed);
      if (sc.success) this.slashCompletions = sc.data.items;
      return;
    }

    if (this._status !== "active") return;
    // Tier3 ui-rpc 下行约定:`{"type":"ui_rpc_response","response":{...}}`。
    if (type !== "ui_rpc_response") return;
    const res = UiRpcResponseSchema.safeParse(
      (parsed as { response?: unknown }).response,
    );
    if (!res.success) return; // 非法响应丢弃(Req 4.5)
    this.emitter.emit(
      FRAME_EVENT,
      makeControlFrame({ control: "ui-rpc", response: res.data }),
    );
  }

  /** agent 装配期声明的静态 slash 补全候选(spec agent-slash-completion)。 */
  getSlashCompletions(): readonly SlashCompletionDecl[] {
    return this.slashCompletions;
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
   * 状态注入桥(state-injection-bridge)写回(UI→agent):把写入/删除作为内部行经 stdin 下发子进程,
   * 由 runner 的 `wireStateBridge` 第二个 stdin 读取器截获改权威态(触发下行帧)。本方法仅发送、不等待;
   * UI 收敛靠下行 `control:"state"` 帧。pi 自身的 stdin 读取器对该行回无害 Unknown-command(已丢弃)。
   */
  setState(key: string, value: unknown, op: "set" | "delete" = "set"): void {
    this.assertActive();
    this.touch();
    this.channel.send(
      JSON.stringify(
        op === "delete"
          ? { type: "piweb_state_delete", key }
          : { type: "piweb_state_set", key, value },
      ),
    );
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
    // R11:斜杠命令可能不触发 turn(纯 ctx.ui 命令)→ 武装 watcher;窗口内无 agent_start 则合成 finish
    // 让前端 per-prompt 流收尾(否则纯命令永久 streaming)。真 turn 的 agent_start 会取消之。
    if (message.startsWith("/")) this.armCommandTurnWatcher();
    return this.forward(() => this.channel.prompt(message, options));
  }

  /** R11:武装命令-turn watcher(见 `commandTurnTimer` 字段注释)。 */
  private armCommandTurnWatcher(): void {
    this.cancelCommandTurnWatcher();
    this.awaitingCommandTurn = true;
    this.commandTurnTimer = setTimeout(() => {
      if (!this.awaitingCommandTurn || this._status !== "active") return;
      this.awaitingCommandTurn = false;
      this.commandTurnTimer = undefined;
      // 纯命令:无 agent_start/agent_end → 合成 finish(等同 agent_end 的产出)收尾 per-prompt 流。
      this.emitter.emit(FRAME_EVENT, makeUiMessageChunkFrame({ type: "finish" }));
    }, COMMAND_TURN_WINDOW_MS);
  }

  /** R11:取消 watcher(收到 agent_start=真 turn,或会话收尾/重启时)。 */
  private cancelCommandTurnWatcher(): void {
    if (this.commandTurnTimer !== undefined) {
      clearTimeout(this.commandTurnTimer);
      this.commandTurnTimer = undefined;
    }
    this.awaitingCommandTurn = false;
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

  /**
   * message-queue-ui「取回」:清空 agent 排队消息并返回被清文本。
   * 经 stdin 下发内部请求行 `piweb_clear_queue{id}`(runner 的 `wireClearQueueBridge` 截获执行),
   * 结果经 `piweb_clear_queue_result` 行回流,由 `handleRawLine` 按 id 配对 resolve。超时兜底 reject。
   * clearQueue 不在 pi RPC 命令集,故不走 `channel` 的 typed 命令,而经 `channel.send` 原始行。
   */
  clearQueue(timeoutMs = CLEAR_QUEUE_TIMEOUT_MS): Promise<ClearQueueResponse> {
    try {
      this.assertActive();
    } catch (err) {
      return Promise.reject(err);
    }
    this.touch();
    const id = randomUUID();
    return new Promise<ClearQueueResponse>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingClearQueue.delete(id);
        reject(new Error("clear_queue timed out"));
      }, timeoutMs);
      this.pendingClearQueue.set(id, { resolve, reject, timer });
      try {
        this.channel.send(JSON.stringify({ type: "piweb_clear_queue", id }));
      } catch (err) {
        this.pendingClearQueue.delete(id);
        clearTimeout(timer);
        reject(err instanceof Error ? err : new Error(String(err)));
      }
    });
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
   * 执行 bash 命令(bang shell 命令,spec bang-shell-command)。转发到通道既有 bash 能力,
   * `excludeFromContext` 透传(`!!` → 输出不进入 LLM 上下文)。结果由 agent 同步返回。
   */
  bash(
    command: string,
    options?: { excludeFromContext?: boolean },
  ): Promise<RpcResponse> {
    return this.forward(() => this.channel.bash(command, options));
  }

  /** 中止运行中的 bash 命令(预留端点;当前不接 UI)。 */
  abortBash(): Promise<RpcResponse> {
    return this.forward(() => this.channel.abortBash());
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
        // 单一权威:stats 同步入快照(仅 plain object;数组/非对象不污染,否则前端 safeParse 会
        // 连带丢掉整条 session-state 帧——含 busy/lifecycle,见检阅 MED)。
        if (typeof data === "object" && data !== null && !Array.isArray(data)) {
          this.setSnapshot({ stats: data as Record<string, unknown> });
        }
        break;
      case "set_model":
        this.cache = { ...(this.cache ?? {}), model: data, updatedAt: now };
        this.setSnapshot({ model: data });
        break;
      case "cycle_model":
        this.cache = { ...(this.cache ?? {}), model: data, updatedAt: now };
        this.setSnapshot({ model: data });
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

  /**
   * 冷恢复标题回填(方案A):把持久化的会话名合成一帧 `setTitle` extension-ui 请求,translate 成
   * `control:"extension-ui"` 帧后**登记为粘性帧**并广播。订阅者(含首个)回放该帧即得 ambient.title,
   * 补上冷恢复无 agent 侧 setTitle 帧的缺口。不入 `pendingExtensionUI`(setTitle 是推送类、无需回包),
   * 与握手/快照开关正交。构造期调用一次(此时无订阅者,靠 sticky 回放;后续订阅即得)。
   */
  private seedInitialTitle(title: string): void {
    const req: RpcExtensionUIRequest = {
      type: "extension_ui_request",
      id: `resume-title:${this.id}`,
      method: "setTitle",
      title,
    };
    const { frames, ctx } = translateEvent(req, this.translationCtx);
    this.translationCtx = ctx;
    for (const frame of frames) {
      this.sticky.set("resume-title", frame);
      this.emitter.emit(FRAME_EVENT, frame);
    }
  }

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
      lifecycleLog.error("exit before ready", {
        session: this.id,
        code: info.code,
        signal: info.signal,
      });
      this.setLifecycle(
        "error",
        "exit-before-ready",
        "agent exited before readiness",
      );
    }
    const reason: SessionEndReason =
      info.code === 0 ? "stopped" : "crashed";
    if (reason === "crashed") {
      lifecycleLog.error("agent crashed", {
        session: this.id,
        code: info.code,
        signal: info.signal,
      });
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
    // 会话清理里程碑(仅 active→stopping 真正执行清理时记一条,幂等 early-return 不重复)。
    lifecycleLog.info("session cleanup", { session: this.id, reason });

    this.closingPromise = (async () => {
      // 0) 生命周期终态(spec session-readiness-handshake,Req 5.2):置 ended 并广播
      //    (终态守卫:error/exit-before-ready 已是终态则保持不变;须在 removeAllListeners 前)。
      this.setLifecycle("ended");
      // 0b) 权威 busy 终态复位(session-snapshot-authority,Req 2.2「轮次以任意方式结束→busy=false」):
      //     崩溃/中途停止不经 handleEvent/reduceSnapshot(不会收到 agent_end),故此处显式复位,
      //     避免最后一帧 session-state 以 busy=true 收尾让纯投影前端永久显示忙碌。须在 removeAllListeners 前。
      this.setSnapshot({ busy: false });
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
      // R11:清命令-turn watcher 计时器(收尾时不再合成 finish)。
      this.cancelCommandTurnWatcher();
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
      // message-queue-ui:reject 所有在途 clearQueue 请求,避免收尾后悬挂(超时兜底之外的即时收敛)。
      for (const [, pending] of this.pendingClearQueue) {
        clearTimeout(pending.timer);
        pending.reject(new SessionStoppedError(this.id));
      }
      this.pendingClearQueue.clear();
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
