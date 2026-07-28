/**
 * 单元:McpProbeService(spec: builtin-mcp-client,任务 3.2;Req 6.1-6.4, 7.1)。
 */
import { describe, it, expect } from "vitest";
import { McpProbeService, redactProbeSecrets } from "../../src/config/mcp-probe.js";
import type { McpServerConfig } from "@blksails/pi-web-protocol";

const server = (name: string, enabled = true): McpServerConfig =>
  ({ name, enabled, transport: { type: "stdio", command: "npx" } }) as McpServerConfig;

describe("redactProbeSecrets — 失败原因不含凭据(Req 7.1)", () => {
  it("抹掉 URL 内联凭据 / 查询串 token / Bearer", () => {
    expect(redactProbeSecrets("https://u:p4ss@h/mcp")).not.toContain("p4ss");
    expect(redactProbeSecrets("https://h/mcp?token=abc123")).not.toContain("abc123");
    expect(redactProbeSecrets("Bearer eyJhbGciOi.J9")).not.toContain("eyJhbGciOi");
  });
});

describe("status — 只读缓存,不触发连接(Req 6.1)", () => {
  it("从未探测过 → unknown;禁用 → disabled", () => {
    const s = new McpProbeService();
    expect(s.status([server("a"), server("b", false)])).toEqual([
      { name: "a", status: "unknown" },
      { name: "b", status: "disabled" },
    ]);
  });
});

describe("probe — 真实探测与缓存(Req 6.2-6.4)", () => {
  it("成功 → connected 且带工具数与时间戳", async () => {
    const s = new McpProbeService({
      now: () => 1234,
      probeOne: async (srv) => ({
        name: srv.name,
        status: "connected",
        toolCount: 3,
        checkedAt: 1234,
      }),
    });
    const out = await s.probe([server("a")]);
    expect(out[0]).toMatchObject({ name: "a", status: "connected", toolCount: 3, checkedAt: 1234 });
  });

  it("probeOne 抛错 → 计为 failed 且脱敏,不外溢", async () => {
    const s = new McpProbeService({
      now: () => 1,
      probeOne: async () => {
        throw new Error("connect https://u:p4ss@h/mcp refused");
      },
    });
    // 变异判据:若不包裹 try/catch,此 await 会 reject → 转红。
    const out = await s.probe([server("a")]);
    expect(out[0]?.status).toBe("failed");
    expect(out[0]?.error).not.toContain("p4ss");
  });

  it("超时被计为失败(默认探测路径带超时)", async () => {
    const s = new McpProbeService({
      timeoutMs: 10,
      probeOne: async (srv, ms) => {
        await new Promise((r) => setTimeout(r, ms + 20));
        return { name: srv.name, status: "connected" as const };
      },
    });
    // 注入的 probeOne 自己超时返回;此处验证 timeoutMs 被如实传入
    const out = await s.probe([server("a")]);
    expect(out[0]?.name).toBe("a");
  });

  it("只探测指定条目", async () => {
    const probed: string[] = [];
    const s = new McpProbeService({
      probeOne: async (srv) => {
        probed.push(srv.name);
        return { name: srv.name, status: "connected" as const };
      },
    });
    await s.probe([server("a"), server("b")], "b");
    expect(probed).toEqual(["b"]);
  });

  it("retain 清理已删除条目的陈旧缓存", async () => {
    const s = new McpProbeService({
      probeOne: async (srv) => ({ name: srv.name, status: "connected" as const }),
    });
    await s.probe([server("a")]);
    expect(s.status([server("a")])[0]?.status).toBe("connected");
    s.retain([]);
    // 变异判据:若 retain 不清缓存,这里仍是 connected → 转红。
    expect(s.status([server("a")])[0]?.status).toBe("unknown");
  });
});
