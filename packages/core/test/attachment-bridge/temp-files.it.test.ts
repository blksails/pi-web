/**
 * attachment-tool-bridge · 临时文件登记器 `TempFileTracker` 单元测试
 * (task 2.1;Req 2.1, 2.2, 2.3, 2.4)。
 *
 * 断言:
 * - 按工具调用维度登记懒下载临时文件,`cleanupForCall(toolCallId)` 删除**该调用**的、保留其它调用的(Req 2.1/2.2);
 * - 按会话维度登记,`cleanupForSession(sessionId)` 删除**该会话**所有残留临时文件(Req 2.1/2.3);
 * - 删除不存在/失败不抛(吞错记日志,尽力回收,不阻断主流程);
 * - 本地后端路径**不登记**(no-op:本地路径直指落盘文件,无需回收,Req 2.4)。
 *
 * 用临时目录真文件;afterEach 清理。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm, writeFile, access, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createTempFileTracker } from "../../src/attachment-bridge/index.js";

let root: string;
let n = 0;

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

/** 在临时目录里造一个真文件,返回路径。 */
async function makeTempFile(content = "x"): Promise<string> {
  const path = join(root, `tmp-${n++}.bin`);
  await writeFile(path, content);
  return path;
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "atttmp-"));
  n = 0;
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("TempFileTracker — 按调用回收(Req 2.1/2.2)", () => {
  it("cleanupForCall 删除该调用登记的文件,保留其它调用的", async () => {
    const tracker = createTempFileTracker();

    const a1 = await makeTempFile();
    const a2 = await makeTempFile();
    const b1 = await makeTempFile();

    tracker.track("call-A", "sess-1", a1);
    tracker.track("call-A", "sess-1", a2);
    tracker.track("call-B", "sess-1", b1);

    await tracker.cleanupForCall("call-A");

    expect(await exists(a1)).toBe(false);
    expect(await exists(a2)).toBe(false);
    // call-B 的文件未被回收。
    expect(await exists(b1)).toBe(true);
  });

  it("同一调用回收两次:第二次 no-op 不抛(登记已清)", async () => {
    const tracker = createTempFileTracker();
    const a1 = await makeTempFile();
    tracker.track("call-A", "sess-1", a1);

    await tracker.cleanupForCall("call-A");
    await expect(tracker.cleanupForCall("call-A")).resolves.toBeUndefined();
    expect(await exists(a1)).toBe(false);
  });

  it("回收未知 toolCallId:no-op 不抛", async () => {
    const tracker = createTempFileTracker();
    await expect(tracker.cleanupForCall("never-tracked")).resolves.toBeUndefined();
  });
});

describe("TempFileTracker — 按会话回收(Req 2.1/2.3)", () => {
  it("cleanupForSession 删除该会话所有残留(跨多个调用),保留其它会话", async () => {
    const tracker = createTempFileTracker();

    const s1a = await makeTempFile();
    const s1b = await makeTempFile();
    const s2a = await makeTempFile();

    tracker.track("call-A", "sess-1", s1a);
    tracker.track("call-B", "sess-1", s1b);
    tracker.track("call-C", "sess-2", s2a);

    await tracker.cleanupForSession("sess-1");

    expect(await exists(s1a)).toBe(false);
    expect(await exists(s1b)).toBe(false);
    // sess-2 的文件未被回收。
    expect(await exists(s2a)).toBe(true);
  });

  it("会话回收后再按其残留调用回收:no-op 不抛(已清)", async () => {
    const tracker = createTempFileTracker();
    const s1a = await makeTempFile();
    tracker.track("call-A", "sess-1", s1a);

    await tracker.cleanupForSession("sess-1");
    await expect(tracker.cleanupForCall("call-A")).resolves.toBeUndefined();
    expect(await exists(s1a)).toBe(false);
  });
});

describe("TempFileTracker — 删除失败吞错(尽力回收,不阻断)", () => {
  it("登记一个不存在的文件路径,cleanup 不抛(吞错记日志)", async () => {
    const tracker = createTempFileTracker();
    const missing = join(root, "does-not-exist.bin");
    tracker.track("call-A", "sess-1", missing);

    // 删不存在文件不抛。
    await expect(tracker.cleanupForCall("call-A")).resolves.toBeUndefined();
  });

  it("一个文件删除失败不阻断同批其它文件回收(尽力删除)", async () => {
    const warn = vi.fn();
    const tracker = createTempFileTracker({ onError: warn });

    // 造一个非空目录:rm(path)(非 recursive)对非空目录会**抛**(真实失败),
    // 用以验证「单个删除失败被吞错记日志、不阻断同批其它文件回收」。
    const badDir = join(root, "a-directory");
    await mkdir(badDir);
    await writeFile(join(badDir, "inner.bin"), "x");

    const real = await makeTempFile();

    tracker.track("call-A", "sess-1", badDir);
    tracker.track("call-A", "sess-1", real);

    await expect(tracker.cleanupForCall("call-A")).resolves.toBeUndefined();
    // 真实文件仍被删除(失败的那个未阻断它)。
    expect(await exists(real)).toBe(false);
    // 失败被记日志(吞错)。
    expect(warn).toHaveBeenCalled();
  });
});

describe("TempFileTracker — 本地后端不登记(Req 2.4)", () => {
  it("本地路径不经 track(no-op):未登记则 cleanup 不动它", async () => {
    const tracker = createTempFileTracker();

    // 本地后端 localPath 直指落盘文件,调用方根本不会 track 它;
    // 模拟「未登记」:造一个真文件但不 track,任何回收入口都不应删除它。
    const localFile = await makeTempFile("local-backend-on-disk");

    await tracker.cleanupForCall("call-A");
    await tracker.cleanupForSession("sess-1");

    // 未登记 → 保留(本地落盘文件不被回收)。
    expect(await exists(localFile)).toBe(true);
  });
});
