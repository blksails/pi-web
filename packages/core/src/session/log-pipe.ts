/**
 * log-pipe — 子进程 stderr → 结构化日志条目 → ring buffer + 下行帧。
 *
 * 自 `PiSession` 提出(H1 职责簇拆分):原本是六个字段(parser / buffer / gateConfig /
 * gateLoading / pendingStderr / provider)加三个方法散在 1600 行的会话类里,而它们与会话的
 * 其它九个职责没有任何交集 —— 日志管道不认识 RPC、不认识生命周期、不认识附件。
 *
 * ## 门控为什么要异步且要缓冲
 *
 * 门控是**服务端权威**的(Req 6.4/6.5/6.6),值来自配置文件,只能异步取。而 stderr 在会话
 * 起来的第一毫秒就开始流。若同步取不到就丢弃,启动期日志(恰恰是最该看的那批)会全部消失。
 * 故:配置未就绪时 chunk 入队,就绪后**回放**队列再按门控过滤。
 *
 * ★ 门控关闭时条目在**此处**被丢弃,子进程仍然照产 —— 那是另一条线(spawn env 下发门控)
 *   的事,不在本模块职责内。
 */
import type { LoggingConfig } from "@blksails/pi-web-protocol";
import {
  isLevelEnabled,
  isNamespaceEnabled,
  type LogEntry,
  type LogLevel,
} from "@blksails/pi-web-logger";
import { LogRingBuffer } from "../logging/log-ring-buffer.js";
import { StderrLogParser } from "../logging/stderr-log-parser.js";

/** 带 ring-buffer 分配 id 的日志条目。 */
export type StoredLogEntry = LogEntry & { id: string };

/** {@link SessionLogPipe} 的注入依赖。 */
export interface SessionLogPipeDeps {
  /**
   * 门控配置来源。省略 = 无门控(同步取 {@link SessionLogPipeDeps.defaultGate},全开),
   * 用于测试与未注入 provider 的宿主。
   */
  readonly provider?: () => Promise<LoggingConfig>;
  /** provider 缺省或解析失败时的兜底门控。 */
  readonly defaultGate: LoggingConfig;
  /**
   * 会话是否仍 active。
   *
   * ★ 必须是**函数**而非布尔快照:门控解析是异步的,回放发生在若干 tick 之后,那时会话
   *   可能已经收尾。用快照会让收尾后的回放照样产帧。
   */
  readonly isActive: () => boolean;
  /** 产出一批条目(合并成一帧下行)。仅在非空时调用。 */
  readonly emit: (entries: StoredLogEntry[]) => void;
}

/** 一个会话的 stderr 日志管道。 */
export class SessionLogPipe {
  private readonly parser = new StderrLogParser();
  private readonly buffer = new LogRingBuffer();
  private readonly deps: SessionLogPipeDeps;

  /** `undefined` = 门控待加载;首条 chunk 到来时触发一次异步加载。 */
  private gate: LoggingConfig | undefined;
  private gateLoading = false;
  private readonly pendingChunks: string[] = [];

  constructor(deps: SessionLogPipeDeps) {
    this.deps = deps;
    // 无 provider → 同步定为兜底门控(全开,向后兼容),永不进入缓冲分支。
    if (deps.provider === undefined) this.gate = deps.defaultGate;
  }

  /** 送入一段 stderr。非 active 时丢弃。 */
  ingest(chunk: string): void {
    if (!this.deps.isActive()) return;

    if (this.gate === undefined) {
      this.pendingChunks.push(chunk);
      if (!this.gateLoading) {
        this.gateLoading = true;
        const provider = this.deps.provider!;
        provider()
          .catch(() => this.deps.defaultGate)
          .then((config) => {
            this.gate = config;
            for (const c of this.pendingChunks.splice(0)) this.process(c);
          })
          .catch(() => {
            // 极端情况(process 内部抛出),吞错不崩 —— 日志管道失败不该带走会话。
          });
      }
      return;
    }

    this.process(chunk);
  }

  /** 查询 ring buffer(REST 路由 / 新订阅者回填)。 */
  getLogs(query: { level?: LogLevel; limit?: number; since?: number } = {}): StoredLogEntry[] {
    return this.buffer.getLogs(query);
  }

  /** 解析 → 门控过滤 → 入 buffer → 产帧。调用前 `gate` 必已就绪。 */
  private process(chunk: string): void {
    if (!this.deps.isActive()) return;
    const gate = this.gate!;
    const raw = this.parser.ingestChunk(chunk);
    if (raw.length === 0) return;

    const entries: StoredLogEntry[] = [];
    for (const entry of raw) {
      // 门控过滤(Req 6.4 / 6.5 / 6.6):
      //  1. 全局开关关闭 → 全丢;2. level 低于配置 → 丢;3. 命名空间显式关闭 → 丢。
      if (!gate.enabled) continue;
      if (!isLevelEnabled(entry.level, gate.level)) continue;
      if (!isNamespaceEnabled(entry.ns, gate.namespaces)) continue;
      entries.push(this.buffer.ingest(entry));
    }

    if (entries.length === 0) return;
    this.deps.emit(entries);
  }
}
