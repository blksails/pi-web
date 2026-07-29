/**
 * 单元:ScanSourceProvider —— 扫描根一级子目录 + probeEntry 判定 + realpath 门控。
 *
 * 覆盖 Req 2.1(枚举一级子目录)、2.2(含 index.ts→custom)、2.3(无入口→cli)、
 * 2.4(可提交路径=realpath 绝对路径)、2.5/6.2(符号链接逃逸根被剔除)、非目录忽略。
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createScanSourceProvider } from "../../src/agent-source-list/index.js";

let root: string; // 扫描根
let outside: string; // 根之外的目录(供符号链接逃逸测试)

beforeEach(async () => {
  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  root = join(tmpdir(), `scan-root-${stamp}`);
  outside = join(tmpdir(), `scan-outside-${stamp}`);
  await fs.mkdir(root, { recursive: true });
  await fs.mkdir(outside, { recursive: true });
});

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
  await fs.rm(outside, { recursive: true, force: true });
});

async function mkAgentDir(name: string, withEntry: boolean): Promise<string> {
  const dir = join(root, name);
  await fs.mkdir(dir, { recursive: true });
  if (withEntry) await fs.writeFile(join(dir, "index.ts"), "export default {}\n");
  return dir;
}

describe("ScanSourceProvider", () => {
  it("含 index.ts 的子目录 → custom;可提交 source 为 realpath 绝对路径", async () => {
    await mkAgentDir("custom-agent", true);
    const provider = createScanSourceProvider({ roots: [root] });
    const records = await provider.list();
    expect(records).toHaveLength(1);
    const rec = records[0]!;
    expect(rec.mode).toBe("custom");
    expect(rec.kind).toBe("dir");
    expect(rec.origin).toBe("scan");
    // source = realpath(候选目录);会话创建链路可直接接受。
    expect(rec.source).toBe(await fs.realpath(join(root, "custom-agent")));
    expect(rec.id).toBe(rec.source);
  });

  it("无入口文件的子目录 → cli 模式", async () => {
    await mkAgentDir("plain-dir", false);
    const provider = createScanSourceProvider({ roots: [root] });
    const records = await provider.list();
    expect(records).toHaveLength(1);
    expect(records[0]!.mode).toBe("cli");
  });

  it("使用 package.json 的 name 与 description(存在时)", async () => {
    const dir = await mkAgentDir("named", true);
    await fs.writeFile(
      join(dir, "package.json"),
      JSON.stringify({ name: "My Named Agent", description: "hello" }),
    );
    const provider = createScanSourceProvider({ roots: [root] });
    const rec = (await provider.list())[0]!;
    expect(rec.name).toBe("My Named Agent");
    expect(rec.description).toBe("hello");
  });

  it("读取 package.json 的 pi-web 展示元数据(title/description/avatar)", async () => {
    const dir = await mkAgentDir("rich", true);
    await fs.writeFile(
      join(dir, "package.json"),
      JSON.stringify({
        name: "rich-pkg",
        description: "top-level desc",
        "pi-web": {
          title: "Rich Agent",
          description: "pi-web desc",
          avatar: "https://example.com/a.png",
        },
      }),
    );
    const rec = (await createScanSourceProvider({ roots: [root] }).list())[0]!;
    expect(rec.name).toBe("rich-pkg"); // 技术名仍来自 package.json name
    expect(rec.title).toBe("Rich Agent");
    expect(rec.description).toBe("pi-web desc"); // pi-web.description 覆盖顶层
    expect(rec.avatar).toBe("https://example.com/a.png");
  });

  it("pi-web 缺省时回退顶层 description,无 title/avatar", async () => {
    const dir = await mkAgentDir("plain-meta", true);
    await fs.writeFile(
      join(dir, "package.json"),
      JSON.stringify({ name: "p", description: "only top" }),
    );
    const rec = (await createScanSourceProvider({ roots: [root] }).list())[0]!;
    expect(rec.description).toBe("only top");
    expect(rec.title).toBeUndefined();
    expect(rec.avatar).toBeUndefined();
  });

  it("忽略非目录条目(文件)", async () => {
    await mkAgentDir("real-agent", true);
    await fs.writeFile(join(root, "stray-file.txt"), "x");
    const provider = createScanSourceProvider({ roots: [root] });
    const records = await provider.list();
    expect(records.map((r) => r.name)).toEqual(["real-agent"]);
  });

  it("剔除经符号链接逃逸扫描根的候选(Req 2.5/6.2)", async () => {
    // 在根内放一个指向根之外目录的符号链接。
    const escapeLink = join(root, "escape");
    try {
      await fs.symlink(outside, escapeLink, "dir");
    } catch {
      // 某些平台/权限不支持 symlink → 跳过该断言(在支持的平台上门控被验证)。
      return;
    }
    await mkAgentDir("legit", true);
    const provider = createScanSourceProvider({ roots: [root] });
    const records = await provider.list();
    // escape 逃逸根 → 剔除;仅剩 legit。
    expect(records.map((r) => r.name)).toEqual(["legit"]);
  });

  it("root 不存在 → 返回空,不抛", async () => {
    const provider = createScanSourceProvider({
      roots: [join(tmpdir(), "does-not-exist-xyz")],
    });
    await expect(provider.list()).resolves.toEqual([]);
  });
});
