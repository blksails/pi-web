/**
 * Node e2e(completion-provider-framework):经真实 createPiWebHandler 验证通用补全端点。
 *   GET /sessions/:id/completion/triggers   → 含 `@`
 *   GET /sessions/:id/completion?trigger=@&q= → 返回会话 cwd 文件、按查询收敛、尊重 .gitignore
 *   边界:不泄露 cwd 之外文件(路径穿越/越界);未知会话 → 404。
 *
 * 会话 cwd = agent 源目录。用临时夹具目录作为 dir 源(stub agent 仅替换通道,cwd 仍按源解析)。
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { promises as fs } from "node:fs";
import * as os from "node:os";
import path from "node:path";

process.env.PI_WEB_STUB_AGENT = "1";
process.env.PI_WEB_STUB_AGENT_PATH = path.join(
  process.cwd(),
  "lib",
  "app",
  "stub-agent-process.mjs",
);

const route = await import("@/app/api/sessions/[[...path]]/route");
const { shutdownHandler } = await import("@/lib/app/pi-handler");

let fixture: string;
let outside: string;

beforeAll(async () => {
  fixture = await fs.mkdtemp(path.join(os.tmpdir(), "cpf-e2e-cwd-"));
  outside = await fs.mkdtemp(path.join(os.tmpdir(), "cpf-e2e-out-"));
  await fs.writeFile(path.join(outside, "secret.txt"), "SECRET");
  await fs.mkdir(path.join(fixture, "src"));
  await fs.writeFile(path.join(fixture, "src", "app.ts"), "x");
  await fs.writeFile(path.join(fixture, "README.md"), "x");
  await fs.writeFile(path.join(fixture, ".gitignore"), "secret.log\n");
  await fs.writeFile(path.join(fixture, "secret.log"), "x");
});

afterAll(async () => {
  await shutdownHandler();
  await fs.rm(fixture, { recursive: true, force: true });
  await fs.rm(outside, { recursive: true, force: true });
});

function reqOf(pathname: string, init?: RequestInit): Request {
  return new Request(`http://localhost${pathname}`, init);
}

async function createSession(source: string): Promise<string> {
  const res = await route.POST(
    reqOf("/api/sessions", {
      method: "POST",
      body: JSON.stringify({ source }),
    }),
  );
  expect([200, 201]).toContain(res.status);
  const body = (await res.json()) as { sessionId: string };
  return body.sessionId;
}

describe("completion endpoint (offline e2e)", () => {
  it("triggers 含 @;completion 返回 cwd 文件、按查询收敛、尊重 .gitignore、不泄露越界文件", async () => {
    const id = await createSession(fixture);

    const tRes = await route.GET(
      reqOf(`/api/sessions/${id}/completion/triggers`),
    );
    expect(tRes.status).toBe(200);
    const tBody = (await tRes.json()) as {
      triggers: Array<{ trigger: string }>;
    };
    expect(tBody.triggers.map((t) => t.trigger)).toContain("@");

    // 空查询:列 cwd 文件
    const allRes = await route.GET(
      reqOf(`/api/sessions/${id}/completion?trigger=@&q=`),
    );
    expect(allRes.status).toBe(200);
    const all = (await allRes.json()) as {
      items: Array<{ id: string; kind: string }>;
    };
    const ids = all.items.map((i) => i.id);
    expect(ids).toContain("src/app.ts");
    expect(ids).toContain("README.md");
    expect(ids).not.toContain("secret.log"); // .gitignore
    // 边界:绝不出现 cwd 之外的文件或 ../ 逃逸
    expect(ids.some((p) => p.includes(".."))).toBe(false);
    expect(ids).not.toContain("secret.txt");
    expect(all.items.every((i) => i.kind === "file")).toBe(true);

    // 带查询收敛
    const qRes = await route.GET(
      reqOf(`/api/sessions/${id}/completion?trigger=@&q=app`),
    );
    const q = (await qRes.json()) as { items: Array<{ id: string }> };
    expect(q.items[0]?.id).toBe("src/app.ts");
  });

  it("未知触发符返回空集;未知会话返回 404", async () => {
    const id = await createSession(fixture);
    const empty = await route.GET(
      reqOf(`/api/sessions/${id}/completion?trigger=%25&q=x`),
    );
    expect(empty.status).toBe(200);
    expect((await empty.json()).items).toEqual([]);

    const notFound = await route.GET(
      reqOf(`/api/sessions/does-not-exist/completion/triggers`),
    );
    expect(notFound.status).toBe(404);
  });
});
