/**
 * session-engine — SessionManager:创建编排 + 去注册接线 + SIGTERM 优雅停机。
 *
 * 经 `SessionStore` 接口(非具体实现,Req 9.6)创建/检索/列出/删除会话。
 * `createSession` 校验注入入参(缺则 `MissingInputError`,Req 1.5)、生成 sessionId、
 * 构造 PiSession(注入通道+resolved+`onClosed` 回调)并登记(Req 1.1 / 9.3);不
 * spawn、不解析(仅编排注入依赖,Req 1.4)。去注册由 manager 拥有:注入的
 * `onClosed(id)` 内执行 `store.delete(id)`,使会话经 stop/idle/crash 任一路径进入
 * stopped 时从 store 移除(Req 7.5 / 9.4)。`shutdown()` 停止接受新会话并逐一停止
 * 全部会话,单失败隔离(Req 8.x)。
 */
import { randomUUID } from "node:crypto";
import { PiSession } from "./pi-session.js";
import { MissingInputError } from "./session.errors.js";
import { InMemorySessionStore, type SessionStore } from "./session-store.js";
import type {
  CreateSessionInput,
  SessionId,
} from "./session.types.js";
import type { LoggingConfig } from "@blksails/pi-web-protocol";

export interface SessionManagerOptions {
  /** 注入存储实现;缺省为 InMemorySessionStore(Req 9.6)。 */
  readonly store?: SessionStore;
  /** 全局默认 idle 阈值(毫秒),createSession 可覆盖。 */
  readonly idleMs?: number;
  /** sessionId 生成器(测试可注入确定性实现)。 */
  readonly idFactory?: () => SessionId;
  /**
   * 服务端权威日志门控配置提供器（Req 6.4/6.5/6.6 / task 4.4）。
   * 每次 createSession 时透传给 PiSession；省略时 PiSession 使用安全默认（全开）。
   */
  readonly loggingConfigProvider?: () => Promise<LoggingConfig>;
  /**
   * 会话就绪握手开关(spec session-readiness-handshake);透传给每个 PiSession。
   * 默认关(向后兼容);生产 app 接线开启。
   */
  readonly readinessHandshake?: boolean;
  /** 就绪探针超时(毫秒),透传给 PiSession;省略用 PiSession 默认。 */
  readonly readinessProbeTimeoutMs?: number;
  /**
   * 权威快照开关(session-snapshot-authority);透传给每个 PiSession。
   * 默认关(向后兼容);生产 app 接线开启。
   */
  readonly snapshotAuthority?: boolean;
}

export class SessionManager {
  private readonly store: SessionStore;
  private readonly idleMs: number | undefined;
  private readonly idFactory: () => SessionId;
  private readonly loggingConfigProvider: (() => Promise<LoggingConfig>) | undefined;
  private readonly readinessHandshake: boolean;
  private readonly readinessProbeTimeoutMs: number | undefined;
  private readonly snapshotAuthority: boolean;
  private acceptingNew = true;

  constructor(opts: SessionManagerOptions = {}) {
    this.store = opts.store ?? new InMemorySessionStore();
    this.idleMs = opts.idleMs;
    this.idFactory = opts.idFactory ?? (() => randomUUID());
    this.loggingConfigProvider = opts.loggingConfigProvider;
    this.readinessHandshake = opts.readinessHandshake ?? false;
    this.readinessProbeTimeoutMs = opts.readinessProbeTimeoutMs;
    this.snapshotAuthority = opts.snapshotAuthority ?? false;
  }

  /** 暴露存储(供上层经接口检索/列出)。 */
  getStore(): SessionStore {
    return this.store;
  }

  /**
   * 用 resolved + channel 创建会话(Req 1.1)。缺任一入参抛 MissingInputError
   * (Req 1.5);停机期间拒绝新建(Req 8.1)。
   */
  createSession(input: CreateSessionInput): {
    sessionId: SessionId;
    session: PiSession;
  } {
    if (!this.acceptingNew) {
      throw new Error("SessionManager is shutting down; not accepting new sessions.");
    }
    if (input === null || typeof input !== "object") {
      throw new MissingInputError("input");
    }
    if (!input.resolved) {
      throw new MissingInputError("resolved");
    }
    if (!input.channel) {
      throw new MissingInputError("channel");
    }

    const sessionId = input.id ?? this.idFactory();
    const idleMs = input.idleMs ?? this.idleMs;
    const session = new PiSession({
      id: sessionId,
      resolved: input.resolved,
      channel: input.channel,
      ...(idleMs !== undefined ? { idleMs } : {}),
      // 日志门控:从 manager 透传 provider（Req 6.4/6.5/6.6 / task 4.4）。
      ...(this.loggingConfigProvider !== undefined
        ? { loggingConfigProvider: this.loggingConfigProvider }
        : {}),
      // 就绪握手:从 manager 透传开关与探针超时(spec session-readiness-handshake)。
      readinessHandshake: this.readinessHandshake,
      ...(this.readinessProbeTimeoutMs !== undefined
        ? { readinessProbeTimeoutMs: this.readinessProbeTimeoutMs }
        : {}),
      // 权威快照:从 manager 透传开关(session-snapshot-authority)。
      snapshotAuthority: this.snapshotAuthority,
      // 去注册接缝:会话进入 stopped 时由 manager 从 store 移除(Req 7.5 / 9.4)。
      onClosed: (id) => {
        this.store.delete(id);
      },
    });

    this.store.create(session);
    return { sessionId, session };
  }

  /** 是否仍接受新会话创建。 */
  isAccepting(): boolean {
    return this.acceptingNew;
  }

  /**
   * SIGTERM 优雅停机(Req 8.x):停止接受新会话,逐一停止全部会话(广播 end + 关通道),
   * 单会话失败被隔离继续;完成后 store 为空且无残留挂起。
   */
  async shutdown(): Promise<void> {
    this.acceptingNew = false;
    const sessions = this.store.list();
    await Promise.all(
      sessions.map(async (s) => {
        try {
          await s.stop("shutdown");
        } catch {
          // 隔离单会话停止失败,不中止整体停机(Req 8.4)。
        }
      }),
    );
  }
}
