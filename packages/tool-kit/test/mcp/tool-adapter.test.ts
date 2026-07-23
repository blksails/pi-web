/**
 * 单元:McpToolAdapter(spec: builtin-mcp-client,任务 2.2;Req 3.1, 3.3, 3.4, 3.5)。
 */
import { describe, it, expect, vi } from "vitest";
import {
  adaptMcpTool,
  composeToolName,
  resolveParameterSchema,
  type McpToolCallResult,
} from "../../src/mcp/tool-adapter.js";

const deps = (callTool: (n: string, a: unknown) => Promise<McpToolCallResult>) => ({
  serverName: "files",
  callTool,
});

describe("resolveParameterSchema — schema 透传与兜底(Req 3.1)", () => {
  it("合法 object schema 原样透传", () => {
    const schema = { type: "object", properties: { path: { type: "string" } }, required: ["path"] };
    expect(resolveParameterSchema(schema)).toEqual(schema);
  });

  it("缺失 / 非对象 / 非 object 类型 → 兜底为宽松 object schema(坏工具不毒化同 server 其余工具)", () => {
    for (const bad of [undefined, null, 42, "x", [], { type: "string" }]) {
      const r = resolveParameterSchema(bad) as unknown as Record<string, unknown>;
      // 变异判据:若去掉兜底直接透传,这里会得到非 object schema → 转红。
      expect(r["type"]).toBe("object");
      expect(r["additionalProperties"]).toBe(true);
    }
  });
});

describe("composeToolName — 同名工具可区分(Req 3.4)", () => {
  it("加 server 前缀", () => {
    expect(composeToolName("files", "read")).toBe("files__read");
    // 不同 server 的同名工具不再冲突
    expect(composeToolName("db", "read")).not.toBe(composeToolName("files", "read"));
  });
});

describe("adaptMcpTool — 适配与执行(Req 3.1, 3.3, 3.5)", () => {
  it("注册名带前缀,描述缺失时有兜底描述", () => {
    const tool = adaptMcpTool({ name: "read" }, deps(async () => ({})));
    expect(tool.name).toBe("files__read");
    expect(tool.description.length).toBeGreaterThan(0);
  });

  it("适配过程不发起任何调用(纯函数)", () => {
    const callTool = vi.fn(async () => ({}));
    adaptMcpTool({ name: "read" }, deps(callTool));
    expect(callTool).not.toHaveBeenCalled();
  });

  it("成功调用:text 与 image 内容映射回流(Req 3.3)", async () => {
    const tool = adaptMcpTool(
      { name: "read" },
      deps(async () => ({
        content: [
          { type: "text", text: "hello" },
          { type: "image", data: "AAA", mimeType: "image/png" },
        ],
      })),
    );
    const r = await tool.execute("call-1", {}, undefined, undefined, {} as never);
    expect(r.content).toEqual([
      { type: "text", text: "hello" },
      { type: "image", data: "AAA", mimeType: "image/png" },
    ]);
  });

  it("无法直接表达的内容类型降级为文本,不丢信息", async () => {
    const tool = adaptMcpTool(
      { name: "read" },
      deps(async () => ({ content: [{ type: "resource", uri: "file:///a" }] })),
    );
    const r = await tool.execute("call-1", {}, undefined, undefined, {} as never);
    expect(r.content[0]).toMatchObject({ type: "text" });
    expect((r.content[0] as { text: string }).text).toContain("file:///a");
  });

  it("调用抛错 → 转为错误结果而非抛出(Req 3.5)", async () => {
    const tool = adaptMcpTool(
      { name: "read" },
      deps(async () => {
        throw new Error("connection reset");
      }),
    );
    // 变异判据:若去掉 try/catch,此处会 reject → 转红。
    const r = await tool.execute("call-1", {}, undefined, undefined, {} as never);
    expect((r.details as { isError: boolean }).isError).toBe(true);
    expect((r.content[0] as { text: string }).text).toContain("connection reset");
  });

  it("server 返回 isError → 转为错误结果并保留其文本", async () => {
    const tool = adaptMcpTool(
      { name: "read" },
      deps(async () => ({ isError: true, content: [{ type: "text", text: "no such file" }] })),
    );
    const r = await tool.execute("call-1", {}, undefined, undefined, {} as never);
    expect((r.details as { isError: boolean }).isError).toBe(true);
    expect((r.content[0] as { text: string }).text).toContain("no such file");
  });

  it("参数与信号透传给底层调用", async () => {
    const callTool = vi.fn(async () => ({}));
    const tool = adaptMcpTool({ name: "read" }, deps(callTool));
    const ac = new AbortController();
    await tool.execute("call-1", { path: "/tmp" }, ac.signal, undefined, {} as never);
    expect(callTool).toHaveBeenCalledWith("read", { path: "/tmp" }, ac.signal);
  });
});
