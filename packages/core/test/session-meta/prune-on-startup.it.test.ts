/**
 * 启动时清理残留的**接线语义**(spec session-meta-index, Req 5.3)。
 *
 * `prune` 本身的语义在 `prune.it.test.ts`;这里验的是启动接线该有的行为契约:
 *  - 现存会话集合取自**存储**(而非索引自身),否则等于拿脏数据自证清白;
 *  - 存储读失败时不得抛出(装配期不能被元数据拖垮);
 *  - 清理是幂等的,重启多次不会越清越多。
 *
 * ★ 不直接 import pi-handler:它是应用装配层(拉起 pi SDK 等一大票依赖),
 *   在内核包测试里加载它既慢又越界。故此处复刻其接线**形状**并断言其行为契约;
 *   接线本身是否存在由 `lib/app/pi-handler.ts` 的类型检查与真机启动保证。
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FsSessionEntryStore } from "../../src/session-store/index.js";
import { JsonFileSessionMetaIndex } from "../../src/session-meta/index.js";
import type { SessionEntryStore } from "../../src/session-store/types.js";

let dir: string;
let indexPath: string;
const cwd = "/tmp/prune-startup-proj";

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "prune-startup-"));
  indexPath = join(dir, "piweb-session-index.json");
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

/** 复刻 pi-handler 的启动清理接线(fire-and-forget + 吞错)。 */
async function pruneOnStartup(
  index: JsonFileSessionMetaIndex,
  createStore: () => Promise<SessionEntryStore>,
): Promise<number | undefined> {
  try {
    const store = await createStore();
    const existing = (await store.listAll()).map((m) => m.sessionId);
    return await index.prune(existing);
  } catch {
    return undefined; // 静默:装配期不得被元数据拖垮
  }
}

async function seed(ids: readonly string[]): Promise<FsSessionEntryStore> {
  const store = new FsSessionEntryStore(dir);
  for (const [i, id] of ids.entries()) {
    await store.create({
      type: "session",
      id,
      version: 1,
      cwd,
      timestamp: `2026-06-01T00:00:0${i}.000Z`,
    });
  }
  return store;
}

describe("启动时清理索引残留", () => {
  it("现存会话集合取自存储:存储里没有的键被清掉,有的保留", async () => {
    const store = await seed(["alive1", "alive2"]);
    const idx = new JsonFileSessionMetaIndex({ path: indexPath });
    for (const id of ["alive1", "alive2", "ghost1", "ghost2", "ghost3"]) {
      await idx.merge(id, { title: `t-${id}` });
    }

    const removed = await pruneOnStartup(idx, async () => store);

    expect(removed).toBe(3);
    expect([...(await idx.read()).keys()].sort()).toEqual(["alive1", "alive2"]);
  });

  it("重复启动是幂等的:第二次没有可清的,返回 0 且内容不变", async () => {
    const store = await seed(["alive"]);
    const idx = new JsonFileSessionMetaIndex({ path: indexPath });
    await idx.merge("alive", { title: "keep" });
    await idx.merge("ghost", { title: "drop" });

    expect(await pruneOnStartup(idx, async () => store)).toBe(1);
    const after1 = await idx.read();
    expect(await pruneOnStartup(idx, async () => store)).toBe(0);
    expect([...(await idx.read()).keys()]).toEqual([...after1.keys()]);
  });

  it("★ 存储不可用时静默跳过,且**不清空**索引(不能把读不到当成没有会话)", async () => {
    const idx = new JsonFileSessionMetaIndex({ path: indexPath });
    await idx.merge("s1", { title: "must survive" });

    const removed = await pruneOnStartup(idx, () =>
      Promise.reject(new Error("store unavailable")),
    );

    expect(removed).toBeUndefined();
    // 这是最要紧的一条:store 挂了却照常 prune,会把整份索引当残留清空
    expect((await idx.read()).get("s1")?.title).toBe("must survive");
  });

  it("listAll 抛错同样静默,索引不受损", async () => {
    const idx = new JsonFileSessionMetaIndex({ path: indexPath });
    await idx.merge("s1", { title: "must survive" });
    const hostile = {
      listAll: () => Promise.reject(new Error("listAll blew up")),
    } as unknown as SessionEntryStore;

    expect(await pruneOnStartup(idx, async () => hostile)).toBeUndefined();
    expect((await idx.read()).get("s1")?.title).toBe("must survive");
  });

  it("索引为空时清理不抛且返回 0", async () => {
    const store = await seed(["a"]);
    const idx = new JsonFileSessionMetaIndex({ path: indexPath });
    expect(await pruneOnStartup(idx, async () => store)).toBe(0);
  });
});
