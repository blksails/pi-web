/**
 * PiRpcProcess — PiRpcChannel 的本地实现(Ports & Adapters 的 local 适配器)。
 *
 * 职责(Req 2.x / 4.x / 5.x / 6.x):
 *  - 按传入 SpawnSpec 以 `detached:false` spawn 子进程,接管 stdin/stdout/stderr 管道。
 *  - stdout(UTF-8)经 JsonlLineReader 成行 → 逐行 JSON 解析 → 三类消息分发:
 *      · response(带 id)→ 兑现 pendingCommands 对应 Promise
 *      · event        → 广播给 onEvent 监听器
 *      · extension_ui_request → 登记 pendingExtensionUI 并通知上层
 *  - 与包 RpcClient 对齐的 18 个命令方法封装(生成唯一 id + send + 等待响应)。
 *  - stderr 收集、exit/error 监听与传播、close() 干净退出与待决统一拒绝。
 *
 * 所有协议类型(命令/响应/事件/扩展 UI)与 SpawnSpec 一律 import 自 @blksails/protocol,
 * 本模块不重定义(单一事实来源)。接口签名不泄漏 child_process/管道概念(Req 1.3)。
 */
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { randomUUID } from "node:crypto";
import type {
  AgentEvent,
  ImageContent,
  RpcCommand,
  RpcExtensionUIRequest,
  RpcExtensionUIResponse,
  RpcResponse,
  SpawnSpec,
  ThinkingLevel,
} from "@blksails/protocol";
import type {
  ChannelHealth,
  LineListener,
  PiRpcChannel,
  Unsubscribe,
} from "./pi-rpc-channel.js";
import { JsonlLineReader } from "./jsonl-reader.js";
import {
  ChannelClosedError,
  ChildCrashError,
  SpawnError,
  type Diagnostic,
} from "./pi-rpc-process.errors.js";
import {
  registerForHotReload,
  type HotReloadTarget,
} from "./hot-reload.js";

/** 内部状态机(见 design 关闭与生命周期图)。 */
type Status = "spawning" | "ready" | "closing" | "exited";

/** 一个待决命令的 resolver / rejecter 对。 */
interface PendingCommand {
  readonly type: RpcCommand["type"];
  resolve(response: RpcResponse): void;
  reject(error: Error): void;
}

/** 子进程退出信息(经 onExit 暴露)。 */
export interface ExitInfo {
  readonly code: number | null;
  readonly signal: string | null;
}

type ExitListener = (info: ExitInfo) => void;
type EventListener = (event: AgentEvent) => void;
type ExtensionUIListener = (req: RpcExtensionUIRequest) => void;
type StderrListener = (chunk: string) => void;
type DiagnosticListener = (diag: Diagnostic) => void;

/**
 * 收窄某命令对应的响应子类型(含 success 与 failure 分支)。
 *
 * 用反向匹配(`C extends 成员的 command`)而非 `Extract<…, {command:C}>`:RpcResponse
 * 的失败分支以 `command: string` 标注,会让前向 `Extract` 把所有字面量成员判为
 * 不匹配而坍缩为 `never`。反向匹配保留命令字面量成功分支 + 通用失败分支,使
 * 调用方可经 `if (res.success)` 收窄到带 `data` 的成功负载。
 */
type ResponseFor<C extends RpcResponse["command"]> = RpcResponse extends infer R
  ? R extends { command: infer MC }
    ? C extends MC
      ? R
      : never
    : never
  : never;

export class PiRpcProcess implements PiRpcChannel, HotReloadTarget {
  /** 当前子进程;dev 热重载时 restart() 会替换为新进程(故非 readonly)。 */
  private child!: ChildProcessWithoutNullStreams;
  /** 行缓冲;每次重启换新实例,避免旧进程残行串到新进程。 */
  private reader = new JsonlLineReader();
  /** spawn 规格,供 restart() 用同一会话 id / env 重 spawn(续上对话)。 */
  private readonly spec: SpawnSpec;

  // 两张待决表(进程内内存,close/exit 时清空并拒绝)。
  private readonly pendingCommands = new Map<string, PendingCommand>();
  private readonly pendingExtensionUI = new Map<string, RpcExtensionUIRequest>();

  // 监听器集合。
  private readonly lineListeners = new Set<LineListener>();
  private readonly eventListeners = new Set<EventListener>();
  private readonly extensionUIListeners = new Set<ExtensionUIListener>();
  private readonly stderrListeners = new Set<StderrListener>();
  private readonly exitListeners = new Set<ExitListener>();
  private readonly diagnosticListeners = new Set<DiagnosticListener>();

  private status: Status = "spawning";
  private exitCode: number | null = null;
  private exitSignal: string | null = null;
  private stderrBuffer = "";

  /** close() 的幂等 Promise(确保子进程退出后才 resolve,Req 6.6)。 */
  private closePromise: Promise<void> | null = null;

  // ── dev 热重载状态(见 hot-reload.ts)──────────────────────────────────────
  /** 正在重启:旧子进程的 exit/error 事件不视为崩溃、不 finalize。 */
  private restarting = false;
  /** 重启请求落在忙时(有待决命令或回合进行中)→ 标记,待空闲再重启。 */
  private pendingRestart = false;
  /**
   * 回合活跃:agent_start..agent_end 之间为 true。热重载将其视为"忙"——回合进行中
   * (流式 token / 工具调用 / 等待 extension_ui 应答)重启会杀子进程致信息中断、丢失,
   * 故延迟到回合结束。仅靠 pendingCommands 不够:prompt 立即 ack,增量全走 event 流。
   */
  private turnActive = false;
  /** 热重载注册的注销函数(未启用时为空操作)。 */
  private hotReloadUnregister?: () => void;

  /**
   * 按给定 SpawnSpec 以 detached:false spawn 子进程并接管 stdio(Req 2.1–2.3)。
   * spawn 失败经子进程 `error` 事件异步传播(Req 2.4)。
   */
  constructor(spec: SpawnSpec) {
    this.spec = spec;
    this.spawnChild(); // 同步 spawn + 接管 stdio;同步失败抛 SpawnError
    // dev-only:注册到热重载 watcher(未启用时为空操作)。
    this.hotReloadUnregister = registerForHotReload(this);
  }

  /**
   * 按 `this.spec` spawn 子进程并接管 stdio + 接线事件。同步 spawn 失败抛 SpawnError。
   * 构造与 restart() 共用;监听器集合挂在 `this` 上,故重启后无需重新订阅。
   */
  private spawnChild(): void {
    let child: ChildProcessWithoutNullStreams;
    try {
      child = spawn(this.spec.cmd, this.spec.args, {
        cwd: this.spec.cwd,
        env: this.spec.env,
        detached: false, // 父进程退出时连带清理子进程(Req 2.2)
        stdio: ["pipe", "pipe", "pipe"],
      });
    } catch (err) {
      // 极少数同步 spawn 失败(如参数非法)。
      this.status = "exited";
      throw new SpawnError(`Failed to spawn "${this.spec.cmd}"`, err);
    }
    this.child = child;

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");

    child.on("spawn", () => {
      if (this.status === "spawning") {
        this.status = "ready";
      }
    });

    child.stdout.on("data", (chunk: string) => {
      this.handleStdout(chunk);
    });

    child.stderr.on("data", (chunk: string) => {
      this.stderrBuffer += chunk;
      for (const cb of this.stderrListeners) cb(chunk);
    });

    // spawn 失败(命令不存在/无法执行)经 error 事件到达(Req 2.4 / 6.5)。
    child.on("error", (err: Error) => {
      if (this.restarting) return; // 重启中:旧进程的 error 不视为崩溃
      this.finalize(null, null, new SpawnError(err.message, err));
    });

    child.on("exit", (code: number | null, signal: NodeJS.Signals | null) => {
      if (this.restarting) return; // 重启中:旧进程退出由 doRestart 处理重生
      // 子进程退出/崩溃:发信号 + 拒绝待决(Req 6.2 / 6.5)。
      const crash =
        this.status === "closing"
          ? new ChannelClosedError()
          : new ChildCrashError(code, signal);
      this.finalize(code, signal, crash);
    });
  }

  // ───────────────────────── dev 热重载(restart)─────────────────────────

  /**
   * 热重载触发({@link HotReloadTarget}):空闲(无待决命令)则立即重启子进程;
   * 忙则标记,待当前命令全部结算后重启。已退出/关闭则忽略。
   */
  requestRestart(): void {
    if (this.status === "exited" || this.status === "closing") return;
    // 忙 = 有待决命令 OR 回合进行中(见 turnActive)。两者皆空闲才立即重启。
    if (this.pendingCommands.size > 0 || this.turnActive) {
      this.pendingRestart = true;
      return;
    }
    void this.doRestart();
  }

  /** 空闲(无待决命令且回合结束)时执行此前因忙而延迟的热重启。 */
  private maybeRestartWhenIdle(): void {
    if (
      this.pendingRestart &&
      this.pendingCommands.size === 0 &&
      !this.turnActive
    ) {
      this.pendingRestart = false;
      void this.doRestart();
    }
  }

  /**
   * 杀掉当前子进程并用同一 spawnSpec 重 spawn(复用同一通道实例与全部监听器)。
   * 新进程经全新 jiti 重读源码;会话 id 复用 → 从持久化 jsonl 续上对话。
   */
  private async doRestart(): Promise<void> {
    if (this.restarting) return;
    if (this.status === "exited" || this.status === "closing") return;
    this.restarting = true;
    const old = this.child;
    try {
      await new Promise<void>((res) => {
        let settled = false;
        const done = () => {
          if (settled) return;
          settled = true;
          res();
        };
        old.once("exit", done);
        try {
          old.kill("SIGTERM");
        } catch {
          done();
          return;
        }
        const t = setTimeout(() => {
          try {
            old.kill("SIGKILL");
          } catch {
            /* 已退出 */
          }
        }, 2000);
        if (typeof t.unref === "function") t.unref();
        old.once("exit", () => clearTimeout(t));
      });
      // 重置每子进程的瞬时状态(监听器与待决表挂在 this 上,此刻待决已空)。
      this.reader = new JsonlLineReader();
      this.stderrBuffer = "";
      this.status = "spawning";
      this.restarting = false;
      this.spawnChild();
      process.stderr.write("[runner-hot-reload] runner restarted\n");
    } catch (err) {
      this.restarting = false;
      this.finalize(
        null,
        null,
        err instanceof Error
          ? new SpawnError(err.message, err)
          : new SpawnError(String(err), err),
      );
    }
  }

  // ───────────────────────── PiRpcChannel 端口成员 ─────────────────────────

  /** 写入一行原始 JSONL 到子进程 stdin(自动补 `\n`)。 */
  send(line: string): void {
    if (this.status === "exited" || this.status === "closing") {
      throw new ChannelClosedError();
    }
    this.child.stdin.write(line.endsWith("\n") ? line : `${line}\n`);
  }

  /** 注册按行接收回调(Req 1.2)。 */
  onLine(cb: LineListener): Unsubscribe {
    this.lineListeners.add(cb);
    return () => {
      this.lineListeners.delete(cb);
    };
  }

  /**
   * 关闭通道:终止子进程、关闭 stdin、停止分发、以"通道已关闭"拒绝全部待决
   * (Req 6.3),resolve 时子进程已退出无僵尸(Req 6.6)。幂等。
   */
  close(): Promise<void> {
    if (this.closePromise) return this.closePromise;

    this.closePromise = new Promise<void>((resolve) => {
      if (this.status === "exited") {
        resolve();
        return;
      }
      this.status = "closing";

      // 退出后 resolve(finalize 在 exit 事件里执行)。
      this.child.once("exit", () => resolve());

      // 立即拒绝全部待决命令(不等子进程退出)。
      this.rejectAllPending(new ChannelClosedError());

      // 关闭 stdin,再终止子进程。
      try {
        this.child.stdin.end();
      } catch {
        // 忽略:stdin 可能已关闭。
      }
      try {
        this.child.kill("SIGTERM");
      } catch {
        // 忽略:子进程可能已退出。
      }

      // 兜底:若 SIGTERM 未在宽限期内生效,强制 SIGKILL,避免僵尸(Req 6.6)。
      const killTimer = setTimeout(() => {
        if (this.status !== "exited") {
          try {
            this.child.kill("SIGKILL");
          } catch {
            // 忽略。
          }
        }
      }, 2000);
      if (typeof killTimer.unref === "function") killTimer.unref();
      this.child.once("exit", () => clearTimeout(killTimer));
    });

    return this.closePromise;
  }

  /** 查询通道健康状态(Req 6.4)。 */
  health(): ChannelHealth {
    return {
      alive: this.status === "ready" || this.status === "spawning",
      exitCode: this.exitCode,
      signal: this.exitSignal,
    };
  }

  // ───────────────────────── 事件与扩展 UI 订阅 ─────────────────────────

  /** 订阅 agent 事件(Req 4.2 / 5.5)。 */
  onEvent(cb: EventListener): Unsubscribe {
    this.eventListeners.add(cb);
    return () => {
      this.eventListeners.delete(cb);
    };
  }

  /** 订阅扩展 UI 请求(Req 4.3)。 */
  onExtensionUIRequest(cb: ExtensionUIListener): Unsubscribe {
    this.extensionUIListeners.add(cb);
    return () => {
      this.extensionUIListeners.delete(cb);
    };
  }

  /** 订阅 stderr 输出(Req 6.1)。 */
  onStderr(cb: StderrListener): Unsubscribe {
    this.stderrListeners.add(cb);
    return () => {
      this.stderrListeners.delete(cb);
    };
  }

  /** 订阅子进程退出信号(Req 6.2)。 */
  onExit(cb: ExitListener): Unsubscribe {
    this.exitListeners.add(cb);
    return () => {
      this.exitListeners.delete(cb);
    };
  }

  /** 订阅可观察诊断(孤儿响应 / 坏行 / 未知消息,Req 4.5 / 4.6)。 */
  onDiagnostic(cb: DiagnosticListener): Unsubscribe {
    this.diagnosticListeners.add(cb);
    return () => {
      this.diagnosticListeners.delete(cb);
    };
  }

  /** 已收集的 stderr 全文(供诊断,Req 6.1)。 */
  getStderr(): string {
    return this.stderrBuffer;
  }

  /**
   * 对某个待决扩展 UI 请求回复:经 send 写回 stdin 并从待决登记移除(Req 4.4)。
   * 若无对应待决项则记诊断、不写出。
   */
  respondExtensionUI(id: string, response: RpcExtensionUIResponse): void {
    if (!this.pendingExtensionUI.has(id)) {
      this.emitDiagnostic({
        kind: "orphan_response",
        message: `respondExtensionUI: no pending extension_ui_request for id=${id}`,
      });
      return;
    }
    this.pendingExtensionUI.delete(id);
    this.send(JSON.stringify(response));
  }

  // ───────────────────────── stdout 解析与分发 ─────────────────────────

  private handleStdout(chunk: string): void {
    if (this.status === "closing" || this.status === "exited") {
      // 停止分发后续行(Req 6.3)。
      return;
    }
    const lines = this.reader.push(chunk);
    for (const line of lines) {
      // onLine 端口回调:每条完整行(Req 1.2)。
      for (const cb of this.lineListeners) cb(line);
      this.dispatchLine(line);
    }
  }

  private dispatchLine(line: string): void {
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      // 不可解析行:记诊断、跳过、继续处理后续(Req 4.6)。
      this.emitDiagnostic({
        kind: "parse_error",
        message: "Failed to parse stdout line as JSON",
        line,
      });
      return;
    }

    if (typeof parsed !== "object" || parsed === null) {
      this.emitDiagnostic({
        kind: "unknown_message",
        message: "Parsed stdout line is not an object",
        line,
      });
      return;
    }

    const msg = parsed as { type?: unknown; id?: unknown; command?: unknown };

    // 三类消息按 `type` 路由(见 design 分发流图)。
    if (msg.type === "response") {
      this.handleResponse(parsed as RpcResponse, line);
      return;
    }
    if (msg.type === "extension_ui_request") {
      this.handleExtensionUIRequest(parsed as RpcExtensionUIRequest);
      return;
    }
    if (typeof msg.type === "string") {
      // 其余 type 均视为事件(agent_start/agent_end/message_update/...);
      // extension_ui_request 已在上面分流,AgentEvent 联合也包含它,但此处仅广播
      // 纯事件类。
      this.broadcastEvent(parsed as AgentEvent);
      return;
    }

    this.emitDiagnostic({
      kind: "unknown_message",
      message: "Parsed stdout message has no string `type`",
      line,
    });
  }

  private handleResponse(response: RpcResponse, line: string): void {
    const id = response.id;
    if (typeof id !== "string") {
      this.emitDiagnostic({
        kind: "orphan_response",
        message: "Response has no id; cannot correlate",
        line,
      });
      return;
    }
    const pending = this.pendingCommands.get(id);
    if (!pending) {
      // 无对应待决请求:丢弃 + 记诊断,不崩溃(Req 4.5)。
      this.emitDiagnostic({
        kind: "orphan_response",
        message: `Response id=${id} has no pending command`,
        line,
      });
      return;
    }
    this.pendingCommands.delete(id);
    pending.resolve(response);

    // 热重载:忙时延迟的重启,在空闲(命令结算 + 回合结束)后执行。
    this.maybeRestartWhenIdle();
  }

  private handleExtensionUIRequest(req: RpcExtensionUIRequest): void {
    // 登记为待决并通知上层,等待 respondExtensionUI(Req 4.3)。
    this.pendingExtensionUI.set(req.id, req);
    for (const cb of this.extensionUIListeners) cb(req);
  }

  private broadcastEvent(event: AgentEvent): void {
    // 跟踪回合活跃区间,供热重载判断"空闲"。agent_end 后若有待重启请求则结算。
    if (event.type === "agent_start") this.turnActive = true;
    else if (event.type === "agent_end") this.turnActive = false;
    for (const cb of this.eventListeners) cb(event);
    if (event.type === "agent_end") this.maybeRestartWhenIdle();
  }

  private emitDiagnostic(diag: Diagnostic): void {
    for (const cb of this.diagnosticListeners) cb(diag);
  }

  // ───────────────────────── 命令往返核心 ─────────────────────────

  /**
   * 发送一个期望响应的命令帧:生成唯一 id、send 写出、返回待决 Promise(Req 5.2)。
   * 待决期间不阻塞其他命令或事件(异步分发,Req 5.4)。
   */
  private sendCommand<C extends RpcResponse["command"]>(
    command: RpcCommand,
  ): Promise<ResponseFor<C>> {
    if (this.status === "exited" || this.status === "closing") {
      return Promise.reject(new ChannelClosedError());
    }
    const id = randomUUID();
    const frame: RpcCommand = { ...command, id };
    return new Promise<ResponseFor<C>>((resolve, reject) => {
      this.pendingCommands.set(id, {
        type: command.type,
        resolve: (response) => resolve(response as ResponseFor<C>),
        reject,
      });
      try {
        this.send(JSON.stringify(frame));
      } catch (err) {
        this.pendingCommands.delete(id);
        reject(err instanceof Error ? err : new Error(String(err)));
      }
    });
  }

  // ───────────── 命令方法封装(18 个,与包 RpcClient 对齐,Req 5.1) ─────────────

  prompt(
    message: string,
    options?: {
      images?: readonly ImageContent[];
      streamingBehavior?: "steer" | "followUp";
    },
  ): Promise<ResponseFor<"prompt">> {
    return this.sendCommand<"prompt">({
      type: "prompt",
      message,
      ...(options?.images ? { images: [...options.images] } : {}),
      ...(options?.streamingBehavior
        ? { streamingBehavior: options.streamingBehavior }
        : {}),
    });
  }

  steer(
    message: string,
    options?: { images?: readonly ImageContent[] },
  ): Promise<ResponseFor<"steer">> {
    return this.sendCommand<"steer">({
      type: "steer",
      message,
      ...(options?.images ? { images: [...options.images] } : {}),
    });
  }

  followUp(
    message: string,
    options?: { images?: readonly ImageContent[] },
  ): Promise<ResponseFor<"follow_up">> {
    return this.sendCommand<"follow_up">({
      type: "follow_up",
      message,
      ...(options?.images ? { images: [...options.images] } : {}),
    });
  }

  abort(): Promise<ResponseFor<"abort">> {
    return this.sendCommand<"abort">({ type: "abort" });
  }

  setModel(provider: string, modelId: string): Promise<ResponseFor<"set_model">> {
    return this.sendCommand<"set_model">({ type: "set_model", provider, modelId });
  }

  cycleModel(): Promise<ResponseFor<"cycle_model">> {
    return this.sendCommand<"cycle_model">({ type: "cycle_model" });
  }

  getAvailableModels(): Promise<ResponseFor<"get_available_models">> {
    return this.sendCommand<"get_available_models">({
      type: "get_available_models",
    });
  }

  setThinkingLevel(level: ThinkingLevel): Promise<ResponseFor<"set_thinking_level">> {
    return this.sendCommand<"set_thinking_level">({
      type: "set_thinking_level",
      level,
    });
  }

  getState(): Promise<ResponseFor<"get_state">> {
    return this.sendCommand<"get_state">({ type: "get_state" });
  }

  getMessages(): Promise<ResponseFor<"get_messages">> {
    return this.sendCommand<"get_messages">({ type: "get_messages" });
  }

  getSessionStats(): Promise<ResponseFor<"get_session_stats">> {
    return this.sendCommand<"get_session_stats">({ type: "get_session_stats" });
  }

  getCommands(): Promise<ResponseFor<"get_commands">> {
    return this.sendCommand<"get_commands">({ type: "get_commands" });
  }

  compact(customInstructions?: string): Promise<ResponseFor<"compact">> {
    return this.sendCommand<"compact">({
      type: "compact",
      ...(customInstructions !== undefined ? { customInstructions } : {}),
    });
  }

  fork(entryId: string): Promise<ResponseFor<"fork">> {
    return this.sendCommand<"fork">({ type: "fork", entryId });
  }

  getForkMessages(): Promise<ResponseFor<"get_fork_messages">> {
    return this.sendCommand<"get_fork_messages">({ type: "get_fork_messages" });
  }

  clone(): Promise<ResponseFor<"clone">> {
    return this.sendCommand<"clone">({ type: "clone" });
  }

  newSession(parentSession?: string): Promise<ResponseFor<"new_session">> {
    return this.sendCommand<"new_session">({
      type: "new_session",
      ...(parentSession !== undefined ? { parentSession } : {}),
    });
  }

  bash(
    command: string,
    options?: { excludeFromContext?: boolean },
  ): Promise<ResponseFor<"bash">> {
    return this.sendCommand<"bash">({
      type: "bash",
      command,
      ...(options?.excludeFromContext !== undefined
        ? { excludeFromContext: options.excludeFromContext }
        : {}),
    });
  }

  abortBash(): Promise<ResponseFor<"abort_bash">> {
    return this.sendCommand<"abort_bash">({ type: "abort_bash" });
  }

  // ───────────────────────── 生命周期收尾 ─────────────────────────

  /** 退出/崩溃/spawn 失败的统一收尾:置状态、记退出信息、拒绝待决、发 exit 信号。 */
  private finalize(
    code: number | null,
    signal: string | null,
    rejectionError: Error,
  ): void {
    if (this.status === "exited") return;
    this.status = "exited";
    this.exitCode = code;
    this.exitSignal = signal;

    // dev 热重载:终态时注销 watcher 目标(幂等)。
    this.hotReloadUnregister?.();

    this.rejectAllPending(rejectionError);
    this.pendingExtensionUI.clear();

    const info: ExitInfo = { code, signal };
    for (const cb of this.exitListeners) cb(info);
  }

  /** 拒绝并清空全部待决命令(Req 6.2 / 6.3)。 */
  private rejectAllPending(error: Error): void {
    for (const [, pending] of this.pendingCommands) {
      pending.reject(error);
    }
    this.pendingCommands.clear();
  }
}
