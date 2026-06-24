/**
 * e2e:装扩展(注入式 stub pi)→ 对已有会话 POST /sessions/:id/reload(重建运行时,含信任落地)
 * → 经消费 http-api 拥有的 GET /sessions/:id/commands 含该扩展注册的 /command → 经
 * POST /sessions/:id/messages 以该 /command 作为 prompt 调用使其生效(Req 10.3/4.1/5.1)。
 *
 * pi 安装经注入的 FakePiCli 受控替身(无真实网络/安装,明确标注 STUB)。会话运行时经真实
 * session-engine + rpc-channel 起 commands-stub-process;reload 经 SessionReloader 接缝以
 * "new_session"语义(同 id 重建 + 新通道)重建运行时,使重建后的运行时加载扩展命令。
 */
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { SpawnSpec } from "@blksails/pi-web-protocol";
import { createPiWebHandler } from "../../src/http/index.js";
import { PiRpcProcess } from "../../src/rpc-channel/index.js";
import { PiSession } from "../../src/session/pi-session.js";
import { InMemorySessionStore } from "../../src/session/session-store.js";
import { SessionManager } from "../../src/session/session-manager.js";
import type { ResolvedSource } from "../../src/agent-source/index.js";
import type { SessionChannel } from "../../src/session/index.js";
import { createExtensionRoutes } from "../../src/extensions/routes.js";
import { createDefaultAdminPolicy } from "../../src/extensions/security/admin-policy.js";
import type {
  SessionReloader,
  TrustFragment,
} from "../../src/extensions/ext.types.js";
import { adminAuth, FakePiCli, readJson } from "./helpers.js";

const COMMANDS_STUB = fileURLToPath(
  new URL("./fixtures/commands-stub-process.mjs", import.meta.url),
);

function stubSpec(extCommand?: string): SpawnSpec {
  const env = { ...process.env } as Record<string, string>;
  if (extCommand !== undefined) env["STUB_EXTENSION_COMMAND"] = extCommand;
  else delete env["STUB_EXTENSION_COMMAND"];
  return { cmd: process.execPath, args: [COMMANDS_STUB], cwd: process.cwd(), env };
}

function resolved(extCommand?: string): ResolvedSource {
  return {
    mode: "cli",
    trust: "ask",
    cwd: process.cwd(),
    spawnSpec: stubSpec(extCommand),
  };
}

describe("extension-management e2e (injected-runner STUB for pi; real rpc-channel runtime)", () => {
  it("install → reload → /command appears via http-api commands → prompt invokes it", async () => {
    const store = new InMemorySessionStore(true);
    const manager = new SessionManager({ store, idleMs: 0 });
    const cli = new FakePiCli();

    const reloadFragments: TrustFragment[] = [];
    // 重载接缝:以 "new_session" 语义同 id 重建运行时,新通道的 agent 此次加载扩展命令。
    const reloadSession: SessionReloader = async (session, fragment) => {
      reloadFragments.push(fragment);
      await session.stop("stopped");
      const rebuilt = new PiSession({
        id: session.id,
        resolved: resolved("deploy"),
        channel: new PiRpcProcess(resolved("deploy").spawnSpec),
        idleMs: 0,
        onClosed: (id) => store.delete(id),
      });
      store.create(rebuilt);
    };

    const createChannel = (r: ResolvedSource): SessionChannel =>
      new PiRpcProcess(r.spawnSpec);
    const routes = createExtensionRoutes({
      piCli: cli,
      store,
      manager,
      adminPolicy: createDefaultAdminPolicy({ adminUserIds: ["root"] }),
      reloadSession,
      trustPolicy: () => "always",
    });
    const handler = createPiWebHandler({
      manager,
      store,
      routes,
      createChannel,
      // 起始会话的运行时尚无扩展命令(extCommand=undefined)。
      resolver: { resolve: () => Promise.resolve(resolved()) },
      authResolver: () => adminAuth,
    });

    // 1) 安装扩展(STUB pi:无网络)。
    const installRes = await handler(
      new Request("http://x/extensions", {
        method: "POST",
        body: JSON.stringify({ source: "npm:@pi-web/sample@1.2.3" }),
        headers: { "content-type": "application/json" },
      }),
    );
    expect(installRes.status).toBe(200);

    // 2) 已有会话:初始运行时不含 "deploy" 命令。
    const created = await handler(
      new Request("http://x/sessions", {
        method: "POST",
        body: JSON.stringify({ source: "x" }),
        headers: { "content-type": "application/json" },
      }),
    );
    const { sessionId } = (await readJson(created)) as { sessionId: string };

    const before = await handler(
      new Request(`http://x/sessions/${sessionId}/commands`, { method: "GET" }),
    );
    const beforeCmds = (await readJson(before))["commands"] as Array<{ name: string }>;
    expect(beforeCmds.some((c) => c.name === "deploy")).toBe(false);

    // 3) reload:重建运行时(含信任落地)。
    const reloadRes = await handler(
      new Request(`http://x/sessions/${sessionId}/reload`, { method: "POST" }),
    );
    expect(reloadRes.status).toBe(200);
    // 信任落地:cli + always → --approve。
    expect(reloadFragments[0]!.extraArgs).toEqual(["--approve"]);

    // 4) reload 后经 http-api 的命令路由含该扩展注册的 /command。
    const after = await handler(
      new Request(`http://x/sessions/${sessionId}/commands`, { method: "GET" }),
    );
    expect(after.status).toBe(200);
    const afterCmds = (await readJson(after))["commands"] as Array<{
      name: string;
      source?: string;
    }>;
    const deploy = afterCmds.find((c) => c.name === "deploy");
    expect(deploy).toBeDefined();
    expect(deploy?.source).toBe("extension");

    // 5) 以该 /command 作为 prompt 调用,断言会话仍可命令转发(ack)。
    const prompt = await handler(
      new Request(`http://x/sessions/${sessionId}/messages`, {
        method: "POST",
        body: JSON.stringify({ message: "/deploy" }),
        headers: { "content-type": "application/json" },
      }),
    );
    expect(prompt.status).toBe(200);

    await manager.shutdown();
  });
});
