/**
 * 解包器纯函数的单测（spec shared-runtime-payload 任务 1.2）。
 *
 * `isRuntimeDirName` 的拒绝用例是**防灾条款的回归防护**：若它误放行，GC 在
 * PI_WEB_RUNTIME_ROOT 被误设成 $HOME 时会去删 Documents/。
 */
import { describe, expect, it } from "vitest";
import {
  GC_KEEP,
  GC_MIN_AGE_MS,
  GC_TEMP_AGE_MS,
  STALE_LOCK_MS,
  classifyExtractError,
  classifyFsError,
  defaultRuntimeRoot,
  isProcessAlive,
  isRuntimeDirName,
  runtimeDirName,
  selectGcVictims,
} from "../../src/runtime/unpack.src.mjs";

const DAY = 24 * 60 * 60 * 1000;
const NOW = 1_800_000_000_000;

describe("runtimeDirName", () => {
  it("取摘要前 12 位拼在版本之后", () => {
    expect(runtimeDirName("0.1.3", "a1b2c3d4e5f6a7b8c9d0")).toBe("0.1.3-a1b2c3d4e5f6");
  });

  it("同版本不同摘要 → 不同目录（dev 反复重建 dist 时不会命中陈旧运行时）", () => {
    const a = runtimeDirName("0.1.3", "aaaaaaaaaaaa0000");
    const b = runtimeDirName("0.1.3", "bbbbbbbbbbbb0000");
    expect(a).not.toBe(b);
  });
});

describe("isRuntimeDirName（防灾守卫）", () => {
  it.each([
    ["0.1.3-a1b2c3d4e5f6", true],
    ["1.0.0-beta.1-0123456789ab", true],
    ["10.20.30-ffffffffffff", true],
  ])("接受 %s", (name, expected) => {
    expect(isRuntimeDirName(name)).toBe(expected);
  });

  it.each([
    "Documents",
    ".staging-a1b2c3d4e5f6-123-abcd",
    ".trash-abcdef",
    ".lock-a1b2c3d4e5f6",
    "1.2.3-ABCDEF012345", // 大写 hex
    "1.2.3-abc", // 位数不足
    "1.2.3-a1b2c3d4e5f6g", // 13 位 / 含非 hex
    "1.2-a1b2c3d4e5f6", // 非 semver
    "node_modules",
    "",
  ])("拒绝 %s", (name) => {
    expect(isRuntimeDirName(name)).toBe(false);
  });
});

describe("classifyFsError", () => {
  it.each([
    ["ENOSPC", "disk-full"],
    ["EACCES", "runtime-root-unwritable"],
    ["EPERM", "runtime-root-unwritable"],
    ["EROFS", "runtime-root-unwritable"],
    ["EIO", "extract-failed"],
    [undefined, "extract-failed"],
  ])("%s → %s", (code, expected) => {
    expect(classifyFsError({ code })).toBe(expected);
  });
});

describe("classifyExtractError", () => {
  it("zstd/tar 结构错误（无 fs errno）归为载荷损坏", () => {
    expect(classifyExtractError(new Error("invalid zstd frame"))).toBe("payload-corrupt");
    expect(classifyExtractError({ code: "Z_DATA_ERROR" })).toBe("payload-corrupt");
  });

  it("带 fs errno 的仍走 classifyFsError", () => {
    expect(classifyExtractError({ code: "ENOSPC" })).toBe("disk-full");
    expect(classifyExtractError({ code: "EACCES" })).toBe("runtime-root-unwritable");
    expect(classifyExtractError({ code: "EIO" })).toBe("extract-failed");
  });
});

describe("selectGcVictims", () => {
  const rt = (name: string, ageMs: number) => ({ name, mtimeMs: NOW - ageMs });

  it("keepDir 永不入选，哪怕它非常旧", () => {
    const entries = [rt("0.1.3-aaaaaaaaaaaa", 400 * DAY)];
    expect(selectGcVictims(entries, "0.1.3-aaaaaaaaaaaa", NOW)).toEqual([]);
  });

  it("保留最近 GC_KEEP 个运行时目录，其余满足最小年龄才删", () => {
    const entries = [
      rt("0.1.0-000000000000", 30 * DAY),
      rt("0.1.1-111111111111", 20 * DAY),
      rt("0.1.2-222222222222", 10 * DAY),
      rt("0.1.3-333333333333", 1 * DAY),
    ];
    // keepDir 是 0.1.3；剩下三个按 mtime 降序保留 2 个（0.1.2 / 0.1.1），只删 0.1.0。
    expect(GC_KEEP).toBe(2);
    expect(selectGcVictims(entries, "0.1.3-333333333333", NOW)).toEqual(["0.1.0-000000000000"]);
  });

  it("未满最小年龄的旧目录不删", () => {
    const entries = [
      rt("0.1.0-000000000000", GC_MIN_AGE_MS - 1000),
      rt("0.1.1-111111111111", 1 * DAY),
      rt("0.1.2-222222222222", 2 * DAY),
      rt("0.1.3-333333333333", 3 * DAY),
    ];
    expect(selectGcVictims(entries, "0.1.3-333333333333", NOW)).toEqual([]);
  });

  it("命名形态不符的条目一律不碰（即便极旧）", () => {
    const entries = [
      rt("Documents", 999 * DAY),
      rt("node_modules", 999 * DAY),
      rt(".hidden", 999 * DAY),
      rt("1.2.3-ABCDEF012345", 999 * DAY),
    ];
    expect(selectGcVictims(entries, "0.1.3-333333333333", NOW)).toEqual([]);
  });

  it("staging / trash 按 1 小时阈值回收", () => {
    const entries = [
      rt(".staging-aaa-1-bb", GC_TEMP_AGE_MS + 1000),
      rt(".trash-abcdef", GC_TEMP_AGE_MS + 1000),
      rt(".staging-fresh", GC_TEMP_AGE_MS - 1000),
    ];
    expect(selectGcVictims(entries, "", NOW).sort()).toEqual([".staging-aaa-1-bb", ".trash-abcdef"]);
  });

  it("陈旧锁按 10 分钟阈值回收，新鲜锁保留", () => {
    const entries = [
      rt(".lock-aaaaaaaaaaaa", STALE_LOCK_MS + 1000),
      rt(".lock-bbbbbbbbbbbb", STALE_LOCK_MS - 1000),
    ];
    expect(selectGcVictims(entries, "", NOW)).toEqual([".lock-aaaaaaaaaaaa"]);
  });
});

describe("isProcessAlive（锁的陈旧判据）", () => {
  it("当前进程视为存活", () => {
    expect(isProcessAlive(process.pid)).toBe(true);
  });

  it("不可能存在的 pid 视为已死", () => {
    // 2^22 之上的 pid 在常见系统上不会被分配。
    expect(isProcessAlive(4_194_303)).toBe(false);
  });

  it.each([0, -1, 1.5, Number.NaN, undefined, null])("非法 pid %s 视为已死", (pid) => {
    expect(isProcessAlive(pid as number)).toBe(false);
  });
});

describe("defaultRuntimeRoot", () => {
  it("默认为 ~/.pi/web/runtime", () => {
    expect(defaultRuntimeRoot({}, "/home/u")).toBe("/home/u/.pi/web/runtime");
  });

  it("PI_WEB_RUNTIME_ROOT 覆盖并绝对化", () => {
    expect(defaultRuntimeRoot({ PI_WEB_RUNTIME_ROOT: "/tmp/rt" }, "/home/u")).toBe("/tmp/rt");
  });

  it("空白覆盖视同未设置", () => {
    expect(defaultRuntimeRoot({ PI_WEB_RUNTIME_ROOT: "   " }, "/home/u")).toBe("/home/u/.pi/web/runtime");
  });
});
