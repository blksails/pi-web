/**
 * 集成:GET /agent-sources 经 createPiWebHandler routes? 注入。
 *
 * 覆盖 Req 1.1(结构)、1.2/6.4(空来源→200 空表)、1.3(limit/cursor 非法→400)、
 * 1.4(超页→nextCursor 且续取不重复)、6.2(仅限扫描根内)、6.1(只读:请求前后
 * fixture 目录字节+mtime 不变、无 clone)。
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ListAgentSourcesResponseSchema } from "@blksails/pi-web-protocol";
import { createPiWebHandler } from "../../src/http/index.js";
import { InMemorySessionStore } from "../../src/session/session-store.js";
import { SessionManager } from "../../src/session/session-manager.js";
import { createAgentSourcesRoutes } from "../../src/agent-source-list/index.js";

let root: string;
let registryPath: string;

beforeEach(async () => {
  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  root = join(tmpdir(), `agsrc-root-${stamp}`);
  await fs.mkdir(root, { recursive: true });
  registryPath = join(root, "..", `agsrc-reg-${stamp}.json`);
});

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
  await fs.rm(registryPath, { force: true });
});

async function mkAgent(name: string): Promise<void> {
  const dir = join(root, name);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(join(dir, "index.ts"), "export default {}\n");
}

function makeHandler(opts: {
  scanRoots?: readonly string[];
  registryPath?: string;
  defaultPageSize?: number;
}): (req: Request) => Promise<Response> {
  const store = new InMemorySessionStore(true);
  const manager = new SessionManager({ store, idleMs: 0 });
  const routes = createAgentSourcesRoutes({
    scanRoots: opts.scanRoots ?? [],
    registryPath: opts.registryPath ?? join(root, "no-registry.json"),
    ...(opts.defaultPageSize !== undefined
      ? { defaultPageSize: opts.defaultPageSize }
      : {}),
  });
  return createPiWebHandler({
    manager,
    store,
    routes,
    authResolver: () => ({ anonymous: true }),
  });
}

async function readJson(res: Response): Promise<Record<string, unknown>> {
  const text = await res.text();
  return text.length > 0 ? (JSON.parse(text) as Record<string, unknown>) : {};
}

const url = (qs: string): Request => new Request(`http://x/agent-sources${qs}`);

describe("GET /agent-sources", () => {
  it("返回扫描到的源,schema 合法(Req 1.1)", async () => {
    await mkAgent("alpha");
    await mkAgent("beta");
    const handler = makeHandler({ scanRoots: [root] });
    const res = await handler(url(""));
    expect(res.status).toBe(200);
    const parsed = ListAgentSourcesResponseSchema.parse(await readJson(res));
    expect(parsed.sources.map((s) => s.name).sort()).toEqual(["alpha", "beta"]);
    for (const s of parsed.sources) {
      expect(s.kind).toBe("dir");
      expect(s.origin).toBe("scan");
      expect(s.mode).toBe("custom");
    }
  });

  it("未配任何来源 → 200 空列表(Req 1.2/6.4)", async () => {
    const handler = makeHandler({ scanRoots: [] });
    const res = await handler(url(""));
    expect(res.status).toBe(200);
    const parsed = ListAgentSourcesResponseSchema.parse(await readJson(res));
    expect(parsed.sources).toEqual([]);
    expect(parsed.nextCursor).toBeUndefined();
  });

  it("limit=0 → 400(Req 1.3)", async () => {
    const handler = makeHandler({ scanRoots: [root] });
    const res = await handler(url("?limit=0"));
    expect(res.status).toBe(400);
  });

  it("坏 cursor → 400(Req 1.3)", async () => {
    const handler = makeHandler({ scanRoots: [root] });
    const res = await handler(url("?cursor=%%%not-base64%%%"));
    expect(res.status).toBe(400);
  });

  it("超单页 → 返回 nextCursor,续取不重复且覆盖全集(Req 1.4)", async () => {
    for (const n of ["a", "b", "c", "d", "e"]) await mkAgent(n);
    const handler = makeHandler({ scanRoots: [root], defaultPageSize: 2 });

    const seen: string[] = [];
    let cursor: string | undefined;
    for (let i = 0; i < 10; i += 1) {
      const qs = cursor !== undefined ? `?cursor=${encodeURIComponent(cursor)}` : "";
      const parsed = ListAgentSourcesResponseSchema.parse(
        await readJson(await handler(url(qs))),
      );
      seen.push(...parsed.sources.map((s) => s.id));
      cursor = parsed.nextCursor;
      if (cursor === undefined) break;
    }
    // 无重复、覆盖全部 5 个。
    expect(new Set(seen).size).toBe(5);
    expect(seen).toHaveLength(5);
  });

  it("keyset 游标:游标记录在两次请求间消失,续取不重发已返回项(Req 1.4)", async () => {
    // provider 直接注入,便于在"翻页之间"改变列表内容。
    let records = ["a", "b", "c", "d"].map((n) => ({
      id: `/${n}`,
      source: `/${n}`,
      name: n,
      kind: "dir" as const,
      origin: "scan" as const,
      mode: "custom" as const,
    }));
    const store = new InMemorySessionStore(true);
    const manager = new SessionManager({ store, idleMs: 0 });
    const routes = createAgentSourcesRoutes({
      scanRoots: [],
      registryPath: "unused",
      defaultPageSize: 2,
      provider: { list: () => Promise.resolve([...records]) },
    });
    const handler = createPiWebHandler({
      manager,
      store,
      routes,
      authResolver: () => ({ anonymous: true }),
    });

    // 第一页:a,b → nextCursor 指向 b。
    const p1 = ListAgentSourcesResponseSchema.parse(await readJson(await handler(url(""))));
    expect(p1.sources.map((s) => s.id)).toEqual(["/a", "/b"]);
    expect(p1.nextCursor).toBeDefined();

    // 两页之间删除游标记录 b(以及已返回的 a)。
    records = records.filter((r) => r.id !== "/b" && r.id !== "/a");

    // 第二页:仍从 b 之后续取 → c,d,绝不回退重发 a/b。
    const p2 = ListAgentSourcesResponseSchema.parse(
      await readJson(await handler(url(`?cursor=${encodeURIComponent(p1.nextCursor!)}`))),
    );
    expect(p2.sources.map((s) => s.id)).toEqual(["/c", "/d"]);
    expect(p2.sources.some((s) => s.id === "/a" || s.id === "/b")).toBe(false);
  });

  it("registry ∪ scan 合并去重,registry 覆盖元数据", async () => {
    await mkAgent("shared");
    const sharedReal = await fs.realpath(join(root, "shared"));
    await fs.writeFile(
      registryPath,
      JSON.stringify({
        sources: [
          { source: sharedReal, name: "Registry Override" },
          { source: "git:github.com/org/remote@main", name: "Remote" },
        ],
      }),
    );
    const handler = makeHandler({ scanRoots: [root], registryPath });
    const parsed = ListAgentSourcesResponseSchema.parse(
      await readJson(await handler(url(""))),
    );
    // shared 去重为一;名称取 registry。
    const shared = parsed.sources.filter((s) => s.id === sharedReal);
    expect(shared).toHaveLength(1);
    expect(shared[0]!.name).toBe("Registry Override");
    // git 源也在列表中(kind=git)。
    expect(parsed.sources.some((s) => s.kind === "git")).toBe(true);
  });

  it("只读:请求前后 fixture 目录字节与 mtime 不变(Req 6.1)", async () => {
    await mkAgent("ro");
    const entryPath = join(root, "ro", "index.ts");
    const before = await fs.stat(entryPath);
    const beforeBytes = await fs.readFile(entryPath, "utf8");
    const dirBefore = (await fs.readdir(join(root, "ro"))).sort();

    const handler = makeHandler({ scanRoots: [root] });
    await handler(url(""));

    const after = await fs.stat(entryPath);
    expect(await fs.readFile(entryPath, "utf8")).toBe(beforeBytes);
    expect(after.mtimeMs).toBe(before.mtimeMs);
    // 未新增/删除任何文件(无 clone/无写)。
    expect((await fs.readdir(join(root, "ro"))).sort()).toEqual(dirBefore);
  });
});
