/**
 * 集成:四端点经 http-api `createPiWebHandler` 的 routes? 注入接缝挂载并按方法+路径命中;
 * install → list → remove 命令装配链路;并经消费 http-api 拥有的 GET /sessions/:id/commands
 * 验证命令面板数据(Req 10.2/1.1/2.1/3.1/5.1)。
 *
 * pi CLI 经注入的 FakePiCli 受控替身验证(无真实网络/安装),清晰标注为 stub。命令面板数据
 * 经真实 session-engine(rpc-channel 起 commands-stub-process)透传。
 */
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { SpawnSpec } from "@blksails/protocol";
import { createPiWebHandler } from "../../src/http/index.js";
import { PiRpcProcess } from "../../src/rpc-channel/index.js";
import { InMemorySessionStore } from "../../src/session/session-store.js";
import { SessionManager } from "../../src/session/session-manager.js";
import type { ResolvedSource } from "../../src/agent-source/index.js";
import type { SessionChannel } from "../../src/session/index.js";
import { createExtensionRoutes } from "../../src/extensions/routes.js";
import { createDefaultAdminPolicy } from "../../src/extensions/security/admin-policy.js";
import {
  adminAuth,
  auditCollector,
  FakePiCli,
  readJson,
} from "./helpers.js";

const COMMANDS_STUB = fileURLToPath(
  new URL("./fixtures/commands-stub-process.mjs", import.meta.url),
);

function stubSpec(extCommand?: string): SpawnSpec {
  const env = { ...process.env } as Record<string, string>;
  if (extCommand !== undefined) env["STUB_EXTENSION_COMMAND"] = extCommand;
  return {
    cmd: process.execPath,
    args: [COMMANDS_STUB],
    cwd: process.cwd(),
    env,
  };
}

function resolved(extCommand?: string): ResolvedSource {
  return {
    mode: "cli",
    trust: "ask",
    cwd: process.cwd(),
    spawnSpec: stubSpec(extCommand),
  };
}

describe("extension-management integration", () => {
  it("mounts the four routes and runs install→list→remove with proper arg construction", async () => {
    const store = new InMemorySessionStore(true);
    const manager = new SessionManager({ store, idleMs: 0 });
    const cli = new FakePiCli();
    const audit = auditCollector();
    const routes = createExtensionRoutes({
      piCli: cli,
      store,
      manager,
      adminPolicy: createDefaultAdminPolicy({ adminUserIds: ["root"] }),
      onAudit: audit.onAudit,
      allowlist: { npmScopes: ["@pi-web"], gitHosts: ["github.com"], allowLocal: false },
    });
    const handler = createPiWebHandler({
      manager,
      store,
      routes,
      authResolver: () => adminAuth,
    });

    // install
    const installRes = await handler(
      new Request("http://x/extensions", {
        method: "POST",
        body: JSON.stringify({ source: "npm:@pi-web/sample@1.2.3" }),
        headers: { "content-type": "application/json" },
      }),
    );
    expect(installRes.status).toBe(200);
    const installCall = cli.runCalls.find((c) => c.args[0] === "install");
    expect(installCall?.args).toContain("--ignore-scripts");

    // list shows it
    const listRes = await handler(
      new Request("http://x/extensions", { method: "GET" }),
    );
    const listBody = await readJson(listRes);
    const exts = listBody["extensions"] as Array<{ id: string }>;
    expect(exts.some((e) => e.id === "@pi-web/sample@1.2.3")).toBe(true);

    // remove
    const rmRes = await handler(
      new Request(
        `http://x/extensions/${encodeURIComponent("@pi-web/sample@1.2.3")}`,
        { method: "DELETE" },
      ),
    );
    expect(rmRes.status).toBe(200);
    expect(cli.runCalls.some((c) => c.args[0] === "remove")).toBe(true);

    // list no longer shows it
    const listRes2 = await handler(
      new Request("http://x/extensions", { method: "GET" }),
    );
    const exts2 = (await readJson(listRes2))["extensions"] as Array<{ id: string }>;
    expect(exts2.some((e) => e.id === "@pi-web/sample@1.2.3")).toBe(false);

    // 每次安装/卸载都产审计记录。
    expect(audit.records.filter((r) => r.action === "install")).toHaveLength(1);
    expect(audit.records.filter((r) => r.action === "remove")).toHaveLength(1);
  });

  it("after a new session, the installed extension's /command appears via http-api GET /sessions/:id/commands", async () => {
    const store = new InMemorySessionStore(true);
    const manager = new SessionManager({ store, idleMs: 0 });
    const cli = new FakePiCli();
    const routes = createExtensionRoutes({
      piCli: cli,
      store,
      manager,
      adminPolicy: createDefaultAdminPolicy({ adminUserIds: ["root"] }),
    });
    const createChannel = (r: ResolvedSource): SessionChannel =>
      new PiRpcProcess(r.spawnSpec);
    const handler = createPiWebHandler({
      manager,
      store,
      routes,
      createChannel,
      resolver: { resolve: () => Promise.resolve(resolved("deploy")) },
      authResolver: () => adminAuth,
    });

    // new session whose agent runtime advertises the extension command "deploy".
    const created = await handler(
      new Request("http://x/sessions", {
        method: "POST",
        body: JSON.stringify({ source: "x" }),
        headers: { "content-type": "application/json" },
      }),
    );
    const { sessionId } = (await readJson(created)) as { sessionId: string };

    // consume http-api's GET /sessions/:id/commands (NOT owned by this spec).
    const cmdsRes = await handler(
      new Request(`http://x/sessions/${sessionId}/commands`, { method: "GET" }),
    );
    expect(cmdsRes.status).toBe(200);
    const cmds = (await readJson(cmdsRes))["commands"] as Array<{ name: string }>;
    expect(cmds.some((c) => c.name === "deploy")).toBe(true);

    await manager.shutdown();
  });
});
