/**
 * makeBashHandler — bang shell 命令端点的门控与转发(spec bang-shell-command)。
 *
 * 覆盖 requirements 5.2/5.4(禁用权威 404、且在解析 body 前不触达会话)、2.1(成功返回
 * 结构化结果)、2.4(excludeFromContext 透传)、以及无效命令 400。
 */
import { describe, it, expect, vi } from "vitest";
import { makeBashHandler } from "@blksails/pi-web-server";
import type { SessionStore } from "@blksails/pi-web-server";

function makeCtx(body: unknown, sessionId = "s1") {
  const req = new Request(`http://localhost/sessions/${sessionId}/bash`, {
    method: "POST",
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
  return { req, sessionId, auth: { anonymous: true }, url: new URL(req.url) };
}

function makeStore() {
  const bash = vi.fn().mockResolvedValue({
    success: true,
    command: "bash",
    data: { output: "hi\n", exitCode: 0, cancelled: false, truncated: false },
  });
  const get = vi.fn(() => ({ bash }));
  const store = { get } as unknown as SessionStore;
  return { store, get, bash };
}

describe("makeBashHandler — 启用门控(权威)", () => {
  it("禁用 → 404,且在解析 body 前不触达会话", async () => {
    const { store, get } = makeStore();
    const handler = makeBashHandler(store, { enabled: false });
    const res = await handler(makeCtx({ command: "ls" }));
    expect(res.status).toBe(404);
    expect(get).not.toHaveBeenCalled();
  });
});

describe("makeBashHandler — 启用后的执行", () => {
  it("成功 → 200 并返回结构化结果", async () => {
    const { store, bash } = makeStore();
    const handler = makeBashHandler(store, { enabled: true });
    const res = await handler(makeCtx({ command: "echo hi" }));
    expect(res.status).toBe(200);
    const json = (await res.json()) as { result: { output: string } };
    expect(json.result.output).toBe("hi\n");
    expect(bash).toHaveBeenCalledWith("echo hi", {});
  });

  it("excludeFromContext 透传给会话 bash", async () => {
    const { store, bash } = makeStore();
    const handler = makeBashHandler(store, { enabled: true });
    await handler(makeCtx({ command: "ls", excludeFromContext: true }));
    expect(bash).toHaveBeenCalledWith("ls", { excludeFromContext: true });
  });

  it("空命令 → 400,且不触达会话", async () => {
    const { store, get } = makeStore();
    const handler = makeBashHandler(store, { enabled: true });
    const res = await handler(makeCtx({ command: "   " }));
    expect(res.status).toBe(400);
    expect(get).not.toHaveBeenCalled();
  });

  it("缺少 command 字段 → 400", async () => {
    const { store } = makeStore();
    const handler = makeBashHandler(store, { enabled: true });
    const res = await handler(makeCtx({ excludeFromContext: true }));
    expect(res.status).toBe(400);
  });
});
