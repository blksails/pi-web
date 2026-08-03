/**
 * session-meta — `SessionMetaIndex` 的集中 JSON 文件实现(spec session-meta-index, Req 3.x/4.x/5.x)。
 *
 * 形态由 discovery 定夺:**全机器一份**索引文件,按 sessionId 归键 —— 列表一次读取即得全页
 * 元数据,不必 per-item 顺读 jsonl。
 *
 * ★ 索引落在 `~/.pi/agent/sessions/` **之外**(默认 `~/.pi/agent/piweb-session-index.json`)。
 *   fs 后端的 listDir 只认 `.jsonl` 结尾、放进去也不会被本项目误读,但 pi CLI 对那个目录的
 *   扫描行为不在我们控制内 —— 放在目录外是零污染的选择(Req 9.1/9.2)。
 *
 * ★ 集中式的代价是**并发写**:写者包括多个 pi-web 实例、桌面版、以及 CLI 直开的会话。整文件
 *   替换语义下「最后写者赢」丢的是**别人刚写入的键**。故写路径一律:
 *      取跨进程互斥 → 读并解析 → 在内存合并 → 写临时文件 → rename 原子替换 → 释放锁
 *   合并发生在**锁内**,因此并发写不同会话不会互相覆盖(Req 4.1);`rename` 保证读者只看到旧或
 *   新的完整内容(Req 4.2);抢锁超时即放弃本次写入(Req 4.3)。
 *
 * ★ 全部方法**绝不抛出**(端口契约):任何失败都退化为「无元数据」,绝不影响会话列出与恢复(Req 3.5)。
 *
 * 零新增依赖:互斥用 `mkdir` 的原子性实现(内核包不得引入第三方依赖)。
 */
import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, join } from "node:path";
import { createLogger } from "@blksails/pi-web-logger";
import type { SessionMetaEntry, SessionMetaIndex } from "./types.js";

// 命名空间 session:meta —— 元数据索引的降级路径(全部 debug 级:fail-soft 若不可观测,
// 缺口与「本来就没元数据」长得一模一样)。
const log = createLogger({ namespace: "session:meta" });

/** 索引文件格式版本。不认识的版本按「不可用」处理,下次写入时重建(Req 3.2/3.4)。 */
const INDEX_VERSION = 1;

/** 抢锁总预算(毫秒)。超出即放弃本次写入(Req 4.3)。 */
const LOCK_TIMEOUT_MS = 2_000;
/** 抢锁轮询间隔(毫秒)。 */
const LOCK_RETRY_MS = 25;
/** 锁被认定为陈旧的年龄(毫秒)——覆盖持锁进程崩溃未释放的情形。 */
const LOCK_STALE_MS = 10_000;

/**
 * 默认索引路径:`<agentDir>/piweb-session-index.json`(**不在** sessions 目录内)。
 *
 * ★ 必须跟随 `PI_WEB_AGENT_DIR`(与 config-codec / local-workspace 同一惯例),不能直接取
 *   `homedir()` —— 否则 e2e 与测试虽把 `PI_WEB_AGENT_DIR` 指到临时目录,索引仍会写进
 *   **用户真实的** `~/.pi/agent/`。这不是理论风险:本 spec 开发期间就已经在真实目录里
 *   留下了索引文件与多个原子写的 `.tmp` 残留。
 */
export function defaultSessionMetaIndexPath(
  env: NodeJS.ProcessEnv = process.env,
): string {
  const agentDir = env["PI_WEB_AGENT_DIR"];
  const root =
    agentDir !== undefined && agentDir.trim().length > 0
      ? agentDir
      : join(homedir(), ".pi", "agent");
  return join(root, "piweb-session-index.json");
}

/** 解析索引路径:env 覆盖优先,否则默认路径。 */
export function sessionMetaIndexPathFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): string {
  const override = env["PI_WEB_SESSION_META_INDEX_PATH"];
  return override !== undefined && override.length > 0
    ? override
    : defaultSessionMetaIndexPath(env);
}

/** 磁盘格式:`{ v, sessions }`。 */
interface IndexFile {
  readonly v: number;
  readonly sessions: Record<string, SessionMetaEntry>;
}

/** 取可选字符串字段;类型不符即视为缺省(**只丢该字段**,不丢整条,Req 3.3)。 */
function optionalString(
  raw: Record<string, unknown>,
  key: string,
  sessionId: string,
): string | undefined {
  const v = raw[key];
  if (v === undefined) return undefined;
  if (typeof v === "string" && v.length > 0) return v;
  log.debug("index entry field dropped", { sessionId, field: key });
  return undefined;
}

/** 逐字段校验单条目;全字段都不可用时返回 undefined(该键视为无元数据)。 */
function parseEntry(
  value: unknown,
  sessionId: string,
): SessionMetaEntry | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    log.debug("index entry dropped: not an object", { sessionId });
    return undefined;
  }
  const raw = value as Record<string, unknown>;
  const title = optionalString(raw, "title", sessionId);
  const agentSource = optionalString(raw, "agentSource", sessionId);
  const updatedAt = optionalString(raw, "updatedAt", sessionId);
  if (title === undefined && agentSource === undefined && updatedAt === undefined) {
    return undefined;
  }
  return {
    ...(title !== undefined ? { title } : {}),
    ...(agentSource !== undefined ? { agentSource } : {}),
    ...(updatedAt !== undefined ? { updatedAt } : {}),
  };
}

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

export interface JsonFileSessionMetaIndexOptions {
  /** 索引文件路径;省略时经 env / 默认路径解析。 */
  readonly path?: string;
  /** 抢锁总预算(毫秒);省略用 2000。测试可调小。 */
  readonly lockTimeoutMs?: number;
  /** 时间源(测试可注入确定性实现)。 */
  readonly now?: () => Date;
}

export class JsonFileSessionMetaIndex implements SessionMetaIndex {
  readonly #path: string;
  readonly #lockDir: string;
  readonly #tmpPath: string;
  readonly #lockTimeoutMs: number;
  readonly #now: () => Date;

  constructor(opts: JsonFileSessionMetaIndexOptions = {}) {
    this.#path = opts.path ?? sessionMetaIndexPathFromEnv();
    this.#lockDir = `${this.#path}.lock`;
    this.#tmpPath = `${this.#path}.${process.pid}.tmp`;
    this.#lockTimeoutMs = opts.lockTimeoutMs ?? LOCK_TIMEOUT_MS;
    this.#now = opts.now ?? ((): Date => new Date());
  }

  /** 索引文件路径(诊断/测试用)。 */
  get path(): string {
    return this.#path;
  }

  /**
   * 清理本目录下遗留的原子写临时文件(`<索引名>.<pid>.tmp`)。
   *
   * 为什么需要:`#writeAtomically` 是「写 tmp → rename」两步,进程若在两步之间被杀
   * (e2e 收尾 kill、Ctrl-C、崩溃),tmp 就永久留在那儿。单个残留无害(读路径只认索引本身),
   * 但会随时间累积成一堆垃圾文件 —— 本 spec 开发期间就在真实目录里留下了 7 个。
   *
   * 只删**本索引**的 tmp(前缀匹配),不碰同目录其它文件。失败静默。
   */
  async cleanupStaleTemps(): Promise<number> {
    const dir = dirname(this.#path);
    const prefix = `${basename(this.#path)}.`;
    let removed = 0;
    try {
      for (const name of await readdir(dir)) {
        if (!name.startsWith(prefix) || !name.endsWith(".tmp")) continue;
        try {
          await rm(join(dir, name), { force: true });
          removed += 1;
        } catch {
          /* 删不掉就留着,不影响正确性 */
        }
      }
    } catch {
      /* 目录不存在等 —— 无事可做 */
    }
    if (removed > 0) log.debug("removed stale index temp files", { dir, removed });
    return removed;
  }

  async read(
    sessionIds?: readonly string[],
  ): Promise<ReadonlyMap<string, SessionMetaEntry>> {
    const all = await this.#readMap();
    if (sessionIds === undefined) return all;
    // 整份存储读全量本就最优,但**语义必须与分键实现一致**:给了 ids 就只返回这些。
    // (一致性套件会抓这条 —— 端口若两边行为不同,调用方就无法依赖它。)
    const want = new Set(sessionIds);
    const out = new Map<string, SessionMetaEntry>();
    for (const [id, entry] of all) if (want.has(id)) out.set(id, entry);
    return out;
  }

  async merge(sessionId: string, patch: SessionMetaEntry): Promise<void> {
    if (sessionId.length === 0) return;
    await this.#mutate((map) => {
      const prev = map.get(sessionId);
      const next: SessionMetaEntry = {
        ...prev,
        ...(patch.title !== undefined ? { title: patch.title } : {}),
        ...(patch.agentSource !== undefined
          ? { agentSource: patch.agentSource }
          : {}),
        updatedAt: patch.updatedAt ?? this.#now().toISOString(),
      };
      map.set(sessionId, next);
      return true;
    });
  }

  async remove(sessionId: string): Promise<void> {
    if (sessionId.length === 0) return;
    await this.#mutate((map) => map.delete(sessionId));
  }

  async prune(existingSessionIds: Iterable<string>): Promise<number> {
    const keep = new Set(existingSessionIds);
    let removed = 0;
    await this.#mutate((map) => {
      for (const id of [...map.keys()]) {
        if (!keep.has(id)) {
          map.delete(id);
          removed += 1;
        }
      }
      return removed > 0;
    });
    return removed;
  }

  // ───────────────────────── 内部:读 / 写 / 锁 ─────────────────────────

  /**
   * 读并解析整份索引。任何失败(不存在 / 不可解析 / 版本不识 / 结构不符)→ 空 Map,
   * 不抛(Req 3.1/3.2)。逐条目校验,坏条目跳过(Req 3.3)。
   */
  async #readMap(): Promise<Map<string, SessionMetaEntry>> {
    const map = new Map<string, SessionMetaEntry>();
    let text: string;
    try {
      text = await readFile(this.#path, "utf8");
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code !== "ENOENT") {
        log.debug("index unreadable", { path: this.#path, code });
      }
      return map;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      log.debug("index unparsable; treating as empty", { path: this.#path });
      return map;
    }
    if (typeof parsed !== "object" || parsed === null) {
      log.debug("index not an object; treating as empty", { path: this.#path });
      return map;
    }
    const file = parsed as Partial<IndexFile>;
    if (file.v !== INDEX_VERSION) {
      log.debug("index version not recognized; treating as empty", {
        path: this.#path,
        version: file.v,
      });
      return map;
    }
    const sessions = file.sessions;
    if (typeof sessions !== "object" || sessions === null) {
      log.debug("index sessions field malformed; treating as empty", {
        path: this.#path,
      });
      return map;
    }
    for (const [sessionId, value] of Object.entries(sessions)) {
      const entry = parseEntry(value, sessionId);
      if (entry !== undefined) map.set(sessionId, entry);
    }
    return map;
  }

  /**
   * 锁内读-改-写。`mutate` 返回 false 表示无变更(跳过写盘)。
   * 抢锁失败或写盘失败 → 放弃本次写入,不抛(Req 4.3 / 3.5)。
   */
  async #mutate(
    mutate: (map: Map<string, SessionMetaEntry>) => boolean,
  ): Promise<void> {
    const acquired = await this.#acquireLock();
    if (!acquired) {
      log.debug("index write skipped: lock busy", { path: this.#path });
      return;
    }
    try {
      const map = await this.#readMap();
      if (!mutate(map)) return;
      await this.#writeAtomically(map);
    } catch (err) {
      log.debug("index write failed", {
        path: this.#path,
        error: err instanceof Error ? err.message : String(err),
      });
    } finally {
      await this.#releaseLock();
    }
  }

  /** 写临时文件后 `rename` 原子替换 —— 读者只会看到旧或新的完整内容(Req 4.2)。 */
  async #writeAtomically(map: Map<string, SessionMetaEntry>): Promise<void> {
    const file: IndexFile = {
      v: INDEX_VERSION,
      sessions: Object.fromEntries(map),
    };
    await mkdir(dirname(this.#path), { recursive: true });
    await writeFile(this.#tmpPath, `${JSON.stringify(file, null, 2)}\n`, "utf8");
    await rename(this.#tmpPath, this.#path);
  }

  /**
   * 跨进程互斥:`mkdir` 在 POSIX/Windows 上均为原子的「存在即失败」——以其作锁,零依赖。
   * 抢不到则轮询至预算耗尽;发现陈旧锁(持有超过 LOCK_STALE_MS)则强行清除后重试一次,
   * 覆盖持锁进程崩溃的情形。
   */
  async #acquireLock(): Promise<boolean> {
    const deadline = Date.now() + this.#lockTimeoutMs;
    let staleCleared = false;
    for (;;) {
      try {
        await mkdir(dirname(this.#path), { recursive: true });
        await mkdir(this.#lockDir);
        return true;
      } catch (err) {
        const code = (err as NodeJS.ErrnoException).code;
        if (code !== "EEXIST") {
          log.debug("lock acquire failed", { path: this.#lockDir, code });
          return false;
        }
        if (!staleCleared && (await this.#isLockStale())) {
          staleCleared = true;
          log.debug("clearing stale index lock", { path: this.#lockDir });
          await rm(this.#lockDir, { recursive: true, force: true }).catch(() => {});
          continue;
        }
        if (Date.now() >= deadline) return false;
        await sleep(LOCK_RETRY_MS);
      }
    }
  }

  async #isLockStale(): Promise<boolean> {
    try {
      const st = await stat(this.#lockDir);
      return Date.now() - st.mtimeMs > LOCK_STALE_MS;
    } catch {
      return false;
    }
  }

  async #releaseLock(): Promise<void> {
    await rm(this.#lockDir, { recursive: true, force: true }).catch(() => {});
  }
}
