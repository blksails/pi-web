/**
 * 回归:GET /sessions 的惰性 store 单例在**构造失败时不缓存 rejected promise**。
 *
 * 曾有可用性缺陷:首次 createSessionEntryStore 瞬时失败(如 sqlite 文件锁 / pg 连接抖动)后,
 * `storePromise ??= …` 会缓存那个 rejected promise,`??=` 认为已赋值 → 后续每个请求都复用它 →
 * 端点永久 500 直到进程重启。修复后失败即清空缓存,后续请求可重试并恢复。
 */
import { describe, it, expect, vi } from "vitest";
import { createSessionListRoutes } from "../../src/session-list/index.js";
import { createPiWebHandler } from "../../src/http/index.js";
import { InMemorySessionStore } from "../../src/session/session-store.js";
import { SessionManager } from "../../src/session/session-manager.js";

// ★ 原先靠 `vi.mock` 替换模块图里的 createSessionEntryStore 才能让构造失败;
//   store 构造改为经 `createEntryStore` 注入后(spec: core-package-extraction 任务 4.1),
//   直接注入一个受控工厂即可 —— 少一层模块 mock,判据完全不变。
const createStore = vi.fn();

const url = (qs: string): Request => new Request(`http://x/sessions${qs}`);

function makeHandler(): (req: Request) => Promise<Response> {
  const store = new InMemorySessionStore(true);
  const manager = new SessionManager({ store, idleMs: 0 });
  const routes = createSessionListRoutes({
    createEntryStore: () => createStore(),
  });
  return createPiWebHandler({ manager, store, routes, authResolver: () => ({ anonymous: true }) });
}

describe("GET /sessions — store construction failure is not cached", () => {
  it("recovers on a later request after a transient construction failure", async () => {
    createStore
      .mockRejectedValueOnce(new Error("transient store construction failure"))
      .mockResolvedValue({ list: async () => [], listAll: async () => [] });

    const handler = makeHandler();

    // 首次请求:构造失败 → 500。
    expect((await handler(url("?scope=cwd"))).status).toBe(500);

    // 后续请求:缓存已清,重试构造成功 → 200(而非永久 500)。
    const res = await handler(url("?scope=cwd"));
    expect(res.status).toBe(200);

    // 确认确实重试了构造(而非复用缓存):调用两次。
    expect(createStore).toHaveBeenCalledTimes(2);
  });
});

describe("GET /sessions — displayName enrichment is concurrency-bounded", () => {
  it("caps in-flight displayName derivations (no unbounded fan-out on a full page)", async () => {
    const N = 20;
    const metas = Array.from({ length: N }, (_, i) => ({
      sessionId: `s${i}`,
      cwd: "/proj",
      createdAt: `2026-06-01T00:00:${String(i).padStart(2, "0")}.000Z`,
    }));

    let inFlight = 0;
    let peak = 0;
    const store = {
      list: async () => metas,
      listAll: async () => metas,
      displayName: async (sessionId: string) => {
        inFlight += 1;
        peak = Math.max(peak, inFlight);
        await new Promise((r) => setTimeout(r, 5)); // 留出窗口让多项同时在飞
        inFlight -= 1;
        return `name-${sessionId}`;
      },
    };
    createStore.mockResolvedValue(store);

    const handler = makeHandler();
    const res = await handler(url("?scope=cwd&limit=200"));
    expect(res.status).toBe(200);

    const parsed = JSON.parse(await res.text()) as { sessions: { name?: string }[] };
    expect(parsed.sessions).toHaveLength(N); // 全部派生成功
    expect(parsed.sessions.every((s) => s.name?.startsWith("name-"))).toBe(true);
    expect(peak).toBeGreaterThan(1); // 确实有并发(非串行)
    expect(peak).toBeLessThanOrEqual(8); // 但不超过闸值
  });
});
