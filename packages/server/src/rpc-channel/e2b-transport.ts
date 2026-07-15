/**
 * E2bTransport — `RpcTransport` 的 e2b 云沙盒实现。
 *
 * 把「发送/逐行接收/stderr/退出/关闭/健康」映射到 e2b 沙盒内一个长驻 runner 进程的
 * stdin/stdout。会话核心 `PiRpcSession` 消费本传输,对上产出完整 `SessionChannel`,
 * 因此 agent 在云沙盒里运行而前端/协议/组合根无感。
 *
 * 与本地 child_process 的关键差异:
 *  - `Sandbox.create` 为**异步**启动(本地 spawn 同步返回)。构造即触发 `#boot()`,
 *    `send()` 在就绪前进 outbox 缓冲,就绪后 flush。
 *  - 沙盒内路径/可执行文件与本地 `SpawnSpec` 不同。PoC 不直接用 `spawnSpec.cmd/cwd`
 *    (那是本地 node/agent 绝对路径),而在 template 预装 pi + agent 源,沙盒内跑
 *    `runnerCmd`(默认 `pi --mode rpc`,即 pi-web dual-mode 的 fallback)于 `sandboxCwd`。
 *  - fd1 铁律:onStdout 经 `JsonlLineReader` 分帧只喂 `onLine`;stderr 只喂 `onStderr`。
 *
 * 二期锚点:用 `sbx.files.write` 投递任意 agent 源、用 `spawnSpec` 真实命令、附件共享、
 * 保活/断线重连、多会话沙盒复用。本类接口不需为二期推翻。
 *
 * e2b SDK 契约(e2b@^2.33.0,事实源为 node_modules d.ts):
 *  - `Sandbox.create(template, { apiKey, timeoutMs, envs })` → `Promise<Sandbox>`。
 *  - `sbx.commands.run(cmd, { background: true, stdin: true, cwd, envs, onStdout, onStderr })`
 *    → `Promise<CommandHandle>`(后台命令;**必须** `stdin: true` 才能后续写 stdin)。
 *  - `CommandHandle` 暴露 `pid`、`sendStdin(data)`、`kill()`。
 *  - `sbx.kill()` 销毁沙盒。
 */
// ⚠ e2b SDK **只在 #boot() 里懒加载**(`await import("e2b")`),不在模块顶层 import。
// 原因:e2b@2.33 的模块初始化(getRuntime 读 platform.default.version)在 jiti 运行时
// (dev server 走 `--import jiti/register`)下会抛,顶层 import 会让**整个 rpc-channel barrel**
// 在 jiti 下加载即崩——哪怕根本没用 e2b 传输。懒加载使 e2b 仅在 PI_WEB_TRANSPORT=e2b 真正
// 起 E2bTransport 时才 load,默认/local/stub 路径零影响。类型 import 为纯类型(运行时擦除,安全)。
import type { CommandHandle, Sandbox } from "e2b";
import type { SpawnSpec } from "@blksails/pi-web-protocol";
import type { ChannelHealth, Unsubscribe } from "./pi-rpc-channel.js";
import type { ExitInfo } from "./pi-rpc-process.js";
import type { RpcTransport } from "./transport.js";
import { JsonlLineReader } from "./jsonl-reader.js";
import { ChildCrashError, SpawnError } from "./pi-rpc-process.errors.js";

export interface E2bTransportConfig {
  /** e2b API key(仅服务端读)。 */
  readonly apiKey: string;
  /** e2b template id(预装 node + pi + agent 源)。 */
  readonly template: string;
  /** 沙盒超时(毫秒),默认 e2b 缺省。 */
  readonly timeoutMs?: number;
  /** 沙盒内启动 runner 的命令,默认 `pi --mode rpc`。 */
  readonly runnerCmd?: string;
  /** 沙盒内 agent 工作目录,默认 template 约定。 */
  readonly sandboxCwd?: string;
  /** 从 spawnSpec.env 透传到沙盒的键白名单(如 provider 凭据);默认空。 */
  readonly envPassthrough?: readonly string[];
  /**
   * e2b 控制面域名(SDK `domain`;默认 `E2B_DOMAIN` env 或 `e2b.app`)。
   * 指向自托管/ACS 兼容端点(如 `ack-sandbox-manager`/开源 agent-sandbox)时设置。
   */
  readonly domain?: string;
  /**
   * 是否让 e2b SDK 校验 API key 必须为 `e2b_`+hex 格式(SDK `validateApiKey`,默认 true)。
   * 自托管/ACS 后端用非 `e2b_` 前缀的 token(如 agent-sandbox 的 `sys-*` SYSTEM_TOKEN)时须设 `false`,
   * 否则 SDK 在发请求前即以「Invalid API key format」拒绝。指向真实 e2b 云时保持默认(不设)。
   */
  readonly validateApiKey?: boolean;
}

export class E2bTransport implements RpcTransport {
  readonly #spawnSpec: SpawnSpec;
  readonly #cfg: E2bTransportConfig;
  readonly #reader = new JsonlLineReader();
  #sandbox: Sandbox | null = null;
  #command: CommandHandle | null = null;
  #ready: Promise<void>;
  #outbox: string[] = [];
  #lineListeners = new Set<(line: string) => void>();
  #stderrListeners = new Set<(chunk: string) => void>();
  #exitListeners = new Set<(info: ExitInfo) => void>();
  #spawnListeners = new Set<() => void>();
  #alive = false;
  #exitInfo: ExitInfo | null = null;
  #closed = false;

  constructor(spawnSpec: SpawnSpec, cfg: E2bTransportConfig) {
    this.#spawnSpec = spawnSpec;
    this.#cfg = cfg;
    this.#ready = this.#boot();
    // boot 失败已经过 onExit 传播到会话核心(拒绝待决命令);此处附一个 no-op catch,
    // 防止无人 await `ready()` 时 boot 的拒绝变成 unhandledRejection 崩主进程。
    void this.#ready.catch(() => {});
  }

  async #boot(): Promise<void> {
    try {
      // ── 懒加载 e2b SDK(见文件顶部注释:避免 jiti 下顶层 import 崩整个 barrel)──
      const { Sandbox } = await import("e2b");
      // ── 起沙盒 ──
      const sbx = await Sandbox.create(this.#cfg.template, {
        apiKey: this.#cfg.apiKey,
        ...(this.#cfg.timeoutMs !== undefined
          ? { timeoutMs: this.#cfg.timeoutMs }
          : {}),
        // 自托管/ACS 端点:域名与 key 格式校验开关(默认走真实 e2b 云)。
        ...(this.#cfg.domain !== undefined ? { domain: this.#cfg.domain } : {}),
        ...(this.#cfg.validateApiKey !== undefined
          ? { validateApiKey: this.#cfg.validateApiKey }
          : {}),
      });
      this.#sandbox = sbx;

      // ── 起 runner(后台常驻,stdin 保持打开,stdout/stderr 回调分流)──
      const cmd = this.#cfg.runnerCmd ?? "pi --mode rpc";
      const handle = await sbx.commands.run(cmd, {
        background: true,
        // stdin: true 是后续 `sendStdin` 生效的前提(e2b 默认关闭 stdin)。
        stdin: true,
        ...(this.#cfg.sandboxCwd !== undefined
          ? { cwd: this.#cfg.sandboxCwd }
          : {}),
        envs: this.#buildEnvs(),
        onStdout: (data: string) => {
          // fd1 铁律:stdout 只承载协议帧,经分帧器逐行喂 onLine。
          for (const line of this.#reader.push(data)) {
            for (const cb of this.#lineListeners) this.#safe(() => cb(line));
          }
        },
        onStderr: (data: string) => {
          for (const cb of this.#stderrListeners) this.#safe(() => cb(data));
        },
      });
      this.#command = handle;
      this.#alive = true;

      // ── flush 就绪前缓冲的发送 ──
      const pending = this.#outbox;
      this.#outbox = [];
      for (const line of pending) this.#writeStdin(line);

      // ── 就绪/重生通知(供就绪握手)──
      for (const cb of this.#spawnListeners) this.#safe(cb);
    } catch (err) {
      this.#alive = false;
      this.#exitInfo = { code: null, signal: null };
      const message = err instanceof Error ? err.message : String(err);
      const wrapped = new SpawnError(`e2b 沙盒启动失败:${message}`, err);
      // 传播到退出监听器,使会话核心统一拒绝待决命令(Req 2.6)。
      for (const cb of this.#exitListeners) {
        this.#safe(() => cb(this.#exitInfo as ExitInfo));
      }
      throw wrapped;
    }
  }

  #buildEnvs(): Record<string, string> {
    const out: Record<string, string> = {};
    const src = this.#spawnSpec.env ?? {};
    for (const key of this.#cfg.envPassthrough ?? []) {
      const v = src[key];
      if (typeof v === "string") out[key] = v;
    }
    return out;
  }

  #writeStdin(line: string): void {
    const cmd = this.#command;
    if (!cmd) return;
    // e2b 后台命令写 stdin(CommandHandle.sendStdin)。以换行结尾保证成帧。
    void cmd
      .sendStdin(line.endsWith("\n") ? line : line + "\n")
      .catch((err: unknown) => {
        for (const cb of this.#stderrListeners) {
          this.#safe(() => cb(`[e2b sendStdin error] ${String(err)}\n`));
        }
      });
  }

  #safe(fn: () => void): void {
    try {
      fn();
    } catch {
      /* 隔离 */
    }
  }

  // ── RpcTransport 端口 ─────────────────────────────────
  send(line: string): void {
    if (this.#closed) return;
    if (this.#command) this.#writeStdin(line);
    else this.#outbox.push(line); // 就绪前缓冲
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
    try {
      const sbx = this.#sandbox;
      const cmd = this.#command;
      // 先 kill runner 进程,再销毁沙盒(避免泄漏计费)。
      if (cmd) await cmd.kill().catch(() => {});
      if (sbx) await sbx.kill();
    } catch (err) {
      throw new ChildCrashError(
        null,
        null,
        `e2b 沙盒关闭异常:${err instanceof Error ? err.message : String(err)}`,
      );
    } finally {
      this.#exitInfo ??= { code: 0, signal: null };
      for (const cb of this.#exitListeners) {
        this.#safe(() => cb(this.#exitInfo as ExitInfo));
      }
    }
  }

  health(): ChannelHealth {
    return {
      alive: this.#alive && !this.#closed,
      exitCode: this.#exitInfo?.code ?? null,
      signal: this.#exitInfo?.signal ?? null,
    };
  }

  /** 暴露就绪 Promise 供集成测试/装配层等待沙盒真正起好(可选)。 */
  ready(): Promise<void> {
    return this.#ready;
  }
}
