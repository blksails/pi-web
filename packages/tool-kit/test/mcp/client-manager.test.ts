/**
 * 单元:McpClientManager(spec: builtin-mcp-client,任务 2.3;Req 1.3-1.6, 7.1)。
 *
 * 用 mock 替换 SDK Client 与传输构造,使连接语义可在无真实 server 下验证。
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { McpServerConfig } from "@blksails/pi-web-protocol";

const connectMock = vi.fn();
const listToolsMock = vi.fn();
const closeMock = vi.fn();

vi.mock("@modelcontextprotocol/sdk/client/index.js", () => ({
  Client: class {
    connect = connectMock;
    listTools = listToolsMock;
    close = closeMock;
    callTool = vi.fn();
  },
}));

const createTransportMock = vi.fn((_config?: unknown) => ({}) as never);
vi.mock("../../src/mcp/transport-factory.js", () => ({
  createMcpTransport: (...args: unknown[]) => createTransportMock(...(args as [never])),
  UnsupportedMcpTransportError: class extends Error {},
}));

const { McpClientManager, redactSecrets } = await import("../../src/mcp/client-manager.js");

const stdio = (name: string, enabled = true): McpServerConfig =>
  ({
    name,
    enabled,
    transport: { type: "stdio", command: "node", args: [], env: {} },
  }) as McpServerConfig;

beforeEach(() => {
  connectMock.mockReset().mockResolvedValue(undefined);
  listToolsMock.mockReset().mockResolvedValue({ tools: [{ name: "read", inputSchema: { type: "object" } }] });
  closeMock.mockReset().mockResolvedValue(undefined);
  createTransportMock.mockClear();
});

describe("redactSecrets — 凭据不进日志(Req 7.1)", () => {
  it("抹掉 URL 内联凭据", () => {
    expect(redactSecrets("failed https://alice:s3cret@host/mcp")).toContain("***@host");
    expect(redactSecrets("failed https://alice:s3cret@host/mcp")).not.toContain("s3cret");
  });

  it("抹掉查询串里的 token / api_key / secret", () => {
    for (const q of ["?token=abc123", "&api_key=abc123", "&access_token=abc123", "?secret=abc123"]) {
      const out = redactSecrets(`connect https://h/mcp${q} failed`);
      expect(out, q).not.toContain("abc123");
      expect(out, q).toContain("***");
    }
  });

  it("抹掉 Bearer 令牌", () => {
    expect(redactSecrets("header Bearer eyJhbGciOi.J9")).not.toContain("eyJhbGciOi");
  });

  it("不改动无凭据的普通文本", () => {
    expect(redactSecrets("ECONNREFUSED 127.0.0.1:3000")).toBe("ECONNREFUSED 127.0.0.1:3000");
  });
});

describe("connectAll — 连接语义(Req 1.3-1.5)", () => {
  it("禁用条目零连接,状态为 skipped(Req 1.4)", async () => {
    const m = new McpClientManager();
    const out = await m.connectAll([stdio("off", false)]);
    expect(out[0]).toMatchObject({ serverName: "off", status: "skipped" });
    // 变异判据:若忘记按 enabled 过滤,这里会构造传输 → 转红。
    expect(createTransportMock).not.toHaveBeenCalled();
    expect(connectMock).not.toHaveBeenCalled();
  });

  it("连接成功返回工具清单(Req 1.3, 3.1)", async () => {
    const m = new McpClientManager();
    const out = await m.connectAll([stdio("files")]);
    expect(out[0]).toMatchObject({ serverName: "files", status: "connected" });
    expect(out[0]?.tools.map((t) => t.name)).toEqual(["read"]);
  });

  it("一个 server 失败不影响其余,且不抛出(Req 1.5)", async () => {
    connectMock
      .mockRejectedValueOnce(new Error("ECONNREFUSED"))
      .mockResolvedValueOnce(undefined);
    const m = new McpClientManager();
    // 变异判据:若把失败向外抛,此 await 会 reject → 转红。
    const out = await m.connectAll([stdio("bad"), stdio("good")]);
    expect(out).toHaveLength(2);
    expect(out.find((o) => o.serverName === "bad")?.status).toBe("failed");
    expect(out.find((o) => o.serverName === "good")?.status).toBe("connected");
  });

  it("失败原因经脱敏(Req 7.1)", async () => {
    connectMock.mockRejectedValueOnce(new Error("connect https://u:p4ss@h/mcp refused"));
    const m = new McpClientManager();
    const out = await m.connectAll([stdio("bad")]);
    expect(out[0]?.error).toBeDefined();
    expect(out[0]?.error).not.toContain("p4ss");
  });

  it("连接失败时释放已创建的客户端资源", async () => {
    connectMock.mockRejectedValueOnce(new Error("boom"));
    const m = new McpClientManager();
    await m.connectAll([stdio("bad")]);
    expect(closeMock).toHaveBeenCalled();
  });

  it("超时被计为失败而非挂起(各条目独立超时)", async () => {
    connectMock.mockImplementationOnce(() => new Promise(() => {})); // 永不 settle
    const m = new McpClientManager({ connectTimeoutMs: 20 });
    const out = await m.connectAll([stdio("slow")]);
    expect(out[0]?.status).toBe("failed");
    expect(out[0]?.error).toContain("timed out");
  });
});

describe("closeAll — 资源回收(Req 1.6)", () => {
  it("关闭全部已连接客户端,且关闭期错误不抛出", async () => {
    const m = new McpClientManager();
    await m.connectAll([stdio("a"), stdio("b")]);
    closeMock.mockRejectedValueOnce(new Error("close failed"));
    await expect(m.closeAll()).resolves.toBeUndefined();
    expect(closeMock).toHaveBeenCalledTimes(2);
  });
});
