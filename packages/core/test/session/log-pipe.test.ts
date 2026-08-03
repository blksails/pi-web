/**
 * SessionLogPipe — stderr → 门控 → ring buffer + 下行帧(自 PiSession 提出,H1)。
 *
 * 要害在**异步门控与缓冲回放**:stderr 在会话第一毫秒就流,而门控只能异步取。此前这段
 * 逻辑只能经真实会话间接验;这里直测。
 */
import { describe, it, expect, vi } from "vitest";
import { LOG_SENTINEL } from "@blksails/pi-web-logger";
import type { LoggingConfig } from "@blksails/pi-web-protocol";
import { SessionLogPipe } from "../../src/session/log-pipe.js";

const OPEN: LoggingConfig = {
  enabled: true,
  level: "debug",
  namespaces: undefined,
  panelDefaultLevel: "info",
};
const CLOSED: LoggingConfig = { ...OPEN, enabled: false };

/** 构造一行 sentinel 日志(与 node-sink 的线格式一致)。 */
function logLine(ns: string, level: string, msg: string): string {
  return `${LOG_SENTINEL}${JSON.stringify({ ns, level, msg, ts: 1 })}\n`;
}

describe("SessionLogPipe — 无 provider(同步兜底门控)", () => {
  it("直接按 defaultGate 处理,不进缓冲分支", () => {
    const emit = vi.fn();
    const pipe = new SessionLogPipe({ defaultGate: OPEN, isActive: () => true, emit });
    pipe.ingest(logLine("agent:x", "info", "hello"));
    expect(emit).toHaveBeenCalledOnce();
    expect(pipe.getLogs()).toHaveLength(1);
  });
});

describe("SessionLogPipe — 异步门控与缓冲回放", () => {
  it("★门控未就绪时 chunk 入队,就绪后回放(启动期日志不丢)", async () => {
    let resolveGate: (c: LoggingConfig) => void = () => {};
    const emit = vi.fn();
    const pipe = new SessionLogPipe({
      provider: () => new Promise((r) => (resolveGate = r)),
      defaultGate: OPEN,
      isActive: () => true,
      emit,
    });
    pipe.ingest(logLine("agent:x", "info", "first"));
    pipe.ingest(logLine("agent:x", "info", "second"));
    expect(emit).not.toHaveBeenCalled(); // 尚未就绪 → 只入队

    resolveGate(OPEN);
    await vi.waitFor(() => expect(emit).toHaveBeenCalled());
    expect(pipe.getLogs().map((e) => e.msg)).toEqual(["first", "second"]);
  });

  it("★provider 只被调用一次(多条 chunk 不重复触发加载)", async () => {
    const provider = vi.fn(async () => OPEN);
    const pipe = new SessionLogPipe({
      provider,
      defaultGate: OPEN,
      isActive: () => true,
      emit: vi.fn(),
    });
    pipe.ingest(logLine("a", "info", "1"));
    pipe.ingest(logLine("a", "info", "2"));
    pipe.ingest(logLine("a", "info", "3"));
    await vi.waitFor(() => expect(provider).toHaveBeenCalledTimes(1));
  });

  it("provider 抛错 → 回落 defaultGate,不吞掉已缓冲的行", async () => {
    const emit = vi.fn();
    const pipe = new SessionLogPipe({
      provider: () => Promise.reject(new Error("config unreadable")),
      defaultGate: OPEN,
      isActive: () => true,
      emit,
    });
    pipe.ingest(logLine("a", "info", "kept"));
    await vi.waitFor(() => expect(emit).toHaveBeenCalled());
    expect(pipe.getLogs().map((e) => e.msg)).toEqual(["kept"]);
  });

  it("★回放时会话已收尾 → 不产帧(isActive 必须是函数而非快照)", async () => {
    let resolveGate: (c: LoggingConfig) => void = () => {};
    let active = true;
    const emit = vi.fn();
    const pipe = new SessionLogPipe({
      provider: () => new Promise((r) => (resolveGate = r)),
      defaultGate: OPEN,
      isActive: () => active,
      emit,
    });
    pipe.ingest(logLine("a", "info", "x"));
    active = false; // 门控解析期间会话收尾
    resolveGate(OPEN);
    await new Promise((r) => setTimeout(r, 10));
    expect(emit).not.toHaveBeenCalled();
  });
});

describe("SessionLogPipe — 门控过滤", () => {
  it("enabled:false → 全丢,既不入 buffer 也不产帧", async () => {
    const emit = vi.fn();
    const pipe = new SessionLogPipe({
      provider: async () => CLOSED,
      defaultGate: OPEN,
      isActive: () => true,
      emit,
    });
    pipe.ingest(logLine("a", "info", "dropped"));
    await new Promise((r) => setTimeout(r, 10));
    expect(emit).not.toHaveBeenCalled();
    expect(pipe.getLogs()).toHaveLength(0);
  });

  it("level 低于门控 → 丢;达标 → 留", () => {
    const emit = vi.fn();
    const pipe = new SessionLogPipe({
      defaultGate: { ...OPEN, level: "warn" },
      isActive: () => true,
      emit,
    });
    pipe.ingest(logLine("a", "info", "too low"));
    pipe.ingest(logLine("a", "error", "kept"));
    expect(pipe.getLogs().map((e) => e.msg)).toEqual(["kept"]);
  });

  it("命名空间显式关闭 → 丢", () => {
    const pipe = new SessionLogPipe({
      defaultGate: { ...OPEN, namespaces: { noisy: false } },
      isActive: () => true,
      emit: vi.fn(),
    });
    pipe.ingest(logLine("noisy", "error", "shh"));
    pipe.ingest(logLine("quiet", "error", "kept"));
    expect(pipe.getLogs().map((e) => e.msg)).toEqual(["kept"]);
  });

  it("非 active → 直接丢弃,不入队也不解析", () => {
    const emit = vi.fn();
    const pipe = new SessionLogPipe({ defaultGate: OPEN, isActive: () => false, emit });
    pipe.ingest(logLine("a", "info", "x"));
    expect(emit).not.toHaveBeenCalled();
    expect(pipe.getLogs()).toHaveLength(0);
  });

  it("全部被过滤掉时不产空帧", () => {
    const emit = vi.fn();
    const pipe = new SessionLogPipe({ defaultGate: CLOSED, isActive: () => true, emit });
    pipe.ingest(logLine("a", "error", "x"));
    expect(emit).not.toHaveBeenCalled();
  });
});
