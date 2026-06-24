/**
 * session-engine — SessionStore 接口与 InMemorySessionStore 内存实现。
 *
 * 会话注册/检索经此接口外置(§14.1② 接缝),会话逻辑只依赖接口而非实现(Req 9.6)。
 * 内存实现以 `sessionId` 为键的 Map,挂 `globalThis` 抗 dev 热重载;`get` 未命中返回
 * `undefined`(明确"未找到",Req 9.5)。不负责会话停止本身,仅登记/移除。
 */
import type { PiSession } from "./pi-session.js";
import type { SessionId } from "./session.types.js";

/** 会话注册检索接口(Req 9.1)。 */
export interface SessionStore {
  /** 以 session.id 登记一个会话。 */
  create(session: PiSession): void;
  /** 按 id 检索;未找到返回 undefined(Req 9.5)。 */
  get(id: SessionId): PiSession | undefined;
  /** 移除登记,返回此前是否存在。 */
  delete(id: SessionId): boolean;
  /** 当前所有会话(供优雅停机遍历)。 */
  list(): readonly PiSession[];
}

/** 挂 globalThis 的单机 Map,抗 Next dev 热重载(PLAN §3.2)。 */
const GLOBAL_KEY = Symbol.for("@blksails/server:InMemorySessionStore");

interface GlobalWithStore {
  [GLOBAL_KEY]?: Map<SessionId, PiSession>;
}

function sharedMap(): Map<SessionId, PiSession> {
  const g = globalThis as unknown as GlobalWithStore;
  if (!g[GLOBAL_KEY]) {
    g[GLOBAL_KEY] = new Map<SessionId, PiSession>();
  }
  return g[GLOBAL_KEY];
}

/** 单机默认内存实现(Req 9.2)。 */
export class InMemorySessionStore implements SessionStore {
  private readonly map: Map<SessionId, PiSession>;

  /**
   * @param isolated 为 true 时使用独立 Map(测试隔离用),否则共享 globalThis Map。
   */
  constructor(isolated = false) {
    this.map = isolated ? new Map<SessionId, PiSession>() : sharedMap();
  }

  create(session: PiSession): void {
    this.map.set(session.id, session);
  }

  get(id: SessionId): PiSession | undefined {
    return this.map.get(id);
  }

  delete(id: SessionId): boolean {
    return this.map.delete(id);
  }

  list(): readonly PiSession[] {
    return [...this.map.values()];
  }
}
