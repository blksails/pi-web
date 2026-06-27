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
