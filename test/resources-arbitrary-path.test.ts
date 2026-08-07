/**
 * Integration: `/api/resources?agent=<绝对路径>` 对任意存在的本地 agent 目录可解析。
 *
 * 背景(见 pi-handler.ts `resolveResourceAgent`):会话创建侧(resolver.ts)接受任意
 * 绝对路径目录作为 agent 源,而 resources 面板此前只在扫描根(默认 `~/.pi-web/agents`)
 * 内解析 —— 桌面版 source-picker 接受到的路径在技能/模板面板必 422
 * ("The selected Agent is not loaded locally.")。本测试锁定回退行为:
 * 存在的绝对路径目录 → 200;不存在的路径 → 仍 422。
 *
 * 用 stub agent 跑 real handler(离线 + 确定性),复用 route.integration.test.ts 的设施。
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// Stub mode BEFORE importing the route (config + handler read env at first use).
process.env.PI_WEB_STUB_AGENT = "1";
process.env.PI_WEB_STUB_AGENT_PATH = path.join(
  process.cwd(),
  "lib",
  "app",
  "stub-agent-process.mjs",
);
// 扫描根指向一个不存在的临时目录,模拟打包桌面无 agent 源(避免测到本机真实 ~/.pi-web/agents)。
process.env.PI_WEB_SOURCES_ROOT = path.join(os.tmpdir(), `piweb-rsrc-root-${Date.now()}`);

const route = await import("@/lib/app/api-route");
const { shutdownHandler } = await import("@/lib/app/pi-handler");

function req(pathname: string, init?: RequestInit): Request {
  return new Request(`http://localhost${pathname}`, init);
}

afterAll(async () => {
  delete process.env.PI_WEB_SOURCES_ROOT;
  await shutdownHandler();
});

describe("/api/resources?agent=<绝对路径> (resources 面板任意路径 agent 解析)", () => {
  let agentDir: string;

  beforeAll(async () => {
    agentDir = fs.mkdtempSync(path.join(os.tmpdir(), "piweb-rsrc-agent-"));
    fs.writeFileSync(path.join(agentDir, "package.json"), JSON.stringify({ name: "rsrc-agent" }));
    fs.writeFileSync(path.join(agentDir, "index.ts"), "export default async () => ({})\n");
  });

  afterAll(async () => {
    fs.rmSync(agentDir, { recursive: true, force: true });
  });

  it("存在的绝对路径目录(不在扫描根)→ 200(此前 422)", async () => {
    const res = await route.GET(
      req(`/api/resources?agent=${encodeURIComponent(agentDir)}`, { method: "GET" }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      skills?: unknown[];
      templates?: unknown[];
      permissions?: { agent?: { visible?: boolean; editable?: boolean } };
    };
    expect(Array.isArray(body.skills)).toBe(true);
    expect(body.permissions?.agent?.visible).toBe(true);
    // 无 resourceAccess 清单 → 只读(agent 编辑权缺省不授予)。
    expect(body.permissions?.agent?.editable).toBe(false);
  });

  it("不存在的绝对路径 → 仍 422(不误放行任意输入)", async () => {
    const res = await route.GET(
      req(`/api/resources?agent=${encodeURIComponent(path.join(os.tmpdir(), "no-such-agent"))}`, { method: "GET" }),
    );
    expect(res.status).toBe(422);
    const body = (await res.json()) as { error?: { code?: string } };
    expect(body.error?.code).toBe("INVALID_AGENT");
  });
});
