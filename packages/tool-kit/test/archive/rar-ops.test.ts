/**
 * unrar：有后端则尽力提取；无后端或无法解析 → 明确 RAR_BACKEND_UNAVAILABLE / IO。
 */
import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  detectRarBackend,
  extractRar,
  writePlaceholderRar,
} from "../../src/archive/rar-ops.js";

describe("rar-ops", () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(path.join(tmpdir(), "pi-archive-rar-"));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("returns clear failure when archive missing", () => {
    const r = extractRar(root, "nope.rar", "out");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("NOT_FOUND");
  });

  it("returns RAR_BACKEND_UNAVAILABLE or extract error for placeholder rar", () => {
    writePlaceholderRar(path.join(root, "x.rar"));
    const backend = detectRarBackend();
    const r = extractRar(root, "x.rar", "out");
    expect(r.ok).toBe(false);
    if (!r.ok) {
      // 无后端 → RAR_BACKEND_UNAVAILABLE；有后端但体非法 → 同类或 IO_ERROR
      expect(
        ["RAR_BACKEND_UNAVAILABLE", "IO_ERROR", "INVALID_ARCHIVE"].includes(
          r.code,
        ),
      ).toBe(true);
      expect(r.message.length).toBeGreaterThan(0);
    }
    // 记录探测结果便于证据日志
    void backend;
  });

  it("rejects destination escape", () => {
    writePlaceholderRar(path.join(root, "x.rar"));
    const r = extractRar(root, "x.rar", "../out");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("PATH_ESCAPE");
  });
});
