/**
 * 真实 tmp 目录驱动 createZip / extractZip（含 zip-slip）。
 */
import { describe, expect, it, beforeEach, afterEach } from "vitest";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  createZip,
  extractZip,
  writeZipEntries,
} from "../../src/archive/zip-ops.js";

describe("zip-ops", () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(path.join(tmpdir(), "pi-archive-zip-"));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("zip then unzip restores byte-equal content", async () => {
    const srcDir = path.join(root, "src");
    mkdirSync(srcDir, { recursive: true });
    const payload = Buffer.from("hello-archive-roundtrip-" + Date.now());
    writeFileSync(path.join(srcDir, "note.txt"), payload);
    mkdirSync(path.join(srcDir, "nested"), { recursive: true });
    writeFileSync(path.join(srcDir, "nested", "x.bin"), Buffer.from([1, 2, 3, 4]));

    const zipped = await createZip(root, ["src"], "out/pack.zip");
    expect(zipped.ok).toBe(true);
    if (!zipped.ok) return;
    expect(zipped.entryCount).toBeGreaterThanOrEqual(2);
    expect(existsSync(path.join(root, "out/pack.zip"))).toBe(true);

    const extracted = extractZip(root, "out/pack.zip", "restored");
    expect(extracted.ok).toBe(true);
    if (!extracted.ok) return;
    expect(extracted.extracted).toBeGreaterThanOrEqual(2);

    const got = readFileSync(path.join(root, "restored/src/note.txt"));
    expect(Buffer.compare(got, payload)).toBe(0);
    expect(
      Buffer.compare(
        readFileSync(path.join(root, "restored/src/nested/x.bin")),
        Buffer.from([1, 2, 3, 4]),
      ),
    ).toBe(0);
  });

  it("rejects zip-slip entry and does not write outside extract root", () => {
    const evilZip = path.join(root, "evil.zip");
    writeZipEntries(evilZip, [
      { name: "../pwned.txt", data: Buffer.from("PWNED") },
      { name: "safe.txt", data: Buffer.from("ok") },
    ]);

    const dest = path.join(root, "extract");
    mkdirSync(dest, { recursive: true });
    const outside = path.join(root, "pwned.txt");

    const result = extractZip(root, "evil.zip", "extract");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("PATH_ESCAPE");
    expect(existsSync(outside)).toBe(false);
    // 整次失败：也不应留下 safe 的半成品（预检失败在写盘前）
    expect(existsSync(path.join(dest, "safe.txt"))).toBe(false);
  });

  it("rejects output path outside root", async () => {
    writeFileSync(path.join(root, "a.txt"), "x");
    const r = await createZip(root, ["a.txt"], "../out.zip");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("PATH_ESCAPE");
  });
});
