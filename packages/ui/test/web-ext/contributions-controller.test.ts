import { describe, it, expect, vi } from "vitest";
import { createContributionsController } from "../../src/web-ext/contributions-controller.js";
import type { WebExtension, UiRpcClient } from "@pi-web/web-kit";

const rpc: UiRpcClient = {
  request: vi.fn(async () => ({ correlationId: "x", ok: true, result: [] })),
};

describe("createContributionsController", () => {
  it("能力标志反映扩展声明", () => {
    const ext: WebExtension = {
      manifestId: "x",
      contributions: {
        slash: { list: async () => [] },
        mention: { trigger: "#", query: async () => [] },
      },
    };
    const ctl = createContributionsController(ext, rpc);
    expect(ctl.hasSlash).toBe(true);
    expect(ctl.hasMention).toBe(true);
    expect(ctl.hasAutocomplete).toBe(false);
    expect(ctl.mentionTrigger).toBe("#");
  });

  it("listSlash 调用扩展 provider 并透传 rpc", async () => {
    const list = vi.fn(async (_q: string, _r: UiRpcClient) => [
      { id: "a", title: "Alpha" },
    ]);
    const ext: WebExtension = { manifestId: "x", contributions: { slash: { list } } };
    const ctl = createContributionsController(ext, rpc);
    const items = await ctl.listSlash("/al");
    expect(items).toEqual([{ id: "a", title: "Alpha" }]);
    expect(list).toHaveBeenCalledWith("/al", rpc);
  });

  it("provider 抛错被收敛为空结果(不抛)", async () => {
    const ext: WebExtension = {
      manifestId: "x",
      contributions: {
        slash: { list: async () => { throw new Error("boom"); } },
        inlineComplete: { complete: async () => { throw new Error("boom"); } },
      },
    };
    const ctl = createContributionsController(ext, rpc);
    expect(await ctl.listSlash("x")).toEqual([]);
    expect(await ctl.inlineComplete("x")).toBeUndefined();
  });

  it("无 contributions 时方法返回安全空", async () => {
    const ctl = createContributionsController({ manifestId: "x" }, rpc);
    expect(ctl.hasSlash).toBe(false);
    expect(await ctl.listSlash("x")).toEqual([]);
    expect(await ctl.queryMentions("x")).toEqual([]);
    expect(ctl.mentionTrigger).toBe("@");
  });
});
