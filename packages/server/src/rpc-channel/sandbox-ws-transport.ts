/**
 * SandboxWsTransport — `RpcTransport` 的 e2b 沙盒 **WS-runner 数据面** 实现。
 *
 * 与 `E2bTransport`(e2b-native,数据面走 SDK `commands.run` + envd)的差异:
 * **控制面相同**(e2b SDK `Sandbox.create` / `kill` 起/销沙箱),但**数据面**改为经
 * WebSocket 连接沙箱内一个长驻 **agent-runner**(监听 runnerPort),用其私有线协议桥接
 * `pi --mode rpc` 子进程的 stdin/stdout。
 *
 * 为什么需要它:开源 agent-sandbox / 阿里云 ACS ack-sandbox-manager 的运行时**没有 e2b envd**,
 * 故 `commands.run` 在其上不可用;它们的模型是「镜像内打进 runner + 暴露端口 + WS 连入」。
 * 本传输让 pi-web 在这类后端上跑通完整 agent 闭环,而 `PiRpcSession` 会话核心/前端/协议无感。
 *
 * agent-runner 线协议(与 pi-clouds `@pi-clouds/sandbox` 的 AgentRunner 一致;pi-web 不依赖
 * pi-clouds——依赖方向相反——故在此独立实现):
 *  - 客户端 → runner:`{type:"hello",lastSeq?}`(请求补发+健康)/`{type:"line",line}`(写子进程 stdin)/
 *    `{type:"configure",env?}`(触发子进程 spawn 并注入 env,如 provider 凭据)。
 *  - runner → 客户端:`{type:"line",seq,line}`(子进程 stdout 一行)/`{type:"health",alive,exitCode,signal}`/
 *    `{type:"log",line}`(子进程 stderr)。
 *  - 断线自动重连并携 `lastSeq` 请求补发,不丢已确认之后的行。
 *
 * 端点解析(两种后端):
 *  - **manager-path**(agent-sandbox/ACS,`wsBase` 已配):`${wsBase}/sandbox/${sandboxId}/?port=${runnerPort}`
 *    (manager 按路径路由到沙箱端口)。
 *  - **e2b-host**(真实 e2b 云,`wsBase` 未配):`wss://${sandbox.getHost(runnerPort)}`。
 *
 * e2b SDK 懒加载(见 `e2b-transport.ts` 同款 jiti 注释)。
 */
import type { Sandbox } from "e2b";
import type { SpawnSpec } from "@blksails/pi-web-protocol";
import type { ChannelHealth, Unsubscribe } from "./pi-rpc-channel.js";
import type { ExitInfo } from "./pi-rpc-process.js";
import type { RpcTransport } from "./transport.js";
import { SpawnError, ChildCrashError } from "./pi-rpc-process.errors.js";

export interface SandboxWsTransportConfig {
  /** e2b API key(仅服务端读)。 */
  readonly apiKey: string;
  /** e2b template id(镜像须内置 agent-runner,监听 runnerPort)。 */
  readonly template: string;
  /** 沙盒超时(毫秒)。 */
  readonly timeoutMs?: number;
  /** e2b 控制面域名(自托管/ACS 端点;SDK `domain`)。 */
  readonly domain?: string;
  /** e2b 控制面 API URL(自托管/ACS;SDK `apiUrl`,e2b 2.33 亦读 E2B_API_URL env)。 */
  readonly apiUrl?: string;
  /** 是否校验 API key 为 `e2b_`+hex 格式(自托管 sys-* token 须 false)。 */
  readonly validateApiKey?: boolean;
  /** 沙箱内 agent-runner 监听端口(默认 8080,满足 agent-sandbox 的 tcpSocket:8080 探针)。 */
  readonly runnerPort?: number;
  /**
   * manager-path 模式的 WS base(如 `ws://127.0.0.1:10000`)。配置时走
   * `${wsBase}/sandbox/${sandboxId}/?port=${runnerPort}`(agent-sandbox/ACS 路由);
   * 未配置时走 e2b-host 模式 `wss://${sandbox.getHost(runnerPort)}`(真实 e2b 云)。
   */
  readonly wsBase?: string;
  /** 断线重连等待(毫秒),默认 300。 */
  readonly reconnectDelayMs?: number;
  /** 从 spawnSpec.env 透传到 runner(经 configure 帧)的键白名单(如 provider 凭据);默认空。 */
  readonly envPassthrough?: readonly string[];
}

/** runner → 客户端消息(判别联合)。 */
interface ServerLineMessage {
  readonly type: "line";
  readonly seq: number;
  readonly line: string;
}
interface ServerHealthMessage {
  readonly type: "health";
  readonly alive: boolean;
  readonly exitCode: number | null;
  readonly signal: string | null;
}
interface ServerLogMessage {
  readonly type: "log";
  readonly line: string;
}
type ServerMessage = ServerLineMessage | ServerHealthMessage | ServerLogMessage;

/** 客户端 → runner 消息。 */
type ClientMessage =
  | { readonly type: "hello"; readonly lastSeq?: number }
  | { readonly type: "line"; readonly line: string }
  | { readonly type: "configure"; readonly env?: Readonly<Record<string, string>> };

export class SandboxWsTransport implements RpcTransport {
  readonly #spawnSpec: SpawnSpec;
  readonly #cfg: SandboxWsTransportConfig;
  readonly #reconnectDelayMs: number;
  #sandbox: Sandbox | null = null;
  #ready: Promise<void>;
  #socket: WebSocket | null = null;
  #socketOpen = false;
  #lastSeq = 0;
  #outbox: string[] = [];
  #configured = false;
  #lineListeners = new Set<(line: string) => void>();
  #stderrListeners = new Set<(chunk: string) => void>();
  #exitListeners = new Set<(info: ExitInfo) => void>();
  #spawnListeners = new Set<() => void>();
  #childHealth: ChannelHealth = { alive: true, exitCode: null, signal: null };
  #alive = false;
  #exitInfo: ExitInfo | null = null;
  #closed = false;
  #reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(spawnSpec: SpawnSpec, cfg: SandboxWsTransportConfig) {
    this.#spawnSpec = spawnSpec;
    this.#cfg = cfg;
    this.#reconnectDelayMs = cfg.reconnectDelayMs ?? 300;
    this.#ready = this.#boot();
    // 防 boot 拒绝变 unhandledRejection(错误已经 onExit 传播)。
    void this.#ready.catch(() => {});
  }

  async #boot(): Promise<void> {
    try {
      // 懒加载 e2b(见 e2b-transport.ts 顶部 jiti 注释)。
      const { Sandbox } = await import("e2b");
      // envPassthrough 过滤后的键既作**沙箱容器 env**(Sandbox.create envs,供镜像 entrypoint
      // 读取,如 pi 镜像把 DASHSCOPE_API_KEY 写进 models.json),又经 configure 帧注入 runner
      // spawn 的子进程 env(双通道:容器级 + 进程级,覆盖不同镜像的注入约定)。
      const passthrough = this.#buildEnv();
      const sbx = await Sandbox.create(this.#cfg.template, {
        apiKey: this.#cfg.apiKey,
        ...(this.#cfg.timeoutMs !== undefined ? { timeoutMs: this.#cfg.timeoutMs } : {}),
        ...(this.#cfg.domain !== undefined ? { domain: this.#cfg.domain } : {}),
        ...(this.#cfg.apiUrl !== undefined ? { apiUrl: this.#cfg.apiUrl } : {}),
        ...(this.#cfg.validateApiKey !== undefined
          ? { validateApiKey: this.#cfg.validateApiKey }
          : {}),
        ...(Object.keys(passthrough).length > 0 ? { envs: passthrough } : {}),
      });
      this.#sandbox = sbx;
      this.#alive = true;
      this.#connect(this.#endpointFor(sbx));
    } catch (err) {
      this.#alive = false;
      this.#exitInfo = { code: null, signal: null };
      const message = err instanceof Error ? err.message : String(err);
      const wrapped = new SpawnError(`e2b 沙盒启动失败:${message}`, err);
      for (const cb of this.#exitListeners) this.#safe(() => cb(this.#exitInfo as ExitInfo));
      throw wrapped;
    }
  }

  #endpointFor(sbx: Sandbox): string {
    const port = this.#cfg.runnerPort ?? 8080;
    if (this.#cfg.wsBase !== undefined && this.#cfg.wsBase !== "") {
      // manager-path(agent-sandbox / ACS ack-sandbox-manager):按**沙箱 name** 路径路由到端口。
      // agent-sandbox 命名约定:name = `sbx-{template}-{sandboxId 前 20 位}`(e2b SDK 返回的
      // `sandboxId` 是完整 32 位 id,路由用的是这个派生 name,不是完整 id)。
      // 派生名截断到 63 字符:与 agent-sandbox manager(0.6.0)创建沙箱时对实际 sandbox 名的
      // K8s 63 字符对象名截断保持**镜像语义**(Pod 的 sandbox label 即截断名)。长模板(如烘焙
      // 模板派生名 71-76 字符)若用全长名路由,manager 返回 502 "failed to acquire destination
      // ip … pod not found",就绪探针超时挂死。实证见
      // .kiro/specs/sandbox-baked-agent-image/evidence/e2e-blocked-run-probe-timeout.log。
      const base = this.#cfg.wsBase.replace(/\/$/, "");
      const name = `sbx-${this.#cfg.template}-${sbx.sandboxId.slice(0, 20)}`.slice(0, 63);
      return `${base}/sandbox/${name}/?port=${port}`;
    }
    // e2b-host(真实 e2b 云 / ACS ALB ingress):getHost 子域(`{port}-{完整id}.{domain}`)。
    return `wss://${sbx.getHost(port)}`;
  }

  // ── WS 数据面 ─────────────────────────────────────────
  #connect(endpoint: string): void {
    if (this.#closed) return;
    const socket = new WebSocket(endpoint);
    this.#socket = socket;
    socket.onopen = () => {
      this.#socketOpen = true;
      // 补发请求 + 首次触发子进程 spawn(configure,注入 provider 凭据)。
      this.#sendRaw({ type: "hello", lastSeq: this.#lastSeq });
      if (!this.#configured) {
        this.#configured = true;
        const env = this.#buildEnv();
        this.#sendRaw({
          type: "configure",
          ...(Object.keys(env).length > 0 ? { env } : {}),
        });
      }
      this.#flushOutbox();
      // runner 就绪(供就绪握手)。
      for (const cb of this.#spawnListeners) this.#safe(cb);
    };
    socket.onmessage = (ev: MessageEvent) => this.#onServerMessage(ev.data);
    socket.onclose = () => {
      this.#socketOpen = false;
      this.#scheduleReconnect(endpoint);
    };
    socket.onerror = () => {
      // ws 的 close 会在 error 后触发,重连在那里安排。
    };
  }

  #scheduleReconnect(endpoint: string): void {
    if (this.#closed || this.#reconnectTimer) return;
    this.#reconnectTimer = setTimeout(() => {
      this.#reconnectTimer = null;
      this.#connect(endpoint);
    }, this.#reconnectDelayMs);
  }

  #onServerMessage(raw: unknown): void {
    let msg: ServerMessage;
    try {
      const text = typeof raw === "string" ? raw : String(raw);
      msg = JSON.parse(text) as ServerMessage;
    } catch {
      return;
    }
    if (msg.type === "line") {
      if (msg.seq > this.#lastSeq) this.#lastSeq = msg.seq;
      for (const cb of this.#lineListeners) this.#safe(() => cb(msg.line));
      return;
    }
    if (msg.type === "health") {
      this.#childHealth = {
        alive: msg.alive,
        exitCode: msg.exitCode,
        signal: msg.signal,
      };
      // 子进程退出 → 传播 onExit(会话核心据此拒绝待决命令)。
      if (!msg.alive) {
        this.#exitInfo = { code: msg.exitCode, signal: msg.signal };
        for (const cb of this.#exitListeners) this.#safe(() => cb(this.#exitInfo as ExitInfo));
      }
      return;
    }
    // log:子进程 stderr → onStderr(fd1 铁律:绝不混入 onLine)。
    for (const cb of this.#stderrListeners) this.#safe(() => cb(msg.line + "\n"));
  }

  #buildEnv(): Record<string, string> {
    const out: Record<string, string> = {};
    const src = this.#spawnSpec.env ?? {};
    for (const key of this.#cfg.envPassthrough ?? []) {
      const v = src[key];
      if (typeof v === "string") out[key] = v;
    }
    return out;
  }

  #sendRaw(msg: ClientMessage): void {
    const s = this.#socket;
    if (s && this.#socketOpen) s.send(JSON.stringify(msg));
  }

  #flushOutbox(): void {
    const pending = this.#outbox;
    this.#outbox = [];
    for (const line of pending) this.#sendRaw({ type: "line", line });
  }

  #safe(fn: () => void): void {
    try {
      fn();
    } catch {
      /* 隔离监听器抛错 */
    }
  }

  // ── RpcTransport 端口 ─────────────────────────────────
  send(line: string): void {
    if (this.#closed) return;
    if (this.#socketOpen) this.#sendRaw({ type: "line", line });
    else this.#outbox.push(line); // 未连时缓冲,连上后 flush
  }

  onLine(cb: (line: string) => void): Unsubscribe {
    this.#lineListeners.add(cb);
    return () => this.#lineListeners.delete(cb);
  }

  onStderr(cb: (chunk: string) => void): Unsubscribe {
    this.#stderrListeners.add(cb);
    return () => this.#stderrListeners.delete(cb);
  }

  onExit(cb: (info: ExitInfo) => void): Unsubscribe {
    this.#exitListeners.add(cb);
    return () => this.#exitListeners.delete(cb);
  }

  onSpawn(cb: () => void): Unsubscribe {
    this.#spawnListeners.add(cb);
    return () => this.#spawnListeners.delete(cb);
  }

  async close(): Promise<void> {
    if (this.#closed) return;
    this.#closed = true;
    this.#alive = false;
    if (this.#reconnectTimer) {
      clearTimeout(this.#reconnectTimer);
      this.#reconnectTimer = null;
    }
    try {
      const s = this.#socket;
      if (s && s.readyState !== WebSocket.CLOSED) s.close();
      if (this.#sandbox) await this.#sandbox.kill();
    } catch (err) {
      throw new ChildCrashError(
        null,
        null,
        `e2b 沙盒关闭异常:${err instanceof Error ? err.message : String(err)}`,
      );
    } finally {
      this.#exitInfo ??= { code: 0, signal: null };
      for (const cb of this.#exitListeners) this.#safe(() => cb(this.#exitInfo as ExitInfo));
    }
  }

  health(): ChannelHealth {
    return {
      alive: this.#alive && this.#childHealth.alive && this.#socketOpen && !this.#closed,
      exitCode: this.#exitInfo?.code ?? this.#childHealth.exitCode,
      signal: this.#exitInfo?.signal ?? this.#childHealth.signal,
    };
  }

  /** 暴露就绪 Promise 供集成测试/装配层等待沙盒起好并连上 runner(可选)。 */
  ready(): Promise<void> {
    return this.#ready;
  }
}
