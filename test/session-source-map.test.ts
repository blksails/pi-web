/**
 * session-source-map 单测 —— app 级 `sessionId → source` 映射的读写/清理与
 * 路径穿越防护。每个用例用独立临时目录(经 `PI_WEB_SESSION_SOURCE_DIR` 覆盖),
 * 互不干扰。
 */
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  forgetSessionSource,
  lookupSessionSource,
  recordSessionSource,
} from "@/lib/app/session-source-map";

const ID = "6acb5fe1-af90-4642-951f-30e324238ae5";
const SOURCE = "./examples/webext-layout-agent";

let dir: string;

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), "piweb-src-map-"));
  process.env.PI_WEB_SESSION_SOURCE_DIR = dir;
});

afterEach(async () => {
  delete process.env.PI_WEB_SESSION_SOURCE_DIR;
  await fs.rm(dir, { recursive: true, force: true });
});

describe("session-source-map", () => {
  it("record → lookup 取回写入的 source", async () => {
    await recordSessionSource(ID, SOURCE);
    expect(await lookupSessionSource(ID)).toBe(SOURCE);
  });

  it("未记录的 id → undefined", async () => {
    expect(await lookupSessionSource(ID)).toBeUndefined();
  });

  it("record 覆盖同一 id 的旧值", async () => {
    await recordSessionSource(ID, SOURCE);
    await recordSessionSource(ID, "./examples/webext-slots-agent");
    expect(await lookupSessionSource(ID)).toBe("./examples/webext-slots-agent");
  });

  it("forget 后 lookup → undefined", async () => {
    await recordSessionSource(ID, SOURCE);
    await forgetSessionSource(ID);
    expect(await lookupSessionSource(ID)).toBeUndefined();
  });

  it("forget 不存在的 id 不抛错", async () => {
    await expect(forgetSessionSource(ID)).resolves.toBeUndefined();
  });

  it("惰性建目录:目录不存在时 record 仍成功", async () => {
    const nested = path.join(dir, "deep", "nested");
    process.env.PI_WEB_SESSION_SOURCE_DIR = nested;
    await recordSessionSource(ID, SOURCE);
    expect(await lookupSessionSource(ID)).toBe(SOURCE);
  });

  it("非法 id(路径穿越)record 不落盘、lookup 返回 undefined", async () => {
    const evil = "../escape";
    await recordSessionSource(evil, SOURCE);
    // 既不在映射目录内写出文件,也不读到父目录的内容。
    expect(await lookupSessionSource(evil)).toBeUndefined();
    const parentEscape = path.resolve(dir, "..", "escape");
    await expect(fs.access(parentEscape)).rejects.toThrow();
  });

  it("非法 id(含斜杠 / 点)一律拒绝", async () => {
    for (const bad of ["a/b", ".", "..", "a.b", "with space", ""]) {
      await recordSessionSource(bad, SOURCE);
      expect(await lookupSessionSource(bad)).toBeUndefined();
    }
  });

  it("空内容文件视作无记录(undefined)", async () => {
    await fs.writeFile(path.join(dir, ID), "", "utf8");
    expect(await lookupSessionSource(ID)).toBeUndefined();
  });
});
