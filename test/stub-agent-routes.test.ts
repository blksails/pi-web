// @vitest-environment node
/**
 * agent-declared-routes · Task 4.1 — stub agent 演示 routes(进程级帧面验证)。
 *
 * 直接 spawn 真实 stub 子进程(lib/app/stub-agent-process.mjs,不带 PI_WEB_STUB_SESSION_ID
 * → 不触发持久化/jiti 依赖),经 stdin/stdout JSONL 管道验证三件事(Req 6.1, 7.3):
 *
 *  1. 装配期声明帧:get_commands(readiness 探针,slash_completions 同位先例)触发一条
 *     `{"type":"agent_routes",routes:[...]}`,含 `gallery-stats`(GET)与 `echo`(POST)
 *     两个演示 route(均带 description,供清单端点回显)。
 *  2. 请求帧应答:`piweb_agent_route_request` → `piweb_agent_route_result`,id 原样回带;
 *     `gallery-stats` 回定值 JSON;`echo` 回显 body 与 query(POST 档供 e2e 5.2)。
 *  3. 未知 name → `ok:false, error.code="route_not_registered"`(与真桥
 *     wireAgentRoutesBridge 语义一致)。
 *
 * 帧形状与 protocol/src/agent-routes/frames.ts 的 zod 契约对齐(此处按原始 JSON 断言,
 * 避免根 vitest alias 面对 protocol 子包的额外耦合)。
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import path from "node:path";

const STUB_PATH = path.join(process.cwd(), "lib", "app", "stub-agent-process.mjs");

type Frame = Record<string, unknown> & { type: string };

let child: ChildProcessWithoutNullStreams;
const frames: Frame[] = [];
let notifyFrame: (() => void) | undefined;

function send(obj: unknown): void {
  child.stdin.write(JSON.stringify(obj) + "\n");
}

/** 等待首个满足谓词的帧(已到达的也算),超时抛错并附上已见帧类型便于诊断。 */
function waitForFrame(
  pred: (f: Frame) => boolean,
  timeoutMs = 5000,
): Promise<Frame> {
  const found = frames.find(pred);
  if (found !== undefined) return Promise.resolve(found);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      notifyFrame = undefined;
      reject(
        new Error(
          `timed out waiting for frame; seen: ${frames.map((f) => f.type).join(", ")}`,
        ),
      );
    }, timeoutMs);
    notifyFrame = () => {
      const hit = frames.find(pred);
      if (hit === undefined) return;
      clearTimeout(timer);
      notifyFrame = undefined;
      resolve(hit);
    };
  });
}

beforeAll(() => {
  child = spawn(process.execPath, [STUB_PATH], {
    stdio: ["pipe", "pipe", "pipe"],
  });
  child.stdout.setEncoding("utf8");
  let buffer = "";
  child.stdout.on("data", (chunk: string) => {
    buffer += chunk;
    let idx;
    while ((idx = buffer.indexOf("\n")) !== -1) {
      const raw = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 1);
      if (raw.length === 0) continue;
      try {
        frames.push(JSON.parse(raw) as Frame);
      } catch {
        // 忽略非 JSON 行
      }
    }
    notifyFrame?.();
  });
});

afterAll(() => {
  child.kill("SIGTERM");
});

describe("stub-agent-process demo agent routes (agent-declared-routes 4.1)", () => {
  it("emits the agent_routes declaration frame with demo routes on get_commands", async () => {
    send({ type: "get_commands", id: "c1" });
    const decl = await waitForFrame((f) => f.type === "agent_routes");
    const routes = decl.routes as Array<{
      name: string;
      methods: string[];
      description?: string;
    }>;
    expect(Array.isArray(routes)).toBe(true);

    const galleryStats = routes.find((r) => r.name === "gallery-stats");
    expect(galleryStats).toBeDefined();
    expect(galleryStats!.methods).toEqual(["GET"]);
    expect(typeof galleryStats!.description).toBe("string");
    expect(galleryStats!.description!.length).toBeGreaterThan(0);

    const echo = routes.find((r) => r.name === "echo");
    expect(echo).toBeDefined();
    expect(echo!.methods).toEqual(["POST"]);
    expect(typeof echo!.description).toBe("string");

    // get_commands 本身仍正常 ack(声明帧不吞既有协议行为)。
    const ack = await waitForFrame(
      (f) => f.type === "response" && f.id === "c1",
    );
    expect(ack.success).toBe(true);
  });

  it("answers gallery-stats requests with deterministic JSON (id echoed back)", async () => {
    send({
      type: "piweb_agent_route_request",
      id: "r1",
      name: "gallery-stats",
      method: "GET",
      query: {},
    });
    const res = await waitForFrame(
      (f) => f.type === "piweb_agent_route_result" && f.id === "r1",
    );
    expect(res.ok).toBe(true);
    expect(res.result).toEqual({ count: 3, source: "stub" });
    expect(res.error).toBeUndefined();
  });

  it("answers echo POST requests by reflecting body and query", async () => {
    send({
      type: "piweb_agent_route_request",
      id: "r2",
      name: "echo",
      method: "POST",
      query: { a: "1" },
      body: { hello: "world" },
    });
    const res = await waitForFrame(
      (f) => f.type === "piweb_agent_route_result" && f.id === "r2",
    );
    expect(res.ok).toBe(true);
    expect(res.result).toEqual({
      echoed: { hello: "world" },
      query: { a: "1" },
    });
  });

  it("answers unknown route names with route_not_registered (aligned with the real bridge)", async () => {
    send({
      type: "piweb_agent_route_request",
      id: "r3",
      name: "no-such-route",
      method: "GET",
      query: {},
    });
    const res = await waitForFrame(
      (f) => f.type === "piweb_agent_route_result" && f.id === "r3",
    );
    expect(res.ok).toBe(false);
    expect(res.result).toBeUndefined();
    expect((res.error as { code: string }).code).toBe("route_not_registered");
  });
});
