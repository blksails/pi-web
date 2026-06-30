/**
 * agent-slash-completion task 3.1:agent-slash 补全 provider。
 * 覆盖 Req 2.1(trigger "/"、前缀过滤、默认 insertText 推导)、Req 4.1/4.2(per-agent gating)。
 */
import { describe, expect, it } from "vitest";
import { createAgentSlashProvider } from "../../src/completion/providers/agent-slash-provider.js";
import type { CompletionCtx } from "../../src/completion/types.js";

const CTX: CompletionCtx = { sessionId: "s1", cwd: "/tmp", userId: "u1" };

const decls = [
  { name: "img-gen", description: "生成图像", insertText: "/img-gen " },
  { name: "img-edit" },
];

const provider = createAgentSlashProvider((id) =>
  id === "s1" ? { getSlashCompletions: () => decls } : undefined,
);

describe("createAgentSlashProvider", () => {
  it("trigger 为 / 且行首提取", () => {
    expect(provider.trigger).toBe("/");
    expect(provider.extract).toBe("lineStart");
  });

  it("空 query 返回全部候选,description 透传 + 默认 insertText 推导", async () => {
    const items = await provider.complete({ query: "", ctx: CTX });
    expect(items.map((i) => i.label)).toEqual(["/img-gen", "/img-edit"]);
    expect(items[0]?.insertText).toBe("/img-gen ");
    expect(items[0]?.detail).toBe("生成图像");
    // img-edit 未声明 insertText → 默认 "/img-edit "
    expect(items[1]?.insertText).toBe("/img-edit ");
    expect(items[1]?.detail).toBeUndefined();
  });

  it("按命令名前缀过滤(query 不含前导 /)", async () => {
    const items = await provider.complete({ query: "img-g", ctx: CTX });
    expect(items.map((i) => i.id)).toEqual(["img-gen"]);
  });

  it("per-agent gating:未声明候选的会话返回空", async () => {
    const items = await provider.complete({
      query: "",
      ctx: { ...CTX, sessionId: "other" },
    });
    expect(items).toEqual([]);
  });
});
