/**
 * AgentDeclarations — agent 装配期声明帧的只读投影(自 PiSession 提出,H1)。
 *
 * 四者共同语义:未声明有**确定缺省**(空数组 / undefined / false),读到缺省即「该能力
 * 未声明」而非错误。存量 agent 不发这些帧,缺省值就是它们的行为契约。
 */
import { describe, it, expect } from "vitest";
import { AgentDeclarations } from "../../src/session/agent-declarations.js";

describe("AgentDeclarations — 未声明的缺省(存量 agent 的行为契约)", () => {
  it("四项缺省分别是 [] / [] / undefined / false", () => {
    const d = new AgentDeclarations();
    expect(d.slashCompletions).toEqual([]);
    expect(d.routes).toEqual([]);
    expect(d.attachmentWriteProfile).toBeUndefined();
    expect(d.attachmentCatalogAvailable).toBe(false);
  });
});

describe("AgentDeclarations — 写入与读取", () => {
  it("slashCompletions 原样回读", () => {
    const d = new AgentDeclarations();
    const items = [{ name: "/foo", description: "d" }] as never;
    d.setSlashCompletions(items);
    expect(d.slashCompletions).toBe(items);
  });

  it("routes 原样回读", () => {
    const d = new AgentDeclarations();
    const routes = [{ name: "r", methods: ["GET"] }] as never;
    d.setRoutes(routes);
    expect(d.routes).toBe(routes);
  });

  it("attachmentWriteProfile 原样回读", () => {
    const d = new AgentDeclarations();
    d.setAttachmentWriteProfile("s3-main");
    expect(d.attachmentWriteProfile).toBe("s3-main");
  });

  it("★catalog 可用性是**单向**的:标记后不可撤回(声明帧一次性)", () => {
    const d = new AgentDeclarations();
    d.markAttachmentCatalogAvailable();
    expect(d.attachmentCatalogAvailable).toBe(true);
    // 无 unmark API —— 若将来需要撤回,应先想清楚「撤回」在协议上意味着什么,
    // 而不是顺手加一个 setter。
    expect((d as unknown as Record<string, unknown>)["unmarkAttachmentCatalog"]).toBeUndefined();
  });

  it("四项互不干扰(写一项不影响其余缺省)", () => {
    const d = new AgentDeclarations();
    d.setAttachmentWriteProfile("p");
    expect(d.slashCompletions).toEqual([]);
    expect(d.routes).toEqual([]);
    expect(d.attachmentCatalogAvailable).toBe(false);
  });
});
