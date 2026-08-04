/**
 * 已接受边界的显式确认(spec session-meta-index, 任务 5.5 / Req 8.5, 9.6, 9.7)。
 *
 * 这些**不是缺陷**,是本期有意接受的行为边界。用测试把它们钉住,避免日后被当 bug
 * 反复调查、或被"顺手修好"而扩大范围。
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
const cwd = "/tmp/sess-legacy-proj";

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "sess-legacy-"));
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

/** 模拟「本特性启用之前就存在」的会话:历史里有标题,但索引里什么都没有。 */
async function seedLegacy(id: string, withTitle: boolean): Promise<FsSessionEntryStore> {
  const entryStore = new FsSessionEntryStore(dir);
  await entryStore.create({
    type: "session",
    id,
    version: 1,
    cwd,
    timestamp: "2026-05-01T00:00:01.000Z",
  });
  if (withTitle) {
    await entryStore.append(id, {
      id: "e0000001",
      parentId: null,
      timestamp: "2026-05-01T00:10:00.000Z",
      type: "session_info",
      name: "启用前就有的标题",
    });
  }
  return entryStore;
}

function makeHandler(
  entryStore: FsSessionEntryStore,
  idx: JsonFileSessionMetaIndex,
): (req: Request) => Promise<Response> {
  const store = new InMemorySessionStore(true);
  return createPiWebHandler({
    manager: new SessionManager({ store, idleMs: 0 }),
    store,
    routes: createSessionListRoutes({
      createEntryStore: async () => entryStore,
      metaIndex: idx,
    }),
    authResolver: () => ({ anonymous: true }),
  });
}

async function listOne(
  handler: (req: Request) => Promise<Response>,
): Promise<ReturnType<typeof ListSessionsResponseSchema.parse>["sessions"][number]> {
  const res = await handler(
    new Request("http://x/sessions"),
  );
  const body = ListSessionsResponseSchema.parse(JSON.parse(await res.text()));
  const first = body.sessions[0];
  expect(first).toBeDefined();
  return first!;
}

describe("存量会话:来源无从补齐(Req 9.6 —— 已接受,非缺陷)", () => {
  it("启用前创建的会话没有 source 字段,且不显示来源(不用 cwd 冒充)", async () => {
    const entryStore = await seedLegacy("legacy1", true);
    const idx = new JsonFileSessionMetaIndex({ path: indexPath });
    const item = await listOne(makeHandler(entryStore, idx));
    // ★ 这是有意的:agent-source 这个事实从未被写进会话历史,索引再怎么重建也造不出来。
    expect(item.source).toBeUndefined();
  });
});

describe("存量会话:标题可回填(Req 9.7)", () => {
  it("历史里有标题 → 首次列出即取到,并被补进索引", async () => {
    const entryStore = await seedLegacy("legacy2", true);
    const idx = new JsonFileSessionMetaIndex({ path: indexPath });
    const item = await listOne(makeHandler(entryStore, idx));
    expect(item.name).toBe("启用前就有的标题");
    for (let i = 0; i < 40 && (await idx.read()).get("legacy2") === undefined; i += 1) {
      await new Promise((r) => setTimeout(r, 25));
    }
    expect((await idx.read()).get("legacy2")?.title).toBe("启用前就有的标题");
  });

  it("历史里也没有标题 → 列表回落到会话标识,不报错", async () => {
    const entryStore = await seedLegacy("legacy3", false);
    const idx = new JsonFileSessionMetaIndex({ path: indexPath });
    const item = await listOne(makeHandler(entryStore, idx));
    expect(item.sessionId).toBe("legacy3");
    expect(item.name).toBeUndefined();
  });
});

describe("跨会话活跃态的即时性(Req 8.5 —— 已接受的边界)", () => {
  it("活跃态在每次列表请求时按当刻查询;两次请求之间的变化只在下次请求可见", async () => {
    const entryStore = await seedLegacy("s1", false);
    const idx = new JsonFileSessionMetaIndex({ path: indexPath });
    // 可变的活跃态源:模拟「另一个会话在两次请求之间开始忙」
    let busy = false;
    const store = new InMemorySessionStore(true);
    const handler = createPiWebHandler({
      manager: new SessionManager({ store, idleMs: 0 }),
      store,
      routes: createSessionListRoutes({
        createEntryStore: async () => entryStore,
        metaIndex: idx,
        activityOf: () => (busy ? "working" : undefined),
      }),
      authResolver: () => ({ anonymous: true }),
    });

    // 第一次请求:空闲
    expect((await listOne(handler)).activity).toBeUndefined();
    // 会话开始忙 —— 本期**没有**推送通道通知列表,变化只体现在下一次请求
    busy = true;
    expect((await listOne(handler)).activity).toBe("working");
    // ★ 结论:列表的即时性由「何时重拉」决定(前端在忙态/交互边沿 bump 刷新信号),
    //   而非由服务端推送。跨会话的即时可见性不在本期范围内 —— 这是已接受的边界。
  });
});
