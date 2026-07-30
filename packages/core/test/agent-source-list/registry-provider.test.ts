/**
 * 单元:RegistrySourceProvider —— 读 JSON manifest,容错。
 *
 * 覆盖 Req 3.1(合法读取)、3.2(缺失→[])、3.3(坏 JSON→[] / 坏条目跳过)、
 * 3.4(git 条目 kind=git 且不 clone/无副作用)。
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRegistrySourceProvider } from "../../src/agent-source-list/index.js";

let dir: string;
let registryPath: string;

beforeEach(async () => {
  dir = join(
    tmpdir(),
    `registry-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  await fs.mkdir(dir, { recursive: true });
  registryPath = join(dir, "sources.json");
});

afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

describe("RegistrySourceProvider", () => {
  it("读取合法 manifest,采用声明的 name/description", async () => {
    await fs.writeFile(
      registryPath,
      JSON.stringify({
        sources: [
          { source: "/abs/path/to/agent", name: "My Agent", description: "d" },
        ],
      }),
    );
    const rec = (
      await createRegistrySourceProvider({ registryPath }).list()
    )[0]!;
    expect(rec.source).toBe("/abs/path/to/agent");
    expect(rec.name).toBe("My Agent");
    expect(rec.description).toBe("d");
    expect(rec.origin).toBe("registry");
    expect(rec.kind).toBe("dir");
    expect(rec.id).toBe("/abs/path/to/agent");
  });

  it("文件不存在 → 返回空(Req 3.2)", async () => {
    const provider = createRegistrySourceProvider({
      registryPath: join(dir, "nope.json"),
    });
    await expect(provider.list()).resolves.toEqual([]);
  });

  it("坏 JSON → 返回空,不抛(Req 3.3)", async () => {
    await fs.writeFile(registryPath, "{ not json ]");
    await expect(
      createRegistrySourceProvider({ registryPath }).list(),
    ).resolves.toEqual([]);
  });

  it("跳过坏条目,保留其余(Req 3.3)", async () => {
    await fs.writeFile(
      registryPath,
      JSON.stringify({
        sources: [
          { name: "no-source-field" }, // 缺 source → 跳过
          42, // 非对象 → 跳过
          { source: "/good/one", name: "Good" },
        ],
      }),
    );
    const recs = await createRegistrySourceProvider({ registryPath }).list();
    expect(recs.map((r) => r.name)).toEqual(["Good"]);
  });

  it("登记项可声明 title/description/avatar", async () => {
    await fs.writeFile(
      registryPath,
      JSON.stringify({
        sources: [
          {
            source: "/abs/agent",
            name: "n",
            title: "T",
            description: "d",
            avatar: "🤖",
          },
        ],
      }),
    );
    const rec = (
      await createRegistrySourceProvider({ registryPath }).list()
    )[0]!;
    expect(rec.title).toBe("T");
    expect(rec.description).toBe("d");
    expect(rec.avatar).toBe("🤖");
  });

  it("git 条目:kind=git,id=url@ref,且不发生 clone(Req 3.4)", async () => {
    await fs.writeFile(
      registryPath,
      JSON.stringify({
        sources: [{ source: "git:github.com/org/repo@main", name: "Remote" }],
      }),
    );
    const before = await fs.readdir(dir);
    const rec = (
      await createRegistrySourceProvider({ registryPath }).list()
    )[0]!;
    expect(rec.kind).toBe("git");
    expect(rec.id).toBe("https://github.com/org/repo.git@main");
    // 无副作用:目录内容不变(未 clone 任何东西)。
    expect(await fs.readdir(dir)).toEqual(before);
  });
});
