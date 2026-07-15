import { describe, expect, it } from "vitest";
import path from "node:path";
import {
  isInsideRoot,
  resolveUnderRoot,
  resolveZipEntry,
} from "../../src/archive/path-safety.js";

const root = path.resolve("/tmp/archive-root-fixture");

describe("path-safety", () => {
  it("accepts relative paths under root", () => {
    const r = resolveUnderRoot(root, "a/b.txt");
    expect(r.ok).toBe(true);
    if (r.ok) expect(isInsideRoot(root, r.abs)).toBe(true);
  });

  it("rejects .. escape", () => {
    const r = resolveUnderRoot(root, "../outside");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("PATH_ESCAPE");
  });

  it("rejects absolute path outside root", () => {
    const r = resolveUnderRoot(root, "/etc/passwd");
    expect(r.ok).toBe(false);
  });

  it("resolveZipEntry rejects absolute and parent entries", () => {
    expect(resolveZipEntry(root, "/etc/passwd").ok).toBe(false);
    expect(resolveZipEntry(root, "../evil.txt").ok).toBe(false);
    expect(resolveZipEntry(root, "ok/file.txt").ok).toBe(true);
  });
});
