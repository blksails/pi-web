/**
 * 单元:McpConfigCodec —— 规范化与未识别保留(spec: builtin-mcp-client,任务 1.3;Req 1.2, 5.3, 5.4)。
 */
import { describe, it, expect } from "vitest";
import {
  normalizeMcpConfig,
  buildMcpConfigForWrite,
} from "../../src/config/domains/mcp-codec.js";

describe("normalizeMcpConfig — 兼容既有形态(Req 5.3)", () => {
  it("接受权威的 servers 数组", () => {
    const n = normalizeMcpConfig({
      servers: [{ name: "files", transport: { type: "stdio", command: "npx" } }],
    });
    expect(n.servers).toHaveLength(1);
    expect(n.servers[0]?.name).toBe("files");
    expect(n.migratedFromObjectMap).toBe(false);
  });

  it("接受生态通用的 mcpServers 对象映射,键即 server 名(Req 5.3)", () => {
    const n = normalizeMcpConfig({
      mcpServers: {
        files: { command: "npx", args: ["-y", "pkg"], env: { TOKEN: "t" } },
      },
    });
    expect(n.migratedFromObjectMap).toBe(true);
    expect(n.servers).toHaveLength(1);
    const s = n.servers[0];
    expect(s?.name).toBe("files");
    // 扁平 command 无歧义 → 推断为 stdio
    expect(s?.transport).toMatchObject({ type: "stdio", command: "npx", args: ["-y", "pkg"] });
    expect(s?.enabled).toBe(true);
  });

  it("显式 transport 优先于扁平字段", () => {
    const n = normalizeMcpConfig({
      servers: [
        { name: "r", transport: { type: "sse", url: "https://a/mcp" }, command: "ignored" },
      ],
    });
    expect(n.servers[0]?.transport).toMatchObject({ type: "sse", url: "https://a/mcp" });
  });

  it("带可辨识 type 的扁平远程条目可推断", () => {
    const n = normalizeMcpConfig({
      mcpServers: { r: { type: "streamable-http", url: "https://a/mcp", headers: { A: "1" } } },
    });
    expect(n.servers[0]?.transport).toMatchObject({
      type: "streamable-http",
      url: "https://a/mcp",
      headers: { A: "1" },
    });
  });
});

describe("normalizeMcpConfig — 不擅自丢弃、不擅自猜测(Req 5.4)", () => {
  it("只有 url 而无传输类型 → 不猜 SSE/HTTP,标为未识别并原样保留", () => {
    const raw = { mcpServers: { r: { url: "https://a/mcp" } } };
    const n = normalizeMcpConfig(raw);
    expect(n.servers).toHaveLength(0);
    expect(n.unrecognizedServers).toHaveLength(1);
    expect(n.unrecognizedServers[0]).toMatchObject({ name: "r", reason: "unknown-transport" });
    // 变异判据:若改为默认猜 streamable-http,servers 会变成 1 条 → 此处转红。
    expect(n.unrecognizedServers[0]?.raw).toEqual({ url: "https://a/mcp" });
  });

  it("未知传输类型条目整条保留并标记", () => {
    const entry = { name: "w", transport: { type: "websocket", url: "wss://a" } };
    const n = normalizeMcpConfig({ servers: [entry] });
    expect(n.servers).toHaveLength(0);
    expect(n.unrecognizedServers[0]?.reason).toBe("unknown-transport");
    expect(n.unrecognizedServers[0]?.raw).toEqual(entry);
  });

  it("顶层未识别键原样保留", () => {
    const n = normalizeMcpConfig({
      servers: [],
      globalShortcut: "cmd+k",
      futureSection: { a: 1 },
    });
    expect(n.extraKeys).toEqual({ globalShortcut: "cmd+k", futureSection: { a: 1 } });
  });

  it("条目级未知字段随条目保留", () => {
    const n = normalizeMcpConfig({
      servers: [{ name: "s", transport: { type: "stdio", command: "x" }, note: "keep me" }],
    });
    expect((n.servers[0] as Record<string, unknown>)["note"]).toBe("keep me");
  });

  it("损坏/非对象内容降级为空配置,不抛出", () => {
    for (const bad of [null, undefined, 42, "str", []]) {
      expect(() => normalizeMcpConfig(bad)).not.toThrow();
      expect(normalizeMcpConfig(bad).servers).toEqual([]);
    }
  });
});

describe("buildMcpConfigForWrite — 保存永不丢内容(Req 5.4)", () => {
  it("未识别条目与未识别顶层键在写回后仍在", () => {
    const raw = {
      mcpServers: {
        files: { command: "npx" },
        broken: { url: "https://a/mcp" }, // 无法识别 → 保留
      },
      globalShortcut: "cmd+k", // 顶层未识别 → 保留
    };
    const n = normalizeMcpConfig(raw);
    const out = buildMcpConfigForWrite(n.servers, n);

    expect(out["globalShortcut"]).toBe("cmd+k");
    const servers = out["servers"] as unknown[];
    // 1 条可识别 + 1 条原样保留
    expect(servers).toHaveLength(2);
    expect(servers).toContainEqual({ url: "https://a/mcp" });
    // 变异判据:若写回时丢弃 unrecognizedServers,长度变 1 → 转红。
  });

  it("完整往返:对象映射 → 规范化 → 写回 → 再规范化,可识别条目稳定", () => {
    const first = normalizeMcpConfig({ mcpServers: { files: { command: "npx" } } });
    const written = buildMcpConfigForWrite(first.servers, first);
    const second = normalizeMcpConfig(written);

    expect(second.servers).toHaveLength(1);
    expect(second.servers[0]?.name).toBe("files");
    // 写回后统一为 servers 数组形态,不再是对象映射
    expect(second.migratedFromObjectMap).toBe(false);
    expect(written["mcpServers"]).toBeUndefined();
  });
});
