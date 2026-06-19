/**
 * Shared node-e2e suite for session persistence + cold resume, parameterized by
 * storage backend. Each backend test file sets SESSION_STORE* env BEFORE importing
 * the route singleton (handler reads env at build time), then calls this suite.
 *
 * Drives the real createPiWebHandler over REST + SSE with the stub agent, which
 * persists to the same SessionEntryStore backend the test reads back from.
 */
import { describe, it, expect } from "vitest";
import {
  createSessionEntryStore,
  sessionStoreConfigFromEnv,
} from "@pi-web/server";

type Route = {
  GET: (req: Request) => Promise<Response>;
  POST: (req: Request) => Promise<Response>;
  DELETE: (req: Request) => Promise<Response>;
};

const SOURCE = "./examples/hello-agent";

function reqOf(pathname: string, init?: RequestInit): Request {
  return new Request(`http://localhost${pathname}`, init);
}

async function waitFor<T>(
  fn: () => Promise<T | undefined>,
  maxMs: number,
  stepMs = 150,
): Promise<T> {
  const deadline = Date.now() + maxMs;
  let last: unknown;
  while (Date.now() < deadline) {
    try {
      const v = await fn();
      if (v !== undefined) return v;
    } catch (err) {
      last = err;
    }
    await new Promise((r) => setTimeout(r, stepMs));
  }
  throw new Error(`waitFor timed out${last ? `: ${String(last)}` : ""}`);
}

function readUntil(
  res: Response,
  predicate: (text: string) => boolean,
  maxMs: number,
): { done: Promise<void>; cancel: () => Promise<void> } {
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let acc = "";
  const deadline = Date.now() + maxMs;
  const done = (async () => {
    while (Date.now() < deadline) {
      const { done: d, value } = await reader.read();
      if (value !== undefined) acc += decoder.decode(value, { stream: true });
      if (d) break;
      if (predicate(acc)) break;
    }
  })();
  return { done, cancel: () => reader.cancel() };
}

export function runSessionPersistenceSuite(route: Route, backend: string): void {
  async function createSession(
    source: string,
    resumeId?: string,
  ): Promise<string> {
    const body: Record<string, unknown> = { source };
    if (resumeId !== undefined) body.resumeId = resumeId;
    const res = await route.POST(
      reqOf("/api/sessions", { method: "POST", body: JSON.stringify(body) }),
    );
    expect([200, 201]).toContain(res.status);
    return ((await res.json()) as { sessionId: string }).sessionId;
  }

  /** Drive one full turn (prompt → permission dialog → approve → finish). */
  async function runTurn(id: string, message: string): Promise<void> {
    const stream = await route.GET(reqOf(`/api/sessions/${id}/stream`));
    const p1 = readUntil(stream, (t) => t.includes("extension-ui"), 15000);
    const prompt = await route.POST(
      reqOf(`/api/sessions/${id}/messages`, {
        method: "POST",
        body: JSON.stringify({ message }),
      }),
    );
    expect(prompt.status).toBe(200);
    await p1.done;
    await p1.cancel();

    const stream2 = await route.GET(reqOf(`/api/sessions/${id}/stream`));
    const p2 = readUntil(stream2, (t) => t.includes('"finish"'), 15000);
    const ui = await route.POST(
      reqOf(`/api/sessions/${id}/ui-response`, {
        method: "POST",
        body: JSON.stringify({
          type: "extension_ui_response",
          id: "ext-1",
          confirmed: true,
        }),
      }),
    );
    expect(ui.status).toBeGreaterThanOrEqual(200);
    expect(ui.status).toBeLessThan(300);
    await p2.done;
    await p2.cancel();
  }

  async function getMessages(id: string): Promise<Array<{ role: string }>> {
    const r = await route.GET(reqOf(`/api/sessions/${id}/messages`));
    if (r.status !== 200) return [];
    const b = (await r.json()) as { messages?: Array<{ role: string }> };
    return b.messages ?? [];
  }

  describe(`session persistence + cold resume (${backend})`, () => {
    it("新建会话:返回 sessionId 等于持久化 header.id,且 piweb.session 元数据可读回", async () => {
      const id = await createSession(SOURCE);
      const store = await createSessionEntryStore(sessionStoreConfigFromEnv());
      const meta = await waitFor(async () => {
        const header = await store.readHeader(id);
        if (header.id !== id) return undefined;
        let m: { source?: string } | undefined;
        for await (const e of store.read(id)) {
          if (e.type === "custom" && e.customType === "piweb.session") {
            m = e.data as { source?: string };
          }
        }
        return m;
      }, 15000);
      expect(meta.source).toBe(SOURCE);
    }, 25000);

    it("冷恢复:删内存会话后经 resumeId 恢复,getMessages 返回历史(user+assistant)", async () => {
      const id = await createSession(SOURCE);
      await runTurn(id, "hello");

      // 等 stub 持久化完成(活跃会话 get_messages 返回 2 条)。
      await waitFor(async () => {
        const msgs = await getMessages(id);
        return msgs.length >= 2 ? msgs : undefined;
      }, 12000);

      // 删除内存会话以模拟冷恢复路径。
      const del = await route.DELETE(
        reqOf(`/api/sessions/${id}`, { method: "DELETE" }),
      );
      expect(del.status).toBeGreaterThanOrEqual(200);
      expect(del.status).toBeLessThan(300);

      // 经 resumeId 恢复:返回同一 id。
      const resumeRes = await route.POST(
        reqOf("/api/sessions", {
          method: "POST",
          body: JSON.stringify({ source: SOURCE, resumeId: id }),
        }),
      );
      expect([200, 201]).toContain(resumeRes.status);
      expect(((await resumeRes.json()) as { sessionId: string }).sessionId).toBe(
        id,
      );

      // 恢复后历史可读(agent 端从持久化重建)。
      const roles = await waitFor(async () => {
        const msgs = await getMessages(id);
        return msgs.length >= 2 ? msgs.map((m) => m.role) : undefined;
      }, 15000);
      expect(roles).toContain("user");
      expect(roles).toContain("assistant");
    }, 60000);
  });
}
