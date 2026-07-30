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
import type {
  AgentRouteDeclDto,
  AgentRouteMethod,
  AgentRouteRequestFrame,
  AgentRouteResultFrame,
  AttachmentCatalogRequestFrame,
  AttachmentCatalogResultFrame,
  AttachmentControlPayload,
} from "@blksails/pi-web-protocol";
import {
  makeControlFrame,
  makeUiMessageChunkFrame,
  SlashCompletionsFrameSchema,
  UiRpcResponseSchema,
  StateDownLineSchema,
  ClearQueueResultLineSchema,
  AgentRoutesFrameSchema,
  AgentRouteResultFrameSchema,
  AgentAttachmentProfileFrameSchema,
  AgentAttachmentCatalogFrameSchema,
  AttachmentCatalogResultFrameSchema,
  AttachmentEventFrameSchema,
  RunnerReadyFrameSchema,
} from "@blksails/pi-web-protocol";
import { randomUUID } from "node:crypto";
import { createLogger } from "@blksails/pi-web-logger";

// 命名空间 session:tool —— 主进程侧工具调用边界:server 收到 runner 的 tool_execution_* 事件
// 的时刻(对照 runner 内部 toolkit:* 计时,定位时间花在哪一段)。主进程日志落 server stderr,
// 受 configureLogger(主进程门控)约束,默认关。
const toolLog = createLogger({ namespace: "session:tool" });

// 命名空间 session:lifecycle —— 会话生命周期里程碑:就绪握手/生命周期跃迁(ready/ended/error/
// initializing)、退出与崩溃语义、cleanup 清理、turn 边界(agent_start/agent_end)。主进程日志落
// server stderr,受 configureLogger(主进程门控)约束,默认关。
const lifecycleLog = createLogger({ namespace: "session:lifecycle" });

// 命名空间 session:routes —— agent 声明式 routes(spec agent-declared-routes):声明帧二次校验
// 失败丢弃的诊断记录。主进程日志落 server stderr,受 configureLogger(主进程门控)约束,默认关。
const routesLog = createLogger({ namespace: "session:routes" });

// 命名空间 session:attachment-profile —— agent 具名附件 profile(spec agent-attachment-profile):
// 装配期声明帧二次校验失败/关断/名字失配丢弃的诊断记录(子进程为权威,本处仅防御性核对)。
// 主进程日志落 server stderr,受 configureLogger(主进程门控)约束,默认关。
const attachmentProfileLog = createLogger({ namespace: "session:attachment-profile" });

// 命名空间 session:attachment-catalog —— agent 附件目录(spec agent-attachment-catalog):
// 声明帧/结果帧二次校验失败丢弃、事件帧畸形丢弃的诊断记录。主进程日志落 server stderr,
// 受 configureLogger(主进程门控)约束,默认关。
const attachmentCatalogLog = createLogger({ namespace: "session:attachment-catalog" });
import type { ResolvedSource } from "../agent-source/index.js";
import {
  ATTACHMENT_BACKENDS_ENV,
  isAttachmentProfileDisabled,
  parseBackendsEnv,
} from "../attachment/backends-config.js";
import type { ExitInfo, Unsubscribe } from "../rpc-channel/index.js";
import { SessionLogPipe } from "./log-pipe.js";
import {
  AgentRouteTimeoutError,
  AttachmentCatalogTimeoutError,
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
import { PendingRequests } from "./pending-requests.js";
import { TrailingThrottle } from "./trailing-throttle.js";
import { AgentDeclarations } from "./agent-declarations.js";
import {
  dispatchRawLine,
  type RawLineEntry,
  type RawLineTable,
} from "./raw-line-router.js";
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
/**
 * agent-declared-routes:route 调用请求帧→结果帧的关联超时默认值(Req 3.4)。
 * 纯代码默认;env 覆盖(`PI_WEB_AGENT_ROUTE_TIMEOUT_MS`)在 HTTP 层读取后以参数传入(task 3.2)。
 */
const DEFAULT_AGENT_ROUTE_TIMEOUT_MS = 20_000;
/**
 * agent-attachment-catalog:catalog 请求(list/materialize)请求帧→结果帧的关联超时默认值。
 * 纯代码默认;list 侧由 catalog provider 传入更短的时限(≈700ms,design.md §决策);
 * materialize 侧的 env 覆盖(`PI_WEB_ATTACHMENT_CATALOG_TIMEOUT_MS`)在 HTTP 层读取后
 * 以参数传入(task 4.2),本层不读 env。
 */
const DEFAULT_CATALOG_TIMEOUT_MS = 20_000;
/** agent-attachment-catalog:`control:"attachment"` 事件转发的尾沿节流窗口(design.md,防风暴)。 */
const ATTACHMENT_EVENT_THROTTLE_MS = 1000;
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

/**
 * 就绪看门狗默认超时(毫秒,Req 4.2):单一定时器兜底「runner 未主动上报就绪通告」
 * (版本错配 / 装配异常)。超时未收到 `runner_ready` 帧(或 cli 单发未成功)即判定
 * error{ready-frame-missing}(Req 4.1)。不发送任何请求、不重发(Req 4.3)。
 */
const DEFAULT_READY_TIMEOUT_MS = 30_000;

export class PiSession {
  readonly id: SessionId;
  readonly mode: ResolvedSource["mode"];
  readonly trust: ResolvedSource["trust"];
  /** 会话工作目录(与 spawnSpec.cwd 一致),供补全 file provider 等限定枚举范围。 */
  readonly cwd: ResolvedSource["cwd"];
  /**
   * resolver 稳定来源标识(同 `ResolvedSource.policySource`;dir 绝对路径 / git url /
   * `builtin:<name>`)。per-source settings 实时下发(spec source-settings-and-slots,
   * 任务 7.2)据此按 sourceKey 匹配活跃会话(见 `settings-live-broadcast.ts`);其余机制
   * 不消费,可能为 `undefined`(见 `ResolvedSource.policySource` 的向后兼容注记)。
   */
  readonly policySource: ResolvedSource["policySource"];

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
  private readonly pendingClearQueue = new PendingRequests<ClearQueueResponse>();
  /**
   * agent-declared-routes:route 调用在途请求(clearQueue 同构):按关联 id 配对子进程回写的
   * `piweb_agent_route_result` 行。隔离于 PiRpcProcess 的 RPC pending map(pi 自身对请求行回的
   * Unknown-command 不在此表 → 丢弃)。超时或会话收尾时 reject 以免悬挂(Req 3.4 / 5.3)。
   */
  private readonly pendingAgentRoutes = new PendingRequests<AgentRouteResultFrame>();
  private translationCtx: TranslationContext = createTranslationContext();
  private cache: CachedState | undefined;
  /**
   * agent 装配期声明帧的只读投影(slash 补全 / routes / 附件 profile / 目录可用性)。
   * 四者共同语义(早于就绪门、未声明有确定缺省、一次性、纯数据)见 {@link AgentDeclarations}。
   */
  private readonly declarations = new AgentDeclarations();
  /**
   * agent-attachment-catalog:catalog 调用(list/materialize)在途请求(clearQueue/agent-routes
   * 同构):按关联 id 配对子进程回写的 `piweb_attachment_catalog_result` 行。超时或会话收尾时
   * reject 以免悬挂(Req 2.4/3.4)。
   */
  private readonly pendingCatalog = new PendingRequests<AttachmentCatalogResultFrame>();
  /** `control:"attachment"` 尾沿节流状态(design.md,≤1 帧/秒防风暴)。 */
  /**
   * agent-attachment-catalog:`control:"attachment"` 的尾沿节流器(≤1 帧/秒防风暴,
   * design.md §行为规约)。语义与合并取舍见 {@link TrailingThrottle}。
   */
  private readonly attachmentEvents = new TrailingThrottle<AttachmentControlPayload>(
    ATTACHMENT_EVENT_THROTTLE_MS,
    (payload) => this.emitter.emit(FRAME_EVENT, makeControlFrame(payload)),
  );

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
  private readonly readyTimeoutMs: number;
  /**
   * 权威快照机制开关(session-snapshot-authority)。默认 `false`:不广播/不回放 session-state
   * 帧,完全保留既有行为(单测/legacy 零回归)。生产 app 接线开启(见 pi-handler)。
   * 关 → 开 / 开 → 关 即一步回退(Req 8.2/8.4)。
   */
  private readonly snapshotAuthority: boolean;
  /**
   * 就绪看门狗定时器(Req 4.2/4.3):单一 `setTimeout`(unref,不钉进程)。到达 ready 或任何
   * 终态时取消(setLifecycle 内统一处置);cleanup 收尾兜底再清一次,不残留悬挂定时器
   * (Req 4.4)。构造期开启握手时武装;runner 重启复位 initializing 后重新武装(Req 5.1/5.2)。
   */
  private readyWatchdog: ReturnType<typeof setTimeout> | undefined;
  /**
   * 状态桥(`control:"state"`)rev 跨 runner 重启保持**单调**。dev 热重载 / 显式 restart 会重生
   * runner 子进程,新状态桥 store 的 rev 从 1 重新计数;客户端 control-store 按 `rev <= cur.rev` 判
   * **陈旧丢弃**(control-store.ts),故重启后新 runner 重推的 KV(如 `aigc.models`)会被当陈旧忽略
   * → 改代码后前端不刷新。这里对转发给客户端的 rev 加 `stateRevOffset`,重启时把 offset 抬过历史峰值,
   * 使新 runner 的低 rev 帧仍 > 客户端现值而被接受(重启后 KV 收敛)。
   */
  private stateRevOffset = 0;
  private maxForwardedStateRev = 0;
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
  /**
   * stderr 日志管道(解析 / 门控 / ring buffer / 产帧)。语义与门控缓冲的理由见
   * {@link SessionLogPipe} —— 该簇与会话其它职责无交集,整体提出。
   */
  private readonly logPipe: SessionLogPipe;

  constructor(opts: PiSessionOptions) {
    this.id = opts.id;
    this.channel = opts.channel;
    this.mode = opts.resolved.mode;
    this.trust = opts.resolved.trust;
    this.cwd = opts.resolved.cwd;
    this.policySource = opts.resolved.policySource;
    this.idleMs = opts.idleMs ?? DEFAULT_IDLE_MS;
    this.onClosed = opts.onClosed;
    this.logPipe = new SessionLogPipe({
      ...(opts.loggingConfigProvider !== undefined
        ? { provider: opts.loggingConfigProvider }
        : {}),
      defaultGate: GATE_DEFAULT,
      isActive: () => this._status === "active",
      emit: (entries) =>
        this.emitter.emit(FRAME_EVENT, makeControlFrame({ control: "logs", entries })),
    });
    this.readinessHandshake = opts.readinessHandshake ?? false;
    this.snapshotAuthority = opts.snapshotAuthority ?? false;
    this.readyTimeoutMs = opts.readyTimeoutMs ?? DEFAULT_READY_TIMEOUT_MS;

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
      this.channel.onStderr((chunk) => this.logPipe.ingest(chunk)),
    );

    this.touch();

    // 重生完成信号(若通道支持):驱动两件事——① 状态桥 rev 抬升(**恒执行**,与握手无关,修热重载
    // 后 KV 不刷新);② 就绪握手复位 initializing 并重探针(仅握手开启时)。故 onRestart 恒订阅。
    // 通道不支持 onRestart 时:rev 抬升退化不可用(dev 热重载少见此路径),就绪退回 settle 定时器。
    if (typeof this.channel.onRestart === "function") {
      this.unsubs.push(
        this.channel.onRestart(() => this.handleRunnerRestarted()),
      );
    }
    // 就绪握手(spec runner-ready-frame):开启时武装看门狗兜底(Req 4.1/4.2),
    // 异步、不阻塞构造;关闭时完全 no-op(既有行为不变)。
    if (this.readinessHandshake) {
      this.armReadyWatchdog();
      this.startCliReadinessIfApplicable();
    }
  }

  /**
   * cli 模式单发就绪判定(D5,决策表,Req 6.1/6.2):无 pi-web runner 装配层,子进程不具备
   * 主动上报能力 —— 单次 getCommands 成功即判定 ready;无重试、无专用定时器(该形态无
   * 早期输入丢失问题,单次判定已足够可靠)。失败静默:交给 exit-before-ready 或看门狗收口。
   *
   * 构造期与 runner 重启后各触发一次(重启后 custom 靠新子进程重发 ready 帧,cli 则必须
   * 重新单发 —— 否则重启后无任何就绪信号来源,只会落到看门狗超时)。custom 模式 no-op。
   */
  private startCliReadinessIfApplicable(): void {
    if (this.mode !== "cli") return;
    void this.channel.getCommands().then(
      () => this.setLifecycle("ready"),
      () => {
        // 静默(D5):由 exit-before-ready / 看门狗兜底收口。
      },
    );
  }

  /** 武装就绪看门狗(重复调用先清后装,幂等)。 */
  private armReadyWatchdog(): void {
    this.clearReadyWatchdog();
    const timer = setTimeout(() => {
      this.readyWatchdog = undefined;
      this.setLifecycle(
        "error",
        "ready-frame-missing",
        `runner did not announce readiness within ${this.readyTimeoutMs}ms`,
      );
    }, this.readyTimeoutMs);
    // ★ unref:看门狗不应把进程钉在事件循环里(同探针机制原有的理由)。
    if (typeof timer.unref === "function") timer.unref();
    this.readyWatchdog = timer;
  }

  /** 取消就绪看门狗(幂等)。到达 ready/终态或 cleanup 收尾时调用(Req 4.4)。 */
  private clearReadyWatchdog(): void {
    if (this.readyWatchdog !== undefined) {
      clearTimeout(this.readyWatchdog);
      this.readyWatchdog = undefined;
    }
  }

  /** 重生完成:抬升状态桥 rev(恒);握手开启时另复位 initializing 并重武装看门狗(Req 5.1/5.2)。 */
  private handleRunnerRestarted(): void {
    // ① 状态桥 rev 抬升:offset 抬过历史转发峰值,使新 runner(store rev 归 1)重推的 KV 不被
    //    客户端按 `rev <= cur.rev` 判陈旧丢弃。恒执行,不依赖握手开关。
    this.stateRevOffset = this.maxForwardedStateRev + 1;
    // ② 就绪握手复位(仅握手开启 + active):custom 形态由新子进程重发 `runner_ready` 帧
    //    (Req 5.2),cli 形态重新单发一次(此刻子进程已真实重生,stdin 指向新进程);
    //    并重武装看门狗兜底(Req 5.4)。无 settle 定时器(Req 5.3,该等待仅探针机制需要,
    //    收帧化下 onRestart 本身就是「已落到新子进程」的时机信号)。
    if (!this.readinessHandshake || this._status !== "active") return;
    this.setLifecycle("initializing", undefined, undefined, { forceReset: true });
    this.armReadyWatchdog();
    this.startCliReadinessIfApplicable();
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
    // 到达 ready 或任何终态:取消看门狗,不残留悬挂定时器(Req 4.4)。
    if (state === "ready" || state === "error" || state === "ended") {
      this.clearReadyWatchdog();
    }
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
    const buffered = this.logPipe.getLogs();
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

  /**
   * per-source settings 运行期实时下发(spec source-settings-and-slots,任务 7.2;
   * design.md「通道 b」;Req 7.1/7.2)。`PUT /config/source/:sourceKey` 落盘成功后,
   * 应用层(见 `settings-live-broadcast.ts`)按 sourceKey 匹配到本会话时调用本方法——
   * **公开入口**,不经子进程 stdin/handleRawLine 往返(该帧不是子进程上报,而是主进程
   * 内部直接广播,复用的是 `piweb_state` 分支同一套「广播 + sticky 粘性回放」*模式*,
   * 见 `handleRawLine` 的 `piweb_state` 分支 :687-708 与该模式的既有先例
   * `setLifecycle`/`applySnapshot`)。
   *
   * 按 sourceKey 分区登记粘性帧(重连订阅者回放拿到该 source 最近一次下发,Req 7.2);
   * 非 active 会话 no-op(已停止的会话无订阅者可推)。调用方负责:①按 schema 掩码
   * secret 字段(明文永不下发浏览器,同 GET 端点);②只把 schema 声明的
   * `liveReload:true` 键集合传入 `liveReloadKeys`(消费侧据此判断是否立即生效)。
   */
  emitSettingsChanged(payload: {
    readonly sourceKey: string;
    readonly values: Readonly<Record<string, unknown>>;
    readonly liveReloadKeys: readonly string[];
  }): void {
    if (this._status !== "active") return;
    const frame = makeControlFrame({
      control: "settings-changed",
      sourceKey: payload.sourceKey,
      values: payload.values,
      liveReloadKeys: [...payload.liveReloadKeys],
    });
    this.sticky.set(`settings-changed:${payload.sourceKey}`, frame);
    this.emitter.emit(FRAME_EVENT, frame);
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
    const prevFatal = this.translationCtx.fatalTerminated;
    const { frames, ctx } = translateEvent(event, this.translationCtx);
    this.translationCtx = ctx;
    // fail-fast:本轮首次因致命 provider 错误终止(auto_retry_start 命中 isFatalProviderError)→
    // 主动 abort 中止 agent 的重试循环。UI 已由上面翻译出的 error+finish 帧即时收尾;此处 best-effort
    // 止住后台的无谓重试(abort 失败非致命 —— 后台至多再跑几次即自然结束,UI 不受影响)。
    if (!prevFatal && ctx.fatalTerminated) {
      void this.abort().catch(() => {
        // 忽略:UI 已终止;abort 失败仅意味着后台重试未被提前打断。
      });
    }
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
   * 入站原始行的处置表(`type` → 校验 + 处置)。惰性建一次,`handleRawLine` 查表分发。
   *
   * ★ 建表而非 if-链:加一个帧类型 = 加一个条目,不必再往一条 185 行的链尾追加。
   *   这与**子进程侧** `@blksails/pi-web-runner` 的 `frame-channel/frame-router.ts` 同构 ——
   *   同一条 IPC 通道的两端现在用同一种方式解复用。
   *
   * ★ 条目顺序**不承载语义**(Map 查表,不是顺序匹配)。原 if-链里那些「置于 active gate
   *   之前」的注释,现由各条目的 `requireActive` 显式表达:除 `ui_rpc_response` 外一律
   *   不设该门 —— 结果帧要在超时/收尾窗口里仍能配对在途请求,装配期声明帧要早于就绪门
   *   就被缓存。
   *
   * ★ `onInvalid` 的有无同样是**刻意**的:结果帧畸形静默丢弃(必有在途请求,超时兜底会
   *   给出更准的错误);声明帧畸形必须 warn(后果是该能力整个不可用,别处不会报)。
   */
  private rawLineTable: RawLineTable | undefined;

  private getRawLineTable(): RawLineTable {
    if (this.rawLineTable !== undefined) return this.rawLineTable;
    const table = new Map<string, RawLineEntry<never>>();
    const add = <T>(type: string, entry: RawLineEntry<T>): void => {
      table.set(type, entry as unknown as RawLineEntry<never>);
    };

    // runner 就绪通告(spec runner-ready-frame,Req 2.1-2.4):runner 可服务后主动上报一次,
    // 收帧即迁移为 ready。重复/迟到帧(非 initializing 时收到)由 setLifecycle 既有单向守卫
    // 消化为 no-op(Req 2.4);握手关闭时 setLifecycle 整体 no-op(Req 3.4)。
    add("runner_ready", {
      schema: RunnerReadyFrameSchema,
      handle: () => {
        this.setLifecycle("ready");
      },
    });

    // 状态注入桥(state-injection-bridge):子进程上报的权威态变更 → control:"state" 帧。
    add("piweb_state", {
      schema: StateDownLineSchema,
      handle: (data) => {
        // 客户端 rev 单调化:runner-local rev + 跨重启 offset(见 stateRevOffset 说明)。
        const forwardedRev = data.rev + this.stateRevOffset;
        if (forwardedRev > this.maxForwardedStateRev) {
          this.maxForwardedStateRev = forwardedRev;
        }
        const frame = makeControlFrame({
          control: "state",
          key: data.key,
          value: data.value,
          rev: forwardedRev,
          ...(data.deleted ? { deleted: true } : {}),
        });
        // 按 key 登记为粘性帧(与 queue/session-state 同构),使重连/迟到订阅者回放即得每个
        // key 的最新值——否则重连后 KV 快照丢失(仅当次会话内存活)。delete 帧同样登记(而非
        // 从表中摘除):重放时前端按 deleted:true 语义删键,效果与「表中没有该键」一致,但
        // 复用已有 last-value 覆盖机制,无需新增 delete() API。
        this.sticky.set(`state:${data.key}`, frame);
        this.emitter.emit(FRAME_EVENT, frame);
      },
    });

    // 三个结果帧:按 id 配对在途请求。未知/迟到 id 由 PendingRequests.settle 安全丢弃。
    add("piweb_clear_queue_result", {
      schema: ClearQueueResultLineSchema,
      handle: (data) => {
        this.pendingClearQueue.settle(data.id, {
          steering: data.steering,
          followUp: data.followUp,
        });
      },
    });
    add("piweb_agent_route_result", {
      schema: AgentRouteResultFrameSchema,
      handle: (data) => void this.pendingAgentRoutes.settle(data.id, data),
    });
    add("piweb_attachment_catalog_result", {
      schema: AttachmentCatalogResultFrameSchema,
      handle: (data) => void this.pendingCatalog.settle(data.id, data),
    });

    // 四个装配期声明帧:按会话缓存为只读投影,早于就绪门。
    add("slash_completions", {
      schema: SlashCompletionsFrameSchema,
      handle: (data) => {
        this.declarations.setSlashCompletions(data.items);
      },
    });
    add("agent_routes", {
      schema: AgentRoutesFrameSchema,
      // 校验失败 → 整帧丢弃并记日志(routes 不挂载,清单空、调用 404;
      // Req 2.5 / design Error Handling)。
      onInvalid: (error) => {
        routesLog.warn("agent_routes frame dropped: schema validation failed", {
          session: this.id,
          issues: (error as { issues?: unknown } | undefined)?.issues,
        });
      },
      handle: (data) => {
        this.declarations.setRoutes(data.routes);
      },
    });
    add("agent_attachment_profile", {
      schema: AgentAttachmentProfileFrameSchema,
      onInvalid: (error) => {
        attachmentProfileLog.warn(
          "agent_attachment_profile frame dropped: schema validation failed",
          { session: this.id, issues: (error as { issues?: unknown } | undefined)?.issues },
        );
      },
      // 子进程装配期已是白名单校验权威;主进程消费侧仅做防御性核对——关断 / 名字未在本进程
      // 视角的拓扑中命中,均 warn+丢弃不缓存(不失败会话,回落宿主默认写路由,Req 2.1/2.3/5.1)。
      handle: (data) => {
        if (isAttachmentProfileDisabled(process.env)) {
          attachmentProfileLog.warn("agent_attachment_profile frame dropped: disabled", {
            session: this.id,
          });
          return;
        }
        const topology = parseBackendsEnv(process.env[ATTACHMENT_BACKENDS_ENV]);
        const known = topology?.backends.map((b) => b.name) ?? [];
        if (!known.includes(data.profile)) {
          attachmentProfileLog.warn(
            "agent_attachment_profile frame dropped: profile not in this process's topology view",
            { session: this.id, profile: data.profile, known },
          );
          return;
        }
        this.declarations.setAttachmentWriteProfile(data.profile);
      },
    });
    add("agent_attachment_catalog", {
      schema: AgentAttachmentCatalogFrameSchema,
      // 校验失败 → 丢弃不缓存(目录视同未声明,provider 零往返,Req 1.2)。
      onInvalid: (error) => {
        attachmentCatalogLog.warn(
          "agent_attachment_catalog frame dropped: schema validation failed",
          { session: this.id, issues: (error as { issues?: unknown } | undefined)?.issues },
        );
      },
      handle: () => {
        this.declarations.markAttachmentCatalogAvailable();
      },
    });

    // 子进程主动推送的「新增附件」事件帧(publish 落库后发射)。转发为 SSE
    // `control:"attachment"`,尾沿节流 ≤1 帧/秒防风暴(design.md §行为规约)。非粘性:
    // 错过不补(打开会话时前端本就全量枚举目录/附件)。
    add("piweb_attachment_event", {
      schema: AttachmentEventFrameSchema,
      onInvalid: (error) => {
        attachmentCatalogLog.warn(
          "piweb_attachment_event frame dropped: schema validation failed",
          { session: this.id, issues: (error as { issues?: unknown } | undefined)?.issues },
        );
      },
      handle: (data) => {
        this.attachmentEvents.push({
          control: "attachment",
          event: data.event,
          attachment: data.attachment,
        });
      },
    });

    // Tier3 ui-rpc 下行约定:`{"type":"ui_rpc_response","response":{...}}`。
    // ★ 唯一设 active 门的条目(原 if-链里那句 `if (this._status !== "active") return;`
    //   恰位于它之前)。校验对象是**内层** `response` 而非整帧,故包一层取值适配。
    add("ui_rpc_response", {
      requireActive: true,
      schema: {
        safeParse: (v: unknown) =>
          UiRpcResponseSchema.safeParse((v as { response?: unknown } | null)?.response),
      },
      handle: (data) => {
        this.emitter.emit(
          FRAME_EVENT,
          makeControlFrame({ control: "ui-rpc", response: data }),
        );
      },
    });

    this.rawLineTable = table;
    return table;
  }

  /**
   * 原始行处理:按 `type` 查 {@link getRawLineTable} 分发。未注册类型 / 非 JSON / 校验
   * 失败的行不消费(其余行已由 onEvent / onExtensionUIRequest 路径处理)。
   */
  private handleRawLine(line: string): void {
    dispatchRawLine(line, this.getRawLineTable(), this._status === "active");
  }

  /** agent 装配期声明的静态 slash 补全候选(spec agent-slash-completion)。 */
  getSlashCompletions(): readonly SlashCompletionDecl[] {
    return this.declarations.slashCompletions;
  }

  /**
   * agent 装配期声明的 routes 路由表(spec agent-declared-routes,Req 2.5)。
   * 无声明 → 空数组;就绪门前收帧即可读(声明帧缓存早于 lifecycle ready)。
   */
  get agentRoutes(): ReadonlyArray<AgentRouteDeclDto> {
    return this.declarations.routes;
  }

  /**
   * agent 装配期声明的附件写目标 profile 名(spec agent-attachment-profile,Req 2.1/2.3)。
   * 未声明/关断/校验失配恒为 `undefined`(回落宿主默认写路由)。就绪门前收帧即可读
   * (声明帧缓存早于 lifecycle ready,slash_completions/agent_routes 同族)。
   */
  getAttachmentWriteProfile(): string | undefined {
    return this.declarations.attachmentWriteProfile;
  }

  /**
   * agent 装配期声明的附件目录是否可用(spec agent-attachment-catalog,Req 1.2)。
   * 未声明恒为 `false`;就绪门前收帧即可读(声明帧缓存早于 lifecycle ready,
   * slash_completions/agent_routes 同族)。catalog provider 据此实现零往返降级。
   */
  get attachmentCatalogAvailable(): boolean {
    return this.declarations.attachmentCatalogAvailable;
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
    return this.logPipe.getLogs(query);
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
    return this.pendingClearQueue.issue({
      id,
      timeoutMs,
      onTimeout: () => new Error("clear_queue timed out"),
      send: () => this.channel.send(JSON.stringify({ type: "piweb_clear_queue", id })),
    });
  }

  /**
   * agent-declared-routes:同步转发一次 route 调用(clearQueue 模式,Req 3.2 / 5.1)。
   * 经 stdin 下发请求帧 `piweb_agent_route_request{id}`(runner 的 `wireAgentRoutesBridge`
   * 截获执行 handler),结果经 `piweb_agent_route_result` 行回流,由 `handleRawLine` 按 id
   * 配对 resolve。超时兜底 reject `AgentRouteTimeoutError`(→HTTP 504,Req 3.4)。
   * 结果 `ok:false` 以返回值表达(→HTTP 502),不在此层 reject。
   *
   * `timeoutMs` 为纯代码默认(20s);env 覆盖由 HTTP 层(task 3.2)读取后以参数传入,本层不读 env。
   */
  invokeAgentRoute(
    name: string,
    req: { method: AgentRouteMethod; query: Record<string, string>; body?: unknown },
    timeoutMs: number = DEFAULT_AGENT_ROUTE_TIMEOUT_MS,
  ): Promise<AgentRouteResultFrame> {
    try {
      this.assertActive();
    } catch (err) {
      return Promise.reject(err);
    }
    this.touch();
    const id = randomUUID();
    const frame: AgentRouteRequestFrame = {
      type: "piweb_agent_route_request",
      id,
      name,
      method: req.method,
      query: req.query,
      // GET 无 body:undefined 时不携带 body 键(帧保持最小投影)。
      ...(req.body !== undefined ? { body: req.body } : {}),
    };
    return this.pendingAgentRoutes.issue({
      id,
      timeoutMs,
      onTimeout: () => new AgentRouteTimeoutError(name, timeoutMs),
      send: () => this.channel.send(JSON.stringify(frame)),
    });
  }

  /**
   * agent-attachment-catalog:同步转发一次 catalog 请求(list/materialize,invokeAgentRoute
   * 模式,Req 2.4 / 3.2)。经 stdin 下发请求帧 `piweb_attachment_catalog_request{id}`(runner
   * 的 `wireAttachmentCatalogBridge` 截获派发),结果经 `piweb_attachment_catalog_result` 行
   * 回流,由 `handleRawLine` 按 id 配对 resolve。超时兜底 reject `AttachmentCatalogTimeoutError`
   * (list 侧 provider 据此降级为空组;materialize 侧 HTTP 层映射 504)。结果 `ok:false` 以
   * 返回值表达,不在此层 reject。
   *
   * `timeoutMs` 为纯代码默认(20s);调用方按场景覆盖(provider 传 ≈700ms;HTTP 层读 env 覆盖后
   * 以参数传入),本层不读 env。
   */
  requestCatalog(
    req: { op: "list"; query: string } | { op: "materialize"; entryId: string },
    timeoutMs: number = DEFAULT_CATALOG_TIMEOUT_MS,
  ): Promise<AttachmentCatalogResultFrame> {
    try {
      this.assertActive();
    } catch (err) {
      return Promise.reject(err);
    }
    this.touch();
    const id = randomUUID();
    const frame: AttachmentCatalogRequestFrame =
      req.op === "list"
        ? { type: "piweb_attachment_catalog_request", id, op: "list", query: req.query }
        : { type: "piweb_attachment_catalog_request", id, op: "materialize", entryId: req.entryId };
    return this.pendingCatalog.issue({
      id,
      timeoutMs,
      onTimeout: () => new AttachmentCatalogTimeoutError(req.op, timeoutMs),
      send: () => this.channel.send(JSON.stringify(frame)),
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
    // 就绪握手:重启即重握手(Req 5.1)。立即复位 initializing 并广播 → 前端在重新就绪前**即刻**
    // 重新门控(不等真实重生,关闭过早发送窗口)。看门狗重武装收敛到此一处:通道支持 onRestart
    // 时 handleRunnerRestarted 在**真实重生时机**再次复位+重武装(幂等,覆盖此处的武装);
    // 不支持 onRestart 的通道(无回调可用)则仅有此处的武装兜底 —— 无 settle 定时器
    //(Req 5.3,收帧化下不再需要等窗口落到新子进程,看门狗单独兜底真正失败的重启)。
    if (this.readinessHandshake) {
      this.setLifecycle("initializing", undefined, undefined, { forceReset: true });
      this.armReadyWatchdog();
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
      // 1) 清 idle 计时(Stopping 首步)+ 就绪看门狗(Req 4.4 兜底,通常已由 setLifecycle("ended") 清过)。
      if (this.idleTimer !== undefined) {
        clearTimeout(this.idleTimer);
        this.idleTimer = undefined;
      }
      this.clearReadyWatchdog();
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
      // reject 所有在途请求,避免收尾后悬挂(超时兜底之外的即时收敛):
      // clearQueue(message-queue-ui)/ route 调用(agent-declared-routes)/
      // catalog 调用(agent-attachment-catalog)三者同语义。
      const stopped = (): Error => new SessionStoppedError(this.id);
      this.pendingClearQueue.rejectAll(stopped);
      this.pendingAgentRoutes.rejectAll(stopped);
      this.pendingCatalog.rejectAll(stopped);
      // 清尾沿节流定时器,避免会话已收尾后仍触发 emitter.emit(已 removeAllListeners 前安全)。
      this.attachmentEvents.dispose();
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
