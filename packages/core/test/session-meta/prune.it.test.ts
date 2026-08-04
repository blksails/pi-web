/**
 * 元数据残留治理(spec session-meta-index, 任务 5.1 / Req 5.2, 5.3)。
 *
 * 索引对会话是**弱引用**:键可能对应已不存在的会话(外部删除文件、跨机器拷贝等)。
 * 两条保证:① 列表以实际存在的会话为准,残留键**不出现**在响应里;② prune 能按现存
 * 会话集合清掉残留,防止索引无界增长。
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ListSessionsResponseSchema } from "@blksails/pi-web-protocol";
import { createPiWebHandler } from "../../src/http/index.js";
import { InMemorySessionStore } from "../../src/session/session-store.js";
import { SessionManager } from "../../src/session/session-manager.js";
import { FsSessionEntryStore } from "../../src/session-store/index.js";
import { createSessionListRoutes } from "../../src/session-list/index.js";
import { JsonFileSessionMetaIndex } from "../../src/session-meta/index.js";

let dir: string;
let indexPath: string;
const cwd = "/tmp/sess-prune-proj";

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "sess-prune-"));
  indexPath = join(dir, "piweb-session-index.json");
});

afterEach(async () => {
  for (let i = 0; i < 20; i += 1) {
    try {
      await rm(dir, { recursive: true, force: true });
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 25));
    }
  }
});

describe("残留条目不进列表(Req 5.2)", () => {
  it("索引有键但会话不存在 → 该会话不出现在列表中", async () => {
    const entryStore = new FsSessionEntryStore(dir);
    await entryStore.create({
      type: "session",
      id: "alive",
      version: 1,
      cwd,
      timestamp: "2026-06-01T00:00:01.000Z",
    });
    const idx = new JsonFileSessionMetaIndex({ path: indexPath });
    await idx.merge("alive", { title: "活着的会话" });
    // 幽灵键:索引里有,存储里没有
    await idx.merge("ghost", { title: "幽灵会话", agentSource: "builtin:ghost" });

    const store = new InMemorySessionStore(true);
    const handler = createPiWebHandler({
      manager: new SessionManager({ store, idleMs: 0 }),
      store,
      routes: createSessionListRoutes({
        createEntryStore: async () => entryStore,
        metaIndex: idx,
      }),
      authResolver: () => ({ anonymous: true }),
    });
    const res = await handler(new Request("http://x/sessions"));
    const body = ListSessionsResponseSchema.parse(JSON.parse(await res.text()));
    expect(body.sessions.map((s) => s.sessionId)).toEqual(["alive"]);
    // 索引里仍有幽灵键(列表只是不呈现它),需靠 prune 清
    expect((await idx.read()).has("ghost")).toBe(true);
  });
});

describe("prune 清残留(Req 5.3)", () => {
  it("按现存会话集合清理,返回清除条数,只留现存键", async () => {
    const entryStore = new FsSessionEntryStore(dir);
    for (const id of ["s1", "s2"]) {
      await entryStore.create({
        type: "session",
        id,
        version: 1,
        cwd,
        timestamp: `2026-06-01T00:00:0${id === "s1" ? "1" : "2"}.000Z`,
      });
    }
    const idx = new JsonFileSessionMetaIndex({ path: indexPath });
    for (const id of ["s1", "s2", "gone1", "gone2", "gone3"]) {
      await idx.merge(id, { title: `t-${id}` });
    }
    expect((await idx.read()).size).toBe(5);

    // 现存会话集合来自存储(而非索引自身)——这正是「以实际会话为准」
    const existing = (await entryStore.list(cwd)).map((m) => m.sessionId);
    const removed = await idx.prune(existing);

    expect(removed).toBe(3);
    expect([...(await idx.read()).keys()].sort()).toEqual(["s1", "s2"]);
  });

  it("无残留时 prune 返回 0 且不改动索引内容", async () => {
    const idx = new JsonFileSessionMetaIndex({ path: indexPath });
    await idx.merge("s1", { title: "t1" });
    const before = await idx.read();
    const removed = await idx.prune(["s1"]);
    expect(removed).toBe(0);
    expect([...(await idx.read()).keys()]).toEqual([...before.keys()]);
  });

  it("传空集合 → 清空全部条目(明确语义,不是 no-op)", async () => {
    const idx = new JsonFileSessionMetaIndex({ path: indexPath });
    await idx.merge("s1", { title: "t1" });
    await idx.merge("s2", { title: "t2" });
    expect(await idx.prune([])).toBe(2);
    expect((await idx.read()).size).toBe(0);
  });
});
