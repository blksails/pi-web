/**
 * SandboxWsTransport 真机集成(本地 agent-sandbox,WS-runner 数据面)。
 * 仅 PI_WEB_E2B_LOCAL=1 运行。证明 **pi-web 自己的传输** 把执行带进容器:
 *   pi-web SandboxWsTransport → Sandbox.create(demo runner 镜像) → WS 连沙箱内 agent-runner
 *   → 容器内 stub-agent 处理 send 的行 → 流式输出经 transport.onLine 回来。
 *
 * 前置:kind + agent-sandbox 起着、port-forward :10000、反代 :13000、demo 镜像已 kind load。
 * 运行(dev:e2b:local 已把 port-forward + 反代拉起时):
 *   PI_WEB_E2B_LOCAL=1 E2B_API_KEY=sys-... \
 *   npx vitest run test/rpc-channel/sandbox-ws-transport.local.test.ts
 */
import { describe, it, expect } from "vitest";
import { SandboxWsTransport } from "../../src/rpc-channel/sandbox-ws-transport.js";
import type { SpawnSpec } from "@blksails/pi-web-protocol";

const RUN = process.env.PI_WEB_E2B_LOCAL === "1";
const API_KEY = process.env.E2B_API_KEY ?? "sys-2492a85b10ed4cb083b2c76b181eac96";
const API_URL = process.env.PI_WEB_E2B_API_URL ?? "http://127.0.0.1:13000";
const WS_BASE = process.env.PI_WEB_E2B_RUNNER_WS_BASE ?? "ws://127.0.0.1:10000";
const DOMAIN = process.env.E2B_DOMAIN ?? "localhost:10000";
const TEMPLATE = process.env.PI_WEB_E2B_WS_TEMPLATE ?? "piweb-demo";

function spec(): SpawnSpec {
  return { cmd: "node", args: [], cwd: "/tmp", env: {} };
}

describe.skipIf(!RUN)("SandboxWsTransport @ 本地 agent-sandbox(WS-runner 完整数据面)", () => {
  it("create → WS 连 runner → send 行由容器内 stub 处理 → onLine 收到流式输出", async () => {
    const t = new SandboxWsTransport(spec(), {
      apiKey: API_KEY,
      template: TEMPLATE,
      apiUrl: API_URL,
      domain: DOMAIN,
      validateApiKey: false,
      wsBase: WS_BASE,
      runnerPort: 8080,
      reconnectDelayMs: 500,
    });

    const lines: string[] = [];
    t.onLine((l) => lines.push(l));

    // 等沙箱起 + WS 连上 runner(冷 pod 可能 >10s;transport 自动重连)。
    await t.ready();
    await new Promise((r) => setTimeout(r, 14000));

    // 经【pi-web 传输】把一行发进容器;stub-agent 读 message 后流式回。
    const MARK = "pi-web-ws-transport-" + Date.now().toString(36);
    t.send(JSON.stringify({ message: MARK }));

    // 收流式输出(thinking/text-delta/done,含我们的 MARK)。
    await new Promise((r) => setTimeout(r, 6000));

    const joined = lines.join("\n");
    // eslint-disable-next-line no-console
    console.log("[ws-runner] 容器内 stub 经 pi-web 传输回传的行:\n" + joined);

    expect(lines.length).toBeGreaterThan(0);
    expect(joined).toContain("stub-agent"); // 来自容器内进程的自述
    expect(joined).toContain(MARK); // 我们发进去的内容被容器内进程回显 → 证明往返

    await t.close();
    expect(t.health().alive).toBe(false);
  }, 60000);
});
