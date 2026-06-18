/**
 * session-store-adapters — 文件系统 adapter。
 *
 * 每会话一个 JSONL 文件:首行 header、其后逐行 entry;按 cwd 分桶到与 pi
 * `~/.pi/agent/sessions` 一致的目录命名(Req 10)。append-only 顺序追加、不重写
 * 既有行;每会话一把 promise 链锁保证写入不交错(Req 3.5/4.2/8.3);进程内已见 id
 * 集合实现幂等(Req 3.4/8.2),跨进程并发重复 id 为 best-effort。
 *
 * 行读取按 `\n` 切并剥 `\r`,不使用 Node `readline`(避免误切 U+2028/2029)。
 */
import { createReadStream } from "node:fs";
import { appendFile, mkdir, readdir, stat, unlink, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import {
  bucketDirName,
  makeReadNormalizer,
  parseHeader,
  parseJson,
  parseLine,
  serializeEntry,
  serializeHeader,
  sessionFileName,
} from "./codec.js";
import {
  SessionEntryParseError,
  SessionStoreConflictError,
  SessionStoreNotFoundError,
  type SessionEntry,
  type SessionEntryStore,
  type SessionHeader,
  type SessionMeta,
} from "./types.js";

/** pi 默认会话根目录。 */
export function defaultSessionsRoot(): string {
  return join(homedir(), ".pi", "agent", "sessions");
}

export class FsSessionEntryStore implements SessionEntryStore {
  readonly #root: string;
  /** sessionId → 文件路径(定位缓存)。 */
  readonly #index = new Map<string, string>();
  /** sessionId → 已见 entry id 集合(幂等)。 */
  readonly #seen = new Map<string, Set<string>>();
  /** sessionId → 串行写锁链。 */
  readonly #chain = new Map<string, Promise<unknown>>();

  constructor(root: string = defaultSessionsRoot()) {
    this.#root = root;
  }

  async create(header: SessionHeader): Promise<string> {
    return this.#withLock(header.id, async () => {
      if (await this.#locate(header.id)) throw new SessionStoreConflictError(header.id);
      const bucket = join(this.#root, bucketDirName(header.cwd));
      await mkdir(bucket, { recursive: true });
      const file = join(bucket, sessionFileName(header.timestamp, header.id));
      await writeFile(file, `${serializeHeader(header)}\n`, { encoding: "utf8", flag: "wx" });
      this.#index.set(header.id, file);
      this.#seen.set(header.id, new Set());
      return header.id;
    });
  }

  async append(sessionId: string, entry: SessionEntry): Promise<void> {
    await this.appendBatch(sessionId, [entry]);
  }

  async appendBatch(sessionId: string, entries: readonly SessionEntry[]): Promise<void> {
    await this.#withLock(sessionId, async () => {
      const file = await this.#locate(sessionId);
      if (!file) throw new SessionStoreNotFoundError(sessionId);
      const seen = await this.#ensureSeen(sessionId, file);
      const fresh: SessionEntry[] = [];
      const localSeen = new Set<string>();
      for (const entry of entries) {
        if (seen.has(entry.id) || localSeen.has(entry.id)) continue;
        localSeen.add(entry.id); // 仅同批内去重
        fresh.push(entry);
      }
      if (fresh.length === 0) return;
      const buffer = fresh.map((entry) => `${serializeEntry(entry)}\n`).join("");
      await appendFile(file, buffer, "utf8");
      // 写入成功后才登记到持久 seen——避免写失败污染幂等集合
      for (const entry of fresh) seen.add(entry.id);
    });
  }

  async *read(sessionId: string): AsyncIterable<SessionEntry> {
    const file = await this.#locate(sessionId);
    if (!file) throw new SessionStoreNotFoundError(sessionId);
    let normalize = makeReadNormalizer(3, sessionId);
    let lineIndex = 0;
    for await (const line of this.#streamLines(file)) {
      if (line.length === 0) continue;
      const raw = parseJson(line, lineIndex, sessionId);
      if (raw !== null && typeof raw === "object" && (raw as Record<string, unknown>)["type"] === "session") {
        normalize = makeReadNormalizer(parseHeader(raw, lineIndex).version, sessionId);
      } else {
        yield normalize(raw, lineIndex);
      }
      lineIndex += 1;
    }
  }

  async readHeader(sessionId: string): Promise<SessionHeader> {
    const file = await this.#locate(sessionId);
    if (!file) throw new SessionStoreNotFoundError(sessionId);
    const line = await this.#firstLine(file);
    const parsed = parseLine(line, 0, sessionId);
    if (parsed.type !== "session") throw new SessionEntryParseError({ position: 0, sessionId });
    return parsed;
  }

  async list(cwd: string): Promise<SessionMeta[]> {
    return this.#listDir(join(this.#root, bucketDirName(cwd)));
  }

  async listAll(): Promise<SessionMeta[]> {
    let buckets: string[];
    try {
      buckets = await readdir(this.#root);
    } catch {
      return [];
    }
    const metas: SessionMeta[] = [];
    for (const bucket of buckets) {
      metas.push(...(await this.#listDir(join(this.#root, bucket))));
    }
    metas.sort(byCreatedAt);
    return metas;
  }

  async delete(sessionId: string): Promise<void> {
    await this.#withLock(sessionId, async () => {
      const file = await this.#locate(sessionId);
      if (!file) throw new SessionStoreNotFoundError(sessionId);
      await unlink(file);
      this.#index.delete(sessionId);
      this.#seen.delete(sessionId);
    });
  }

  // ---- 内部 ----

  /** 串行化同一 key 的异步操作(每会话写锁)。 */
  #withLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const prev = (this.#chain.get(key) ?? Promise.resolve()).catch(() => undefined);
    const next = prev.then(fn);
    this.#chain.set(
      key,
      next.catch(() => undefined),
    );
    return next;
  }

  /** 定位会话文件:先查缓存,再扫桶目录匹配 `_<id>.jsonl`。 */
  async #locate(sessionId: string): Promise<string | null> {
    const cached = this.#index.get(sessionId);
    if (cached) return cached;
    let buckets: string[];
    try {
      buckets = await readdir(this.#root);
    } catch {
      return null;
    }
    const suffix = `_${sessionId}.jsonl`;
    for (const bucket of buckets) {
      let files: string[];
      try {
        files = await readdir(join(this.#root, bucket));
      } catch {
        continue;
      }
      for (const f of files) {
        if (f.endsWith(suffix)) {
          const path = join(this.#root, bucket, f);
          this.#index.set(sessionId, path);
          return path;
        }
      }
    }
    return null;
  }

  /** 懒加载会话已见 entry id 集合(供幂等判定)。 */
  async #ensureSeen(sessionId: string, file: string): Promise<Set<string>> {
    const existing = this.#seen.get(sessionId);
    if (existing) return existing;
    const set = new Set<string>();
    let lineNo = 0;
    for await (const line of this.#streamLines(file)) {
      if (line.length === 0) {
        lineNo += 1;
        continue;
      }
      if (lineNo > 0) {
        try {
          const parsed = parseLine(line, lineNo, sessionId);
          if (parsed.type !== "session") set.add(parsed.id);
        } catch {
          // 已损坏行不阻断幂等集合构建
        }
      }
      lineNo += 1;
    }
    this.#seen.set(sessionId, set);
    return set;
  }

  async #listDir(dir: string): Promise<SessionMeta[]> {
    let files: string[];
    try {
      files = await readdir(dir);
    } catch {
      return [];
    }
    const metas: SessionMeta[] = [];
    for (const f of files) {
      if (!f.endsWith(".jsonl")) continue;
      const meta = await this.#metaFromFile(join(dir, f));
      if (meta) metas.push(meta);
    }
    metas.sort(byCreatedAt);
    return metas;
  }

  async #metaFromFile(file: string): Promise<SessionMeta | null> {
    let header: SessionHeader;
    try {
      const parsed = parseLine(await this.#firstLine(file), 0);
      if (parsed.type !== "session") return null;
      header = parsed;
    } catch {
      return null;
    }
    let updatedAt: string | undefined;
    try {
      updatedAt = (await stat(file)).mtime.toISOString();
    } catch {
      updatedAt = undefined;
    }
    this.#index.set(header.id, file);
    return {
      sessionId: header.id,
      cwd: header.cwd,
      name: header.name,
      version: header.version,
      createdAt: header.timestamp,
      updatedAt,
    };
  }

  /** 流式逐行读取:按 `\n` 切,剥 `\r`。 */
  async *#streamLines(file: string): AsyncIterable<string> {
    const stream = createReadStream(file, { encoding: "utf8" });
    let buffer = "";
    for await (const chunk of stream) {
      buffer += chunk as string;
      let index = buffer.indexOf("\n");
      while (index >= 0) {
        yield buffer.slice(0, index).replace(/\r$/, "");
        buffer = buffer.slice(index + 1);
        index = buffer.indexOf("\n");
      }
    }
    if (buffer.length > 0) yield buffer.replace(/\r$/, "");
  }

  async #firstLine(file: string): Promise<string> {
    for await (const line of this.#streamLines(file)) return line;
    return "";
  }
}

function byCreatedAt(a: SessionMeta, b: SessionMeta): number {
  if (a.createdAt < b.createdAt) return -1;
  if (a.createdAt > b.createdAt) return 1;
  return 0;
}
