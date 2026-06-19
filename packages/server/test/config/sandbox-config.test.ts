/**
 * 集成:沙箱配置域(方案 A 全局 /config/sandbox)+ 项目路由(方案 B /config/sandbox/project)。
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createPiWebHandler } from "../../src/http/index.js";
import { InMemorySessionStore } from "../../src/session/session-store.js";
import { SessionManager } from "../../src/session/session-manager.js";
import { createConfigRoutes } from "../../src/config/config-routes.js";
import { createSandboxProjectRoutes } from "../../src/config/sandbox-project-routes.js";

let tmpDir: string;

beforeEach(async () => {
  tmpDir = join(tmpdir(), `sbx-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  await fs.mkdir(tmpDir, { recursive: true });
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

async function readJson(res: Response): Promise<Record<string, unknown>> {
  const text = await res.text();
  return text.length > 0 ? (JSON.parse(text) as Record<string, unknown>) : {};
}

function makeHandler(routes: Parameters<typeof createPiWebHandler>[0]["routes"]) {
  const store = new InMemorySessionStore(true);
  const manager = new SessionManager({ store, idleMs: 0 });
  return createPiWebHandler({ manager, store, routes, authResolver: () => ({ anonymous: true }) });
}

describe("方案 A — 全局沙箱配置域 /config/sandbox", () => {
  it("GET 返回 domain=sandbox 的 formSchema + 磁盘值", async () => {
    await fs.writeFile(
      join(tmpDir, "sandbox.json"),
      JSON.stringify({ enabled: true, filesystem: { allowWrite: ["."] } }),
    );
    const handler = makeHandler(createConfigRoutes({ rootDir: tmpDir }));
    const res = await handler(new Request("http://x/config/sandbox"));
    expect(res.status).toBe(200);
    const body = await readJson(res);
    expect((body["formSchema"] as Record<string, unknown>)["domain"]).toBe("sandbox");
    const values = body["values"] as Record<string, unknown>;
    expect((values["filesystem"] as Record<string, unknown>)["allowWrite"]).toEqual(["."]);
  });

  it("PUT 写入 <rootDir>/sandbox.json(经 schema 校验)", async () => {
    const handler = makeHandler(createConfigRoutes({ rootDir: tmpDir }));
    const res = await handler(
      new Request("http://x/config/sandbox", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          values: { enabled: true, network: { allowedDomains: [] }, filesystem: { allowRead: ["."], allowWrite: ["."] } },
        }),
      }),
    );
    expect(res.status).toBe(200);
    const onDisk = JSON.parse(await fs.readFile(join(tmpDir, "sandbox.json"), "utf8"));
    expect(onDisk.filesystem.allowRead).toEqual(["."]);
  });

  it("PUT 非法值(enabled 非布尔)→ 422", async () => {
    const handler = makeHandler(createConfigRoutes({ rootDir: tmpDir }));
    const res = await handler(
      new Request("http://x/config/sandbox", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ values: { enabled: "yes" } }),
      }),
    );
    expect(res.status).toBe(422);
  });
});

describe("方案 B — 项目沙箱路由 /config/sandbox/project", () => {
  it("PUT 写 <cwd>/.pi/sandbox.json,GET 读回", async () => {
    const handler = makeHandler(createSandboxProjectRoutes({ defaultCwd: tmpDir }));
    const put = await handler(
      new Request("http://x/config/sandbox/project", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ values: { filesystem: { allowWrite: [".", "/tmp"] } } }),
      }),
    );
    expect(put.status).toBe(200);
    const written = JSON.parse(await fs.readFile(join(tmpDir, ".pi", "sandbox.json"), "utf8"));
    expect(written.filesystem.allowWrite).toEqual([".", "/tmp"]);

    const get = await handler(new Request("http://x/config/sandbox/project"));
    expect(get.status).toBe(200);
    const body = await readJson(get);
    expect(body["exists"]).toBe(true);
    expect(((body["values"] as Record<string, unknown>)["filesystem"] as Record<string, unknown>)["allowWrite"]).toEqual([".", "/tmp"]);
  });

  it("GET 未配置项目 → exists:false, values:{}", async () => {
    const handler = makeHandler(createSandboxProjectRoutes({ defaultCwd: tmpDir }));
    const res = await handler(new Request("http://x/config/sandbox/project"));
    expect(res.status).toBe(200);
    const body = await readJson(res);
    expect(body["exists"]).toBe(false);
    expect(body["values"]).toEqual({});
  });

  it("cwd 越出 allowedRoots → 403", async () => {
    const handler = makeHandler(createSandboxProjectRoutes({ defaultCwd: tmpDir }));
    const res = await handler(
      new Request("http://x/config/sandbox/project?cwd=%2Fetc", { method: "GET" }),
    );
    expect(res.status).toBe(403);
  });

  it("PUT 非法值 → 422,不落盘", async () => {
    const handler = makeHandler(createSandboxProjectRoutes({ defaultCwd: tmpDir }));
    const res = await handler(
      new Request("http://x/config/sandbox/project", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ values: { network: { allowedDomains: "github.com" } } }),
      }),
    );
    expect(res.status).toBe(422);
    await expect(fs.readFile(join(tmpDir, ".pi", "sandbox.json"), "utf8")).rejects.toThrow();
  });
});
