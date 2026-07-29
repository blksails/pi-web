/**
 * Task 4.1: File output & rotation tests (TDD — behavior-driven)
 *
 * Covers:
 *   - R7.1: File output enabled → logs are appended to the configured path
 *   - R7.2: Rotation on maxSizeMb → rotated files (.1, .2, ...) are created,
 *            oldest files beyond maxFiles are removed
 *   - R7.3: File output disabled → no file is created or written
 *   - R7.4: Write failure (e.g. read-only path) → swallowed, no throw, no agent impact
 *   - R1.6: Isomorphic purity — browser path has no static "node:" imports
 *
 * All file-system operations use a temp directory (os.tmpdir + random suffix)
 * created per-test and cleaned up in afterEach.
 *
 * Node fs module pre-seeding:
 *   file-sink.ts accesses `fs` via a `globalThis.__PI_WEB_FS__` seam to avoid
 *   a static top-level `import ... from "node:fs"`.  The test file (which runs
 *   in Node and is allowed to import Node modules) pre-populates that seam once
 *   at the top of the test suite so all tests find `fs` ready synchronously.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import * as os from "node:os";
import * as nodePath from "node:path";
import * as nodeFs from "node:fs";
import type { LogEntry } from "../types.js";

// ── Pre-seed the globalThis fs seam so file-sink's guarded accessor finds it ──
// file-sink.ts reads (globalThis as any).__PI_WEB_FS__ but performs no dynamic import
// of its own (R1.6: zero built-in specifier references in file-sink.ts).
// In the real runner this seam is filled by startRunner() before any logger call.
// Here we populate it directly since the test runs in Node and has full fs access.
(globalThis as Record<string, unknown>)["__PI_WEB_FS__"] = nodeFs;

// ── helpers ──────────────────────────────────────────────────────────────────

function makeEntry(overrides: Partial<LogEntry> = {}): LogEntry {
  return {
    level: "info",
    ns: "test:file",
    msg: "hello file",
    ts: Date.now(),
    ...overrides,
  };
}

function makeTmpDir(): string {
  const dir = nodePath.join(os.tmpdir(), `pi-logger-test-${Math.random().toString(36).slice(2)}`);
  nodeFs.mkdirSync(dir, { recursive: true });
  return dir;
}

// ═══════════════════════════════════════════════════════════════════════════
// 1. File output enabled → logs are written to the configured path
// ═══════════════════════════════════════════════════════════════════════════

describe("File sink — enabled output", () => {
  let tmpDir: string;
  let logPath: string;

  beforeEach(() => {
    vi.resetModules();
    tmpDir = makeTmpDir();
    logPath = nodePath.join(tmpDir, "app.log");
  });

  afterEach(() => {
    nodeFs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("creates and writes log lines to the configured path when enabled", async () => {
    const { createFileSink } = await import("../file-sink.js");
    const sink = createFileSink({ enabled: true, path: logPath, maxSizeMb: 10, maxFiles: 3 });
    const entry = makeEntry({ msg: "sentinel-write-test" });
    sink(entry);
    // flush is synchronous (write-append), so check immediately
    expect(nodeFs.existsSync(logPath)).toBe(true);
    const content = nodeFs.readFileSync(logPath, "utf8");
    expect(content).toContain("sentinel-write-test");
  });

  it("each written line is a valid JSON object with expected fields", async () => {
    const { createFileSink } = await import("../file-sink.js");
    const sink = createFileSink({ enabled: true, path: logPath, maxSizeMb: 10, maxFiles: 3 });
    const entry = makeEntry({ level: "warn", msg: "check-fields", ns: "test:fields" });
    sink(entry);

    const content = nodeFs.readFileSync(logPath, "utf8").trim();
    const parsed = JSON.parse(content) as LogEntry;
    expect(parsed.level).toBe("warn");
    expect(parsed.msg).toBe("check-fields");
    expect(parsed.ns).toBe("test:fields");
  });

  it("appends multiple entries to the same file without truncating", async () => {
    const { createFileSink } = await import("../file-sink.js");
    const sink = createFileSink({ enabled: true, path: logPath, maxSizeMb: 10, maxFiles: 3 });
    sink(makeEntry({ msg: "first" }));
    sink(makeEntry({ msg: "second" }));
    sink(makeEntry({ msg: "third" }));

    const lines = nodeFs.readFileSync(logPath, "utf8").trim().split("\n");
    expect(lines.length).toBe(3);
    expect(lines[0]).toContain("first");
    expect(lines[1]).toContain("second");
    expect(lines[2]).toContain("third");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 2. Rotation on maxSizeMb
// ═══════════════════════════════════════════════════════════════════════════

describe("File sink — rotation", () => {
  let tmpDir: string;
  let logPath: string;

  beforeEach(() => {
    vi.resetModules();
    tmpDir = makeTmpDir();
    logPath = nodePath.join(tmpDir, "rotate.log");
  });

  afterEach(() => {
    nodeFs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("rotates the log file when its size exceeds maxSizeMb", async () => {
    const { createFileSink } = await import("../file-sink.js");
    // 1 byte = 1e-6 MB → effectively 0 MB limit → rotates after first write
    const sink = createFileSink({
      enabled: true,
      path: logPath,
      maxSizeMb: 0.000001, // 1 byte limit — triggers rotation on first non-trivial write
      maxFiles: 3,
    });

    // Write several entries to trigger rotation
    for (let i = 0; i < 5; i++) {
      sink(makeEntry({ msg: `rotate-entry-${i}` }));
    }

    // At least one rotated file should exist
    const files = nodeFs.readdirSync(tmpDir);
    const rotated = files.filter((f) => f.startsWith("rotate.log."));
    expect(rotated.length).toBeGreaterThan(0);
  });

  it("keeps at most maxFiles rotated files (deletes oldest)", async () => {
    const { createFileSink } = await import("../file-sink.js");
    const maxFiles = 2;
    const sink = createFileSink({
      enabled: true,
      path: logPath,
      maxSizeMb: 0.000001, // tiny limit — every write triggers rotation
      maxFiles,
    });

    // Write enough entries to produce more than maxFiles rotations
    for (let i = 0; i < maxFiles + 5; i++) {
      sink(makeEntry({ msg: `overflow-entry-${i}` }));
    }

    const files = nodeFs.readdirSync(tmpDir);
    const rotated = files.filter((f) => f.startsWith("rotate.log."));
    // Number of rotated backup files must not exceed maxFiles
    expect(rotated.length).toBeLessThanOrEqual(maxFiles);
  });

  it("rotated files are numbered .1, .2, … with .1 being the most recent backup", async () => {
    const { createFileSink } = await import("../file-sink.js");
    const sink = createFileSink({
      enabled: true,
      path: logPath,
      maxSizeMb: 0.000001,
      maxFiles: 3,
    });

    for (let i = 0; i < 4; i++) {
      sink(makeEntry({ msg: `numbered-entry-${i}` }));
    }

    const files = nodeFs.readdirSync(tmpDir);
    // Should find at least rotate.log.1
    expect(files.some((f) => f === "rotate.log.1")).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 3. File output disabled → no file created, no write
// ═══════════════════════════════════════════════════════════════════════════

describe("File sink — disabled", () => {
  let tmpDir: string;
  let logPath: string;

  beforeEach(() => {
    vi.resetModules();
    tmpDir = makeTmpDir();
    logPath = nodePath.join(tmpDir, "noop.log");
  });

  afterEach(() => {
    nodeFs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("does not create any file when enabled=false", async () => {
    const { createFileSink } = await import("../file-sink.js");
    const sink = createFileSink({ enabled: false, path: logPath, maxSizeMb: 10, maxFiles: 3 });
    sink(makeEntry({ msg: "should not write" }));

    expect(nodeFs.existsSync(logPath)).toBe(false);
  });

  it("does not throw when enabled=false", async () => {
    const { createFileSink } = await import("../file-sink.js");
    const sink = createFileSink({ enabled: false, path: logPath, maxSizeMb: 10, maxFiles: 3 });
    expect(() => sink(makeEntry())).not.toThrow();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 4. Write failure → swallowed, no throw, no agent impact
// ═══════════════════════════════════════════════════════════════════════════

describe("File sink — write failure (R7.4)", () => {
  let tmpDir: string;

  beforeEach(() => {
    vi.resetModules();
    tmpDir = makeTmpDir();
  });

  afterEach(() => {
    nodeFs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("does not throw when the log path points to a non-writable directory", async () => {
    const { createFileSink } = await import("../file-sink.js");
    // Use a path inside a non-existent deeply-nested directory with read-only parent
    const badPath = nodePath.join(tmpDir, "nonexistent-sub", "cannot-create", "app.log");
    // Parent does not exist → fs.appendFileSync will fail → must be swallowed
    const sink = createFileSink({ enabled: true, path: badPath, maxSizeMb: 10, maxFiles: 3 });
    expect(() => sink(makeEntry({ msg: "write-failure-test" }))).not.toThrow();
  });

  it("continues to operate (not throw) on subsequent calls after a write failure", async () => {
    const { createFileSink } = await import("../file-sink.js");
    const badPath = nodePath.join(tmpDir, "ghost", "app.log");
    const sink = createFileSink({ enabled: true, path: badPath, maxSizeMb: 10, maxFiles: 3 });
    // Multiple calls — none should throw
    for (let i = 0; i < 3; i++) {
      expect(() => sink(makeEntry({ msg: `call-${i}` }))).not.toThrow();
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 5. Isomorphic purity — no static "node:" imports in file-sink.ts source
// ═══════════════════════════════════════════════════════════════════════════

describe("Isomorphic purity — file-sink.ts source check (R1.6)", () => {
  it("file-sink.ts does not contain any built-in specifier reference (static or dynamic)", async () => {
    // Read the source file and scan for ALL forbidden built-in specifier patterns.
    // R1.6: file-sink.ts must contain zero references to any built-in specifier so
    // webpack/Next client builds never attempt to resolve Node built-ins.
    const fs = await import("node:fs");
    const path = await import("node:path");
    const filePath = path.default.join(
      new URL(".", import.meta.url).pathname,
      "..",
      "file-sink.ts",
    );
    const src = fs.default.readFileSync(filePath, "utf8");

    // 1. No static import of built-in specifiers.
    const staticNodeImportRe = /^import\s+(type\s+)?[\s\S]*?\bfrom\s+['"]node:/m;
    expect(staticNodeImportRe.test(src)).toBe(false);

    // 2. No dynamic import() of built-in specifiers (prevents webpack chunk-splitting
    //    of node: references into the browser bundle).
    const dynamicNodeImportRe = /import\s*\(\s*['"]node:/;
    expect(dynamicNodeImportRe.test(src)).toBe(false);
  });

  it("node-sink.ts does not contain a static top-level 'import ... from node:' statement (regression guard)", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const filePath = path.default.join(
      new URL(".", import.meta.url).pathname,
      "..",
      "node-sink.ts",
    );
    const src = fs.default.readFileSync(filePath, "utf8");
    const staticNodeImportRe = /^import\s+(type\s+)?[\s\S]*?\bfrom\s+['"]node:/m;
    expect(staticNodeImportRe.test(src)).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 6. configureFileOutput integration — wires file sink into createLogger
// ═══════════════════════════════════════════════════════════════════════════

describe("configureFileOutput — integration with createLogger", () => {
  let tmpDir: string;
  let logPath: string;

  beforeEach(() => {
    vi.resetModules();
    tmpDir = makeTmpDir();
    logPath = nodePath.join(tmpDir, "integrated.log");
  });

  afterEach(() => {
    nodeFs.rmSync(tmpDir, { recursive: true, force: true });
    vi.resetModules();
  });

  it("when configureFileOutput is called, a logger without explicit sink writes to the file", async () => {
    const { configureFileOutput } = await import("../config.js");
    const { createLogger } = await import("../create-logger.js");

    configureFileOutput({ enabled: true, path: logPath, maxSizeMb: 10, maxFiles: 3 });
    const logger = createLogger({ namespace: "test:integrated" });
    logger.info("integrated-test-msg");

    // File must exist and contain the message
    expect(nodeFs.existsSync(logPath)).toBe(true);
    const content = nodeFs.readFileSync(logPath, "utf8");
    expect(content).toContain("integrated-test-msg");
  });

  it("when configureFileOutput disabled, no file is created by createLogger", async () => {
    const { configureFileOutput } = await import("../config.js");
    const { createLogger } = await import("../create-logger.js");

    configureFileOutput({ enabled: false, path: logPath, maxSizeMb: 10, maxFiles: 3 });
    const logger = createLogger({ namespace: "test:disabled" });
    logger.info("should-not-write");

    expect(nodeFs.existsSync(logPath)).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// configureFileOutputFromEnv（真机回归）
//
// ★ 背景：`PI_WEB_LOG_FILE` 的解析原本**内联在 `initConfigFromEnv()` 里**，而 pi-web
//   主进程刻意不调那个函数（它用 `configureLogger()` 自行门控，好让 Settings 配置能赢）。
//   后果：该变量长期**只在 runner 子进程生效** —— 日志文件确实被创建、看着一切正常，
//   里面却没有一行主进程的日志。真机排查发布链时因此完全失明，判据最后只能靠回执文件。
//
//   拆出本函数后，两处共用同一份解析（而不是各写一遍、迟早漂移）。
// ─────────────────────────────────────────────────────────────────────────────
describe("configureFileOutputFromEnv", () => {
  // 本组自建临时目录:上面那组的 `tmpDir` 是其 describe 内的局部变量,取不到。
  let envTmpDir: string;
  beforeEach(() => {
    envTmpDir = nodeFs.mkdtempSync(nodePath.join(os.tmpdir(), "pi-log-env-"));
  });
  afterEach(() => {
    nodeFs.rmSync(envTmpDir, { recursive: true, force: true });
  });

  it("★ 单独调用即可装上文件 sink —— 不必经 initConfigFromEnv", async () => {
    const { configureFileOutputFromEnv, getFileSink, configureFileOutput } = await import(
      "../config.js"
    );
    // 先关掉:此后写入不应产生任何文件。
    // ★ 断言的是**行为**(写没写进去),不是 getFileSink() 的内部表示 ——
    //   关闭态下它返回的是空操作 sink 而非 null,拿 null 当判据会写出一条假断言。
    configureFileOutput({ enabled: false, path: "", maxSizeMb: 1, maxFiles: 1 });
    const logPath = nodePath.join(envTmpDir, "from-env.log");
    getFileSink()?.({ level: "info", ns: "t", msg: "should-not-appear", ts: 1 });
    expect(nodeFs.existsSync(logPath)).toBe(false);

    expect(configureFileOutputFromEnv({ PI_WEB_LOG_FILE: logPath })).toBe(true);
    getFileSink()?.({ level: "info", ns: "t", msg: "hello", ts: 1 });
    const written = nodeFs.readFileSync(logPath, "utf8");
    expect(written).toContain("hello");
    expect(written).not.toContain("should-not-appear");
  });

  it("未设 PI_WEB_LOG_FILE → 返回 false 且不动既有 sink（不误关已配的输出）", async () => {
    const { configureFileOutputFromEnv, getFileSink, configureFileOutput } = await import(
      "../config.js"
    );
    const logPath = nodePath.join(envTmpDir, "keep.log");
    configureFileOutput({ enabled: true, path: logPath, maxSizeMb: 1, maxFiles: 1 });

    expect(configureFileOutputFromEnv({})).toBe(false);
    expect(configureFileOutputFromEnv({ PI_WEB_LOG_FILE: "   " })).toBe(false);

    // 既有输出仍然有效 —— 空 env 不得把已配好的文件输出悄悄关掉。
    getFileSink()?.({ level: "info", ns: "t", msg: "kept", ts: 1 });
    expect(nodeFs.readFileSync(logPath, "utf8")).toContain("kept");
  });

  it("非法 maxSize/maxFiles 落回缺省，不产出坏配置", async () => {
    const { configureFileOutputFromEnv, getFileSink } = await import("../config.js");
    const logPath = nodePath.join(envTmpDir, "bad-nums.log");
    expect(
      configureFileOutputFromEnv({
        PI_WEB_LOG_FILE: logPath,
        PI_WEB_LOG_FILE_MAXSIZE: "not-a-number",
        PI_WEB_LOG_FILE_MAXFILES: "-3",
      }),
    ).toBe(true);
    getFileSink()?.({ level: "info", ns: "t", msg: "still works", ts: 1 });
    expect(nodeFs.readFileSync(logPath, "utf8")).toContain("still works");
  });

  it("env 缺席（浏览器环境）→ 返回 false 而非抛", async () => {
    const { configureFileOutputFromEnv } = await import("../config.js");
    expect(configureFileOutputFromEnv(undefined)).toBe(false);
  });
});
