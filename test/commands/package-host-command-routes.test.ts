/**
 * 集成测试:/agent 与 /plugin host 命令经 ui-rpc 通道的同步执行
 * (spec agent-plugin-commands,任务 2.4;迁自 install-host-command-routes)。
 *
 * 与 handler 单测(package-host-command.test.ts,fake 端口逐路径断言)不同,本文件把**真实的**
 * `createPackageHostCommand` 注册进**真实的** host 注册表与 `createPiWebHandler`,走完整 HTTP
 * 通路:POST /sessions/:id/ui-rpc(point=command/action=execute)→ 服务端同步执行 → 结果在
 * HTTP 响应体返回(决策A,Req 1.1/1.7)。安装端口仍为 fake(绝不真装),会话为最小替身——
 * 验证的是「接线层」:载荷解析、注册表命中、同步回流、会话消息流零注入(Req 1.7 经
 * 替身记录佐证:host 命中路径不触碰 session.uiRpc)。
 */
import { describe, expect, it, vi } from "vitest";
import { InstallResultDataSchema } from "@blksails/pi-web-protocol";
import {
  createPiWebHandler,
  createHostCommandRegistry,
  SessionManager,
  InMemorySessionStore,
  type PiSession,
} from "@blksails/pi-web-server";
import { createPackageHostCommand } from "@/lib/app/package-host-command";
import type { Installer } from "@/server/cli/install/installer";
import type { PluginInstaller } from "@/server/cli/install/plugin-installer";

function fakeInstaller(): Installer {
  return {
    install: vi.fn(async () => ({
      ok: true as const,
      value: {
        kind: "agent" as const,
        result: { method: "local" as const, location: "/tmp/agents/demo", created: true },
      },
    })),
    uninstall: vi.fn(async () => ({
      ok: true as const,
      value: {
        kind: "agent" as const,
        result: { method: "local" as const, location: "/tmp/agents/demo" },
      },
    })),
  } as unknown as Installer;
}

function fakePluginInstaller(): PluginInstaller {
  return {
    install: vi.fn(),
    uninstall: vi.fn(),
    listInstalled: vi.fn(async () => ({ ok: true as const, value: [] })),
    update: vi.fn(),
  } as unknown as PluginInstaller;
}

/**
 * 最小会话替身:host 路径只在 plugin 成功时触碰 session(reloadRunner),
 * 集成面关心的是「host 命中路径不转发 session.uiRpc」——记录该调用即可,不需要完整
 * MockSession(其 helpers 依赖 import.meta.url 解析 fixture,在 app 层 vitest 下不可用)。
 */
function makeSession(id: string): { session: PiSession; uiRpcCalls: unknown[] } {
  const uiRpcCalls: unknown[] = [];
  const session = {
    id,
    status: "active",
    uiRpc(request: unknown): void {
      uiRpcCalls.push(request);
    },
    async restartRunner(): Promise<void> {},
  } as unknown as PiSession;
  return { session, uiRpcCalls };
}

function setup(adminAllow = true) {
  const store = new InMemorySessionStore(true);
  const manager = new SessionManager({ store, idleMs: 0 });
  const { session, uiRpcCalls } = makeSession("sess-1");
  store.create(session);
  const deps = {
    installer: fakeInstaller(),
    pluginInstaller: fakePluginInstaller(),
    adminGate: () => adminAllow,
    reloadRunner: vi.fn(async () => {}),
    listAgentSources: vi.fn(async () => [{ id: "/tmp/agents/demo" }]),
  };
  const hostCommands = createHostCommandRegistry([
    createPackageHostCommand("agent", deps),
    createPackageHostCommand("plugin", deps),
  ]);
  const handler = createPiWebHandler({ manager, store, hostCommands });
  return { handler, uiRpcCalls };
}

function uiRpc(name: string, argv: string): Request {
  return new Request("http://x/sessions/sess-1/ui-rpc", {
    method: "POST",
    body: JSON.stringify({
      correlationId: "c1",
      point: "command",
      action: "execute",
      payload: { name, argv },
      protocolVersion: "0.1.0",
    }),
  });
}

describe("/agent 与 /plugin host 命令 ui-rpc 通道集成", () => {
  it("execute install → 同步 HTTP 响应体含 CommandResult(agent 通道,panel-refresh)", async () => {
    const { handler, uiRpcCalls } = setup();
    const res = await handler(uiRpc("agent", "install local:./demo"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      ok: boolean;
      result: { command: string; effect?: string; data?: unknown };
    };
    expect(body.ok).toBe(true);
    expect(body.result.command).toBe("agent");
    expect(body.result.effect).toBe("panel-refresh");
    const parsed = InstallResultDataSchema.safeParse(body.result.data);
    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data.location).toBe("/tmp/agents/demo");
    // Req 1.7:host 命中路径不转发 agent——会话消息流零注入。
    expect(uiRpcCalls).toHaveLength(0);
  });

  it("裸 /agent → 用法文本(effect none,无 data),同步返回", async () => {
    const { handler } = setup();
    const res = await handler(uiRpc("agent", ""));
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      ok: boolean;
      result: { effect?: string; message?: string; data?: unknown };
    };
    expect(body.ok).toBe(true);
    expect(body.result.effect).toBe("none");
    expect(body.result.message).toContain("用法");
    expect(body.result.data).toBeUndefined();
  });

  it("adminGate 拒绝 → 失败卡片同步返回(不 throw、不转 agent)", async () => {
    const { handler, uiRpcCalls } = setup(false);
    const res = await handler(uiRpc("agent", "install local:./demo"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      ok: boolean;
      result: { data?: unknown };
    };
    expect(body.ok).toBe(true);
    const parsed = InstallResultDataSchema.safeParse(body.result.data);
    expect(parsed.success && parsed.data.ok).toBe(false);
    expect(parsed.success && parsed.data.error?.code).toBe("ADMIN_DENIED");
    expect(uiRpcCalls).toHaveLength(0);
  });

  it("execute /plugin list → 同步返回 plugin 通道结果", async () => {
    const { handler } = setup();
    const res = await handler(uiRpc("plugin", "list"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; result: { command: string; data?: unknown } };
    expect(body.ok).toBe(true);
    expect(body.result.command).toBe("plugin");
    const parsed = InstallResultDataSchema.safeParse(body.result.data);
    expect(parsed.success && parsed.data.ok).toBe(true);
  });

  // 摘除回归(Req 3.1/3.2/7.3):旧命令名不得再被 host 注册表命中,否则会有两套等价入口。
  it("旧 /install 不再注册:host 注册表不命中,请求落到 agent 转发路径", async () => {
    const { handler, uiRpcCalls } = setup();
    const res = await handler(uiRpc("install", "install local:./demo"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; result?: { command?: string } };
    // host 未命中 → 不产生 host CommandResult;请求改由会话通道处理。
    expect(body.result?.command).toBeUndefined();
    expect(uiRpcCalls.length).toBeGreaterThan(0);
  });
});
