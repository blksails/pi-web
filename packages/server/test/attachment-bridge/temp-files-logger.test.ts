/**
 * Task 4.2 — temp-files 默认 onError 钩子改走 @blksails/pi-web-logger (core:attachment)。
 *
 * TDD 行为断言：
 * 1. 默认（无注入 onError）：回收失败时，error 经 logger（core:attachment）产出，
 *    不再直接调用 console.warn。
 * 2. 可注入 onError 覆盖仍生效（向后兼容）。
 * 3. 既有回收行为不变（不阻断其它文件、no-op 不抛等）。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdir, writeFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { LogEntry, Sink } from "@blksails/pi-web-logger";
import { configureLogger } from "@blksails/pi-web-logger";
import { createTempFileTracker } from "../../src/attachment-bridge/temp-files.js";

let root: string;
let n = 0;

async function makeTempFile(content = "x"): Promise<string> {
  const path = join(root, `tmp-${n++}.bin`);
  await writeFile(path, content);
  return path;
}

function makeSink(): { sink: Sink; entries: LogEntry[] } {
  const entries: LogEntry[] = [];
  const sink: Sink = (entry) => entries.push(entry);
  return { sink, entries };
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "atttmplog-"));
  n = 0;
  configureLogger({ enabled: true, level: "debug" });
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
  configureLogger({ enabled: true, level: "debug", namespaces: {} });
});

describe("temp-files 默认 onError → logger(core:attachment)", () => {
  it("无注入 onError 时，删除失败经 logger(core:attachment) error 产出，不走 console.warn", async () => {
    const { sink, entries } = makeSink();
    const consoleSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const tracker = createTempFileTracker({ loggerSink: sink });

    // 造一个非空目录：rm(path) 对非空目录会抛（模拟真实删除失败）
    const badDir = join(root, "a-directory");
    await mkdir(badDir);
    await writeFile(join(badDir, "inner.bin"), "x");

    tracker.track("call-A", "sess-1", badDir);
    await tracker.cleanupForCall("call-A");

    // 错误经 logger(core:attachment) 产出
    const errorEntries = entries.filter(
      (e) => e.level === "error" && e.ns === "core:attachment",
    );
    expect(errorEntries.length).toBeGreaterThanOrEqual(1);

    // console.warn 不应被 tracker 默认路径直接调用
    expect(consoleSpy).not.toHaveBeenCalled();

    consoleSpy.mockRestore();
  });

  it("可注入 onError 覆盖仍生效（向后兼容）", async () => {
    const errorCalls: Array<[string, unknown]> = [];
    const tracker = createTempFileTracker({
      onError: (msg, err) => errorCalls.push([msg, err]),
    });

    const badDir = join(root, "a-directory-compat");
    await mkdir(badDir);
    await writeFile(join(badDir, "inner.bin"), "x");

    tracker.track("call-A", "sess-1", badDir);
    await tracker.cleanupForCall("call-A");

    expect(errorCalls.length).toBeGreaterThanOrEqual(1);
    expect(errorCalls[0]?.[0]).toContain("attachment-bridge");
  });

  it("删除失败不阻断同批其他文件回收（既有行为）", async () => {
    const { sink } = makeSink();
    const tracker = createTempFileTracker({ loggerSink: sink });

    const badDir = join(root, "bad-dir");
    await mkdir(badDir);
    await writeFile(join(badDir, "inner.bin"), "x");
    const realFile = await makeTempFile();

    tracker.track("call-A", "sess-1", badDir);
    tracker.track("call-A", "sess-1", realFile);

    await expect(tracker.cleanupForCall("call-A")).resolves.toBeUndefined();

    // 真实文件被删除（失败的那个未阻断它）
    const { access } = await import("node:fs/promises");
    await expect(access(realFile)).rejects.toThrow();
  });
});
