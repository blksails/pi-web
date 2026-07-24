/**
 * 单元:FavoritesStore —— 原子读写 + 容错(Req 4.1/4.2/4.7/6.3)。
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createFavoritesStore } from "../../src/agent-source-list/index.js";

let dir: string;
let filePath: string;

beforeEach(async () => {
  dir = join(
    tmpdir(),
    `fav-store-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  await fs.mkdir(dir, { recursive: true });
  filePath = join(dir, "agent-source-favorites.json");
});
afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

describe("FavoritesStore", () => {
  it("文件缺失 → 返回空(Req 4.7)", async () => {
    await expect(createFavoritesStore({ root: dir }).list()).resolves.toEqual([]);
  });

  it("坏 JSON → 返回空,不抛(Req 4.7)", async () => {
    await fs.writeFile(filePath, "{ not json ]");
    await expect(createFavoritesStore({ root: dir }).list()).resolves.toEqual([]);
  });

  it("坏条目跳过,保留其余(Req 4.7)", async () => {
    await fs.writeFile(
      filePath,
      JSON.stringify({
        favorites: [
          { name: "no-source" }, // 缺 source → 跳过
          42, // 非对象 → 跳过
          { source: "/good", name: "Good" },
        ],
      }),
    );
    const favs = await createFavoritesStore({ root: dir }).list();
    expect(favs).toEqual([{ source: "/good", name: "Good" }]);
  });

  it("set 全量替换,list 回读一致(Req 4.1/4.2)", async () => {
    const store = createFavoritesStore({ root: dir });
    await store.set([
      { source: "/a", name: "A" },
      { source: "/b", name: "B" },
    ]);
    expect(await store.list()).toEqual([
      { source: "/a", name: "A" },
      { source: "/b", name: "B" },
    ]);
    // 再次 set 覆盖(全量替换语义)。
    await store.set([{ source: "/c", name: "C" }]);
    expect(await store.list()).toEqual([{ source: "/c", name: "C" }]);
  });

  it("set 只写该偏好文件,目录其余不变(Req 6.3)", async () => {
    await fs.writeFile(join(dir, "unrelated.txt"), "keep");
    const before = (await fs.readdir(dir)).sort();
    await createFavoritesStore({ root: dir }).set([{ source: "/x", name: "X" }]);
    const after = (await fs.readdir(dir)).sort();
    // 仅新增收藏文件,未动其它文件;临时文件已 rename 掉不残留。
    expect(after).toEqual([...before, "agent-source-favorites.json"].sort());
    expect(await fs.readFile(join(dir, "unrelated.txt"), "utf8")).toBe("keep");
  });
});
