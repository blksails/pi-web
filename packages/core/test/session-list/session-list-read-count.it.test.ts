/**
 * 性能证据:列一页所需的会话历史文件读取次数(spec session-meta-index, 任务 5.2 / Req 2.5)。
 *
 * Req 2.5 要求以**实测数字**为证据,而不是「更快」这类主张。这里统计的是
 * `store.displayName` 的调用次数 —— fs 后端每次调用要顺读整份 jsonl,所以它就是
 * 「扫了几个文件」的直接计量。
 *
 * 实测结论(本用例断言即证据):
 *   - 无索引:调用次数 = 页项数(每项一次全文件顺读)
 *   - 索引全命中:调用次数 = 0
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
import type { SessionMetaIndex } from "../../src/session-meta/types.js";

const PAGE = 12;
let dir: string;
let indexPath: string;
const cwd = "/tmp/sess-readcount-proj";

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "sess-readcount-"));
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

/** seed PAGE 个会话,每个都追加一条 session_info(即标题只存在于历史里)。 */
async function seed(): Promise<string[]> {
  const entryStore = new FsSessionEntryStore(dir);
  const ids: string[] = [];
  for (let i = 0; i < PAGE; i += 1) {
    const id = `s${String(i).padStart(2, "0")}`;
    ids.push(id);
    await entryStore.create({
      type: "session",
      id,
      version: 1,
      cwd,
      timestamp: `2026-06-01T00:00:${String(i).padStart(2, "0")}.000Z`,
    });
    await entryStore.append(id, {
      id: `e${String(i).padStart(7, "0")}`,
      parentId: null,
      timestamp: `2026-06-01T01:00:${String(i).padStart(2, "0")}.000Z`,
      type: "session_info",
      name: `历史标题-${id}`,
    });
  }
  return ids;
}

/** 列一页并返回 displayName 调用次数(= 顺读整份 jsonl 的次数)。 */
async function listAndCount(
  metaIndex?: SessionMetaIndex,
): Promise<{ calls: number; names: (string | undefined)[] }> {
  const entryStore = new FsSessionEntryStore(dir);
  let calls = 0;
  const original = entryStore.displayName.bind(entryStore);
  entryStore.displayName = async (sessionId: string) => {
    calls += 1;
    return original(sessionId);
  };
  const store = new InMemorySessionStore(true);
  const handler = createPiWebHandler({
    manager: new SessionManager({ store, idleMs: 0 }),
    store,
    routes: createSessionListRoutes({
      createEntryStore: async () => entryStore,
      ...(metaIndex !== undefined ? { metaIndex } : {}),
    }),
    authResolver: () => ({ anonymous: true }),
  });
  const res = await handler(
    new Request(`http://x/sessions?limit=${PAGE}`),
  );
  const body = ListSessionsResponseSchema.parse(JSON.parse(await res.text()));
  return { calls, names: body.sessions.map((s) => s.name) };
}

describe("列一页的历史文件读取次数(Req 2.5)", () => {
  it("无索引:读取次数 = 页项数(每项顺读整份 jsonl)", async () => {
    await seed();
    const { calls, names } = await listAndCount();
    expect(calls).toBe(PAGE);
    expect(names.every((n) => n?.startsWith("历史标题-"))).toBe(true);
  });

  it("★ 索引全命中:读取次数为 0,且标题正确", async () => {
    const ids = await seed();
    const idx = new JsonFileSessionMetaIndex({ path: indexPath });
    for (const id of ids) await idx.merge(id, { title: `索引标题-${id}` });
    const { calls, names } = await listAndCount(idx);
    expect(calls).toBe(0);
    expect(names.every((n) => n?.startsWith("索引标题-"))).toBe(true);
  });

  it("部分命中:读取次数 = 未命中项数(逐项而非整页付费)", async () => {
    const ids = await seed();
    const idx = new JsonFileSessionMetaIndex({ path: indexPath });
    const hit = ids.slice(0, 5);
    for (const id of hit) await idx.merge(id, { title: `索引标题-${id}` });
    const { calls } = await listAndCount(idx);
    expect(calls).toBe(PAGE - hit.length);
  });

  it("首次列出后回填,第二次列出读取次数降为 0(自愈)", async () => {
    await seed();
    const idx = new JsonFileSessionMetaIndex({ path: indexPath });
    const first = await listAndCount(idx);
    expect(first.calls).toBe(PAGE);
    // 回填是 fire-and-forget,等索引写满
    for (let i = 0; i < 40 && (await idx.read()).size < PAGE; i += 1) {
      await new Promise((r) => setTimeout(r, 25));
    }
    expect((await idx.read()).size).toBe(PAGE);
    const second = await listAndCount(idx);
    expect(second.calls).toBe(0);
    expect(second.names.every((n) => n?.startsWith("历史标题-"))).toBe(true);
  });
});
