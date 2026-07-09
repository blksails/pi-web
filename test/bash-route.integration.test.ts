/**
 * Integration: POST /api/sessions/:id/bash 经 createPiWebHandler 全链路转发到会话 agent
 * 执行 bash,并以同步响应体返回 BashResult(spec bang-shell-command,Req 2.1/2.2/2.4/4.3)。
 *
 * 启用态(PI_WEB_BASH_ENABLED=1)+ stub agent(真实执行 shell,离线确定性)。验证 pi-web 侧
 * 全链路:HTTP → 门控 → pi-session 转发 → 通道 bash → 结果回传。
 * 禁用态 404 由 `bash-route.test.ts`(makeBashHandler)+ `bash-env-default.test.ts`
 * (resolveBashEnabled 默认关)组合覆盖;真实 pi 的上下文写入语义由 pi agent 自身保证。
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import path from "node:path";

process.env.PI_WEB_STUB_AGENT = "1";
process.env.PI_WEB_STUB_AGENT_PATH = path.join(
  process.cwd(),
  "lib",
  "app",
  "stub-agent-process.mjs",
);
process.env.PI_WEB_BASH_ENABLED = "1";

const route = await import("@/lib/app/api-route");
const { shutdownHandler } = await import("@/lib/app/pi-handler");

function req(pathname: string, init?: RequestInit): Request {
  return new Request(`http://localhost${pathname}`, init);
}

afterAll(async () => {
  await shutdownHandler();
});

describe("POST /api/sessions/:id/bash (启用 + stub 真实执行 shell)", () => {
  let sessionId: string;

  beforeAll(async () => {
    const res = await route.POST(
      req("/api/sessions", {
        method: "POST",
        body: JSON.stringify({ source: "." }),
      }),
    );
    expect([200, 201]).toContain(res.status);
    sessionId = ((await res.json()) as { sessionId: string }).sessionId;
    expect(typeof sessionId).toBe("string");
  });

  it("执行成功 → 200 且返回结构化结果(output 含命令输出,exit 0)", async () => {
    const res = await route.POST(
      req(`/api/sessions/${sessionId}/bash`, {
        method: "POST",
        body: JSON.stringify({ command: "echo pi-bash-hi" }),
      }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      result: { output: string; exitCode?: number; cancelled: boolean };
    };
    expect(body.result.output).toContain("pi-bash-hi");
    expect(body.result.exitCode).toBe(0);
    expect(body.result.cancelled).toBe(false);
  });

  it("excludeFromContext 透传 → 200(!! 链路成功)", async () => {
    const res = await route.POST(
      req(`/api/sessions/${sessionId}/bash`, {
        method: "POST",
        body: JSON.stringify({ command: "echo noctx", excludeFromContext: true }),
      }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { result: { output: string } };
    expect(body.result.output).toContain("noctx");
  });

  it("非零退出码 → 200 且 exitCode 反映失败", async () => {
    const res = await route.POST(
      req(`/api/sessions/${sessionId}/bash`, {
        method: "POST",
        body: JSON.stringify({ command: "exit 3" }),
      }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { result: { exitCode?: number } };
    expect(body.result.exitCode).toBe(3);
  });

  it("空命令 → 400(不执行)", async () => {
    const res = await route.POST(
      req(`/api/sessions/${sessionId}/bash`, {
        method: "POST",
        body: JSON.stringify({ command: "   " }),
      }),
    );
    expect(res.status).toBe(400);
  });
});
