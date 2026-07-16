/**
 * SandboxWsTransport 单元测试(WS-runner 数据面)。
 *
 * mock e2b SDK(控制面 create/kill)+ mock 全局 WebSocket(数据面),不真连任何后端。
 * 覆盖:boot 起沙盒 + 连 WS 到正确端点(manager-path / e2b-host)、open 发 hello+configure+
 * 触发 onSpawn + flush outbox、send 映射 line、line(seq)→onLine + lastSeq、重连携 lastSeq、
 * health(dead)→onExit、log→onStderr(不混 onLine)、close→WS 关 + sandbox.kill、boot 失败→SpawnError。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type { SpawnSpec } from "@blksails/pi-web-protocol";

// ── mock e2b SDK ──
const e2bState = vi.hoisted(() => ({
  createArgs: [] as Array<{ template: string; opts: Record<string, unknown> }>,
  sandboxKilled: 0,
  createShouldThrow: false,
  sandboxId: "47b67191323b4a2b9611d081af05df85",
}));

// ── mock `ws` 包(header 路由模式建连用;记录 endpoint + upgrade headers)──
const wsPkgState = vi.hoisted(() => ({
  instances: [] as Array<{
    url: string;
    headers: Record<string, string> | undefined;
    sent: string[];
    readyState: number;
    onopen: (() => void) | null;
    onmessage: ((ev: { data: string }) => void) | null;
    onclose: (() => void) | null;
    onerror: (() => void) | null;
    send(data: string): void;
    close(): void;
    drvOpen(): void;
  }>,
}));

vi.mock("ws", () => {
  class FakeWsPackageSocket {
    static readonly CLOSED = 3;
    url: string;
    headers: Record<string, string> | undefined;
    sent: string[] = [];
    readyState = 0;
    onopen: (() => void) | null = null;
    onmessage: ((ev: { data: string }) => void) | null = null;
    onclose: (() => void) | null = null;
    onerror: (() => void) | null = null;
    constructor(url: string, opts?: { headers?: Record<string, string> }) {
      this.url = url;
      this.headers = opts?.headers;
      wsPkgState.instances.push(this);
    }
    send(data: string): void {
      this.sent.push(data);
    }
    close(): void {
      this.readyState = FakeWsPackageSocket.CLOSED;
      this.onclose?.();
    }
    drvOpen(): void {
      this.readyState = 1;
      this.onopen?.();
    }
  }
  return { default: FakeWsPackageSocket };
});

vi.mock("e2b", () => {
  class Sandbox {
    readonly sandboxId = e2bState.sandboxId;
    getHost(port: number): string {
      return `${port}-${this.sandboxId}.e2b.app`;
    }
    async kill(): Promise<boolean> {
      e2bState.sandboxKilled++;
      return true;
    }
    static async create(template: string, opts: Record<string, unknown>) {
      e2bState.createArgs.push({ template, opts });
      if (e2bState.createShouldThrow) throw new Error("boom-create");
      return new Sandbox();
    }
  }
  return { Sandbox };
});

// ── mock 全局 WebSocket ──
class FakeWebSocket {
  static instances: FakeWebSocket[] = [];
  static readonly CLOSED = 3;
  url: string;
  readyState = 0;
  sent: string[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((ev: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(url: string) {
    this.url = url;
    FakeWebSocket.instances.push(this);
  }
  send(data: string): void {
    this.sent.push(data);
  }
  close(): void {
    this.readyState = FakeWebSocket.CLOSED;
    this.onclose?.();
  }
  // 测试驱动
  drvOpen(): void {
    this.readyState = 1;
    this.onopen?.();
  }
  drvMessage(obj: unknown): void {
    this.onmessage?.({ data: JSON.stringify(obj) });
  }
  drvError(): void {
    this.onerror?.();
  }
}

const { SandboxWsTransport } = await import(
  "../../src/rpc-channel/sandbox-ws-transport.js"
);
const { SpawnError } = await import(
  "../../src/rpc-channel/pi-rpc-process.errors.js"
);

function spec(env: Record<string, string> = {}): SpawnSpec {
  return { cmd: "node", args: [], cwd: "/tmp", env };
}
function lastWs(): FakeWebSocket {
  const w = FakeWebSocket.instances[FakeWebSocket.instances.length - 1];
  if (!w) throw new Error("no WebSocket created");
  return w;
}
function parse(raw: string | undefined): Record<string, unknown> {
  if (raw === undefined) throw new Error("expected a sent frame");
  return JSON.parse(raw) as Record<string, unknown>;
}

const origWs = globalThis.WebSocket;
beforeEach(() => {
  e2bState.createArgs = [];
  e2bState.sandboxKilled = 0;
  e2bState.createShouldThrow = false;
  e2bState.sandboxId = "47b67191323b4a2b9611d081af05df85";
  FakeWebSocket.instances = [];
  wsPkgState.instances = [];
  (globalThis as { WebSocket: unknown }).WebSocket = FakeWebSocket;
});
afterEach(() => {
  (globalThis as { WebSocket: unknown }).WebSocket = origWs;
});

describe("SandboxWsTransport — boot + 端点解析", () => {
  it("manager-path(wsBase 已配)连 /sandbox/{id}/?port=", async () => {
    const t = new SandboxWsTransport(spec(), {
      apiKey: "sys-x",
      template: "aio",
      wsBase: "ws://127.0.0.1:10000",
      runnerPort: 8080,
      validateApiKey: false,
    });
    await t.ready();
    expect(e2bState.createArgs).toHaveLength(1);
    expect(lastWs().url).toBe("ws://127.0.0.1:10000/sandbox/sbx-aio-47b67191323b4a2b9611/?port=8080");
    await t.close();
  });

  it("manager-path 派生路由名超 63 字符时截断到 63(镜像 manager 的 K8s 名截断)", async () => {
    // 烘焙模板名可长达 71-76 字符的派生名;agent-sandbox manager 创建沙箱时把实际
    // sandbox 名截断到 63 字符(K8s 对象名上限),全长名路由会 502 pod not found。
    const longTemplate = "piweb-agent-aigc-canvas-agent-78d565b7-with-long-suffix"; // 55 字符
    const fullName = `sbx-${longTemplate}-${e2bState.sandboxId.slice(0, 20)}`; // 80 字符
    expect(fullName.length).toBeGreaterThan(63);
    const t = new SandboxWsTransport(spec(), {
      apiKey: "sys-x",
      template: longTemplate,
      wsBase: "ws://127.0.0.1:10000",
      runnerPort: 8080,
      validateApiKey: false,
    });
    await t.ready();
    const m = /\/sandbox\/([^/]+)\/\?port=8080$/.exec(lastWs().url);
    if (!m?.[1]) throw new Error(`unexpected endpoint: ${lastWs().url}`);
    expect(m[1]).toHaveLength(63);
    expect(m[1]).toBe(fullName.slice(0, 63));
    await t.close();
  });

  it("manager-path 派生路由名不足 63 字符时不截断", async () => {
    const t = new SandboxWsTransport(spec(), {
      apiKey: "sys-x",
      template: "piweb-demo",
      wsBase: "ws://127.0.0.1:10000",
      runnerPort: 8080,
      validateApiKey: false,
    });
    await t.ready();
    // sbx-piweb-demo-{前20位} = 35 字符,原样保留
    expect(lastWs().url).toBe(
      "ws://127.0.0.1:10000/sandbox/sbx-piweb-demo-47b67191323b4a2b9611/?port=8080",
    );
    await t.close();
  });

  it("e2b-host(未配 wsBase)连 wss://getHost", async () => {
    const t = new SandboxWsTransport(spec(), { apiKey: "e2b_x", template: "t" });
    await t.ready();
    expect(lastWs().url).toBe("wss://8080-47b67191323b4a2b9611d081af05df85.e2b.app");
    await t.close();
  });

  it('header 路由(wsRoute:"header"):直连 wsBase,经 ws 包携 e2b-sandbox-id/-port 头(ACS gateway)', async () => {
    e2bState.sandboxId = "default--pi-runner-zj99d"; // ACS 形态 id(含 `--`)原样入头
    const t = new SandboxWsTransport(spec(), {
      apiKey: "sys-x",
      template: "pi-runner",
      wsBase: "ws://127.0.0.1:17788",
      wsRoute: "header",
      runnerPort: 8787,
      validateApiKey: false,
    });
    await t.ready();
    // header 模式建 socket 是异步路径(懒加载 ws 包),flush 微任务后断言。
    await vi.waitFor(() => {
      expect(wsPkgState.instances).toHaveLength(1);
    });
    const sock = wsPkgState.instances[0]!;
    expect(sock.url).toBe("ws://127.0.0.1:17788");
    expect(sock.headers).toEqual({
      "e2b-sandbox-id": "default--pi-runner-zj99d",
      "e2b-sandbox-port": "8787",
    });
    // 全局 WebSocket 不参与(header 模式全走 ws 包)。
    expect(FakeWebSocket.instances).toHaveLength(0);
    // open 后照常走 hello+configure 协议(与 path 模式同一状态机)。
    sock.drvOpen();
    expect(parse(sock.sent[0])).toMatchObject({ type: "hello" });
    expect(parse(sock.sent[1])).toMatchObject({ type: "configure" });
    await t.close();
  });

  it('wsRoute 未设(缺省 path):不加载 ws 包,行为与现状完全一致', async () => {
    const t = new SandboxWsTransport(spec(), {
      apiKey: "sys-x",
      template: "aio",
      wsBase: "ws://127.0.0.1:10000",
      runnerPort: 8080,
      validateApiKey: false,
    });
    await t.ready();
    expect(wsPkgState.instances).toHaveLength(0);
    expect(lastWs().url).toContain("/sandbox/sbx-aio-");
    await t.close();
  });
});

describe("SandboxWsTransport — WS 数据面协议", () => {
  it("open 发 hello+configure、触发 onSpawn、flush 就绪前 send", async () => {
    const t = new SandboxWsTransport(spec({ K: "v" }), {
      apiKey: "sys-x",
      template: "aio",
      wsBase: "ws://m",
      validateApiKey: false,
      envPassthrough: ["K"],
    });
    await t.ready();
    // 就绪前发一行 → 进 outbox
    t.send('{"early":1}');
    const spawned = vi.fn();
    t.onSpawn(spawned);

    lastWs().drvOpen();

    const ws = lastWs();
    const msgs = ws.sent.map((s) => parse(s));
    expect(msgs[0]).toMatchObject({ type: "hello", lastSeq: 0 });
    expect(msgs[1]).toMatchObject({ type: "configure", env: { K: "v" } });
    expect(msgs[2]).toMatchObject({ type: "line", line: '{"early":1}' }); // flush
    expect(spawned).toHaveBeenCalledTimes(1);
    await t.close();
  });

  it("send 映射为 {type:line}", async () => {
    const t = new SandboxWsTransport(spec(), { apiKey: "k", template: "t", wsBase: "ws://m" });
    await t.ready();
    lastWs().drvOpen();
    lastWs().sent.length = 0;
    t.send('{"type":"prompt","id":"p1"}');
    expect(parse(lastWs().sent[0])).toMatchObject({
      type: "line",
      line: '{"type":"prompt","id":"p1"}',
    });
    await t.close();
  });

  it("收 line(seq) → onLine + 记 lastSeq;重连携 lastSeq", async () => {
    const t = new SandboxWsTransport(spec(), {
      apiKey: "k",
      template: "t",
      wsBase: "ws://m",
      reconnectDelayMs: 5,
    });
    await t.ready();
    const lines: string[] = [];
    t.onLine((l) => lines.push(l));
    lastWs().drvOpen();
    lastWs().drvMessage({ type: "line", seq: 1, line: "a" });
    lastWs().drvMessage({ type: "line", seq: 2, line: "b" });
    expect(lines).toEqual(["a", "b"]);

    // 断线 → 重连,新连接 hello 应携 lastSeq=2
    lastWs().close();
    await new Promise((r) => setTimeout(r, 15));
    const reconnected = lastWs();
    reconnected.drvOpen();
    expect(parse(reconnected.sent[0])).toMatchObject({ type: "hello", lastSeq: 2 });
    await t.close();
  });

  it("收 health(alive:false) → onExit", async () => {
    const t = new SandboxWsTransport(spec(), { apiKey: "k", template: "t", wsBase: "ws://m" });
    await t.ready();
    const exits: Array<{ code: number | null; signal: string | null }> = [];
    t.onExit((i) => exits.push(i));
    lastWs().drvOpen();
    lastWs().drvMessage({ type: "health", alive: false, exitCode: 137, signal: "SIGKILL" });
    expect(exits).toEqual([{ code: 137, signal: "SIGKILL" }]);
    await t.close();
  });

  it("收 log → onStderr,不混入 onLine(fd1 铁律)", async () => {
    const t = new SandboxWsTransport(spec(), { apiKey: "k", template: "t", wsBase: "ws://m" });
    await t.ready();
    const lines: string[] = [];
    const errs: string[] = [];
    t.onLine((l) => lines.push(l));
    t.onStderr((c) => errs.push(c));
    lastWs().drvOpen();
    lastWs().drvMessage({ type: "log", line: "diag boom" });
    expect(errs).toEqual(["diag boom\n"]);
    expect(lines).toEqual([]);
    await t.close();
  });
});

describe("SandboxWsTransport — close 与错误", () => {
  it("close 关 WS + kill 沙箱,health().alive=false", async () => {
    const t = new SandboxWsTransport(spec(), { apiKey: "k", template: "t", wsBase: "ws://m" });
    await t.ready();
    lastWs().drvOpen();
    expect(t.health().alive).toBe(true);
    await t.close();
    expect(lastWs().readyState).toBe(FakeWebSocket.CLOSED);
    expect(e2bState.sandboxKilled).toBe(1);
    expect(t.health().alive).toBe(false);
  });

  it("boot 失败 → SpawnError,并经 onExit 通知", async () => {
    e2bState.createShouldThrow = true;
    const t = new SandboxWsTransport(spec(), { apiKey: "k", template: "t", wsBase: "ws://m" });
    const exits: unknown[] = [];
    t.onExit((i) => exits.push(i));
    await expect(t.ready()).rejects.toBeInstanceOf(SpawnError);
    expect(exits).toHaveLength(1);
    expect(t.health().alive).toBe(false);
  });
});
