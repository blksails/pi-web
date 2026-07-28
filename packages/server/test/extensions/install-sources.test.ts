/**
 * GET /sessions/:id/install-sources 单测(plugin-subcommand-completion R3)。
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { makeInstallSourcesHandler } from "../../src/extensions/routes/install-sources.js";
import type { PiSession, SessionStore } from "../../src/session/index.js";
import type { RequestContext } from "../../src/http/index.js";

let cwd: string;

beforeEach(async () => {
  cwd = await fs.mkdtemp(join(tmpdir(), "install-src-"));
  // 两个可装目录(各带标志文件)+ 一个普通目录(无标志,不应入选)。
  await fs.mkdir(join(cwd, "agent-a"), { recursive: true });
  await fs.writeFile(join(cwd, "agent-a", "index.ts"), "export {}");
  await fs.mkdir(join(cwd, "pkg-b"), { recursive: true });
  await fs.writeFile(join(cwd, "pkg-b", "package.json"), "{}");
  await fs.mkdir(join(cwd, "plain"), { recursive: true });
  await fs.writeFile(join(cwd, "plain", "notes.txt"), "hi");
  // 噪声目录应被跳过。
  await fs.mkdir(join(cwd, "node_modules", "x"), { recursive: true });
  await fs.writeFile(join(cwd, "node_modules", "x", "index.js"), "");
});

afterEach(async () => {
  await fs.rm(cwd, { recursive: true, force: true });
});

function storeWith(session: PiSession | undefined): SessionStore {
  return { get: () => session } as unknown as SessionStore;
}

function ctxFor(sessionId: string, q?: string): RequestContext {
  const url = new URL(
    `http://x/sessions/${sessionId}/install-sources${q !== undefined ? `?q=${encodeURIComponent(q)}` : ""}`,
  );
  return {
    req: new Request(url),
    sessionId,
    auth: { anonymous: true },
    url,
  };
}

async function body(res: Response): Promise<Record<string, unknown>> {
  return JSON.parse(await res.text()) as Record<string, unknown>;
}

describe("makeInstallSourcesHandler", () => {
  it("列出 cwd 下带标志文件的可装目录(跳过普通/噪声目录)", async () => {
    const session = { cwd } as unknown as PiSession;
    const res = await makeInstallSourcesHandler(storeWith(session))(
      ctxFor("s1"),
    );
    expect(res.status).toBe(200);
    const data = await body(res);
    const sources = data.sources as { path: string; insertText: string }[];
    const paths = sources.map((s) => s.path).sort();
    expect(paths).toContain("./agent-a");
    expect(paths).toContain("./pkg-b");
    expect(paths).not.toContain("./plain");
    expect(paths.some((p) => p.includes("node_modules"))).toBe(false);
    // insertText 形如 local:<rel>
    expect(sources.find((s) => s.path === "./agent-a")?.insertText).toBe(
      "local:./agent-a",
    );
  });

  it("q 过滤候选", async () => {
    const session = { cwd } as unknown as PiSession;
    const res = await makeInstallSourcesHandler(storeWith(session))(
      ctxFor("s1", "pkg"),
    );
    const data = await body(res);
    const sources = data.sources as { path: string }[];
    expect(sources.map((s) => s.path)).toEqual(["./pkg-b"]);
  });

  it("无会话 → 404", async () => {
    const res = await makeInstallSourcesHandler(storeWith(undefined))(
      ctxFor("nope"),
    );
    expect(res.status).toBe(404);
  });

  // ── 端口化(spec agent-plugin-commands,任务 1.3) ──

  it("经注入的端口取数,端点自身不触碰文件系统", async () => {
    const session = { cwd } as unknown as PiSession;
    const calls: { cwd: string; query: string }[] = [];
    const stub = {
      list: async (q: { cwd: string; query: string }) => {
        calls.push(q);
        return [{ path: "./from-port", insertText: "local:./from-port" }];
      },
    };
    const res = await makeInstallSourcesHandler(storeWith(session), stub)(
      ctxFor("s1", "abc"),
    );
    expect(res.status).toBe(200);
    const sources = (await body(res)).sources as { path: string }[];
    // 真实 cwd 下有 agent-a / pkg-b,若端点仍自己扫盘就不会只见桩数据。
    expect(sources.map((s) => s.path)).toEqual(["./from-port"]);
    expect(calls).toEqual([{ cwd, query: "abc" }]);
  });

  it("端口抛错 → 降级为 200 空候选,不返回 5xx", async () => {
    const session = { cwd } as unknown as PiSession;
    const failing = {
      list: async () => {
        throw new Error("port exploded");
      },
    };
    const res = await makeInstallSourcesHandler(storeWith(session), failing)(
      ctxFor("s1"),
    );
    expect(res.status).toBe(200);
    expect((await body(res)).sources).toEqual([]);
  });

  it("空目录 → 200 空列表", async () => {
    const empty = await fs.mkdtemp(join(tmpdir(), "install-src-empty-"));
    const session = { cwd: empty } as unknown as PiSession;
    const res = await makeInstallSourcesHandler(storeWith(session))(
      ctxFor("s1"),
    );
    expect(res.status).toBe(200);
    expect((await body(res)).sources).toEqual([]);
    await fs.rm(empty, { recursive: true, force: true });
  });
});
