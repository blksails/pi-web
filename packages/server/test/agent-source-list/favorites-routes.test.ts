/**
 * 集成:GET/PUT /agent-sources/favorites 经 createPiWebHandler routes? 注入(Req 4.1/4.2/4.6)。
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ListFavoritesResponseSchema } from "@blksails/pi-web-protocol";
import { createPiWebHandler } from "../../src/http/index.js";
import { InMemorySessionStore } from "../../src/session/session-store.js";
import { SessionManager } from "../../src/session/session-manager.js";
import { createFavoritesRoutes } from "../../src/agent-source-list/index.js";

let agentDir: string;

beforeEach(async () => {
  agentDir = join(
    tmpdir(),
    `fav-routes-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  await fs.mkdir(agentDir, { recursive: true });
});
afterEach(async () => {
  await fs.rm(agentDir, { recursive: true, force: true });
});

function makeHandler(): (req: Request) => Promise<Response> {
  const store = new InMemorySessionStore(true);
  const manager = new SessionManager({ store, idleMs: 0 });
  return createPiWebHandler({
    manager,
    store,
    routes: createFavoritesRoutes({ agentDir }),
    authResolver: () => ({ anonymous: true }),
  });
}

async function readJson(res: Response): Promise<Record<string, unknown>> {
  const t = await res.text();
  return t.length > 0 ? (JSON.parse(t) as Record<string, unknown>) : {};
}

const url = "http://x/agent-sources/favorites";

describe("GET/PUT /agent-sources/favorites", () => {
  it("GET 初始 → 空列表", async () => {
    const res = await makeHandler()(new Request(url));
    expect(res.status).toBe(200);
    const parsed = ListFavoritesResponseSchema.parse(await readJson(res));
    expect(parsed.favorites).toEqual([]);
  });

  it("PUT 合法 body → 回显且落盘,GET 反映", async () => {
    const handler = makeHandler();
    const putRes = await handler(
      new Request(url, {
        method: "PUT",
        body: JSON.stringify({
          favorites: [{ source: "/x", name: "X" }],
        }),
      }),
    );
    expect(putRes.status).toBe(200);
    const put = ListFavoritesResponseSchema.parse(await readJson(putRes));
    expect(put.favorites).toEqual([{ source: "/x", name: "X" }]);

    // 落盘文件存在。
    const onDisk = JSON.parse(
      await fs.readFile(join(agentDir, "agent-source-favorites.json"), "utf8"),
    );
    expect(onDisk.favorites).toEqual([{ source: "/x", name: "X" }]);

    // GET 反映。
    const getRes = await handler(new Request(url));
    const got = ListFavoritesResponseSchema.parse(await readJson(getRes));
    expect(got.favorites).toEqual([{ source: "/x", name: "X" }]);
  });

  it("PUT 坏 body → 400", async () => {
    const handler = makeHandler();
    const res = await handler(
      new Request(url, { method: "PUT", body: JSON.stringify({ favorites: [{ name: "no-source" }] }) }),
    );
    expect(res.status).toBe(400);
  });

  it("PUT 非 JSON body → 400", async () => {
    const res = await makeHandler()(
      new Request(url, { method: "PUT", body: "not json" }),
    );
    expect(res.status).toBe(400);
  });
});
