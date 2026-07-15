import { describe, expect, it, vi } from "vitest";
import { WecomGatewayClient } from "../src/client.js";

/**
 * Drive real client.outbound with file/menu shapes tools produce.
 */
describe("wecom extension outbound shapes", () => {
  it("wecom_send_file intent shape hits gateway", async () => {
    const fetchImpl = vi.fn(async (_url: string | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      expect(body.kind).toBe("file");
      expect(body.file.filename).toBe("r.txt");
      expect(body.file.base64).toBeTruthy();
      expect(body.delivery).toBe("active");
      expect(body.sessionId).toBe("sess-1");
      return new Response(
        JSON.stringify({
          ok: true,
          deliveryUsed: "active",
          channelId: "wecom",
          threadId: "u1",
          kind: "file",
        }),
        { status: 200 },
      );
    });
    const client = new WecomGatewayClient(
      { baseUrl: "http://127.0.0.1:7930", defaultChannelId: "wecom" },
      fetchImpl as unknown as typeof fetch,
    );
    const r = await client.outbound({
      sessionId: "sess-1",
      kind: "file",
      file: {
        filename: "r.txt",
        base64: Buffer.from("x").toString("base64"),
        mediaType: "file",
      },
      text: "caption",
      delivery: "active",
      cause: "tool:wecom_send_file",
    });
    expect(r.ok).toBe(true);
  });

  it("wecom_send_menu intent includes card_action type 1 + url", async () => {
    const fetchImpl = vi.fn(async (_url: string | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      expect(body.kind).toBe("template_card");
      expect(body.templateCard.card_type).toBe("button_interaction");
      expect(body.templateCard.card_action).toEqual({
        type: 1,
        url: "https://work.weixin.qq.com/",
      });
      expect(body.templateCard.button_list).toHaveLength(2);
      expect(body.templateCard.task_id).toBeTruthy();
      return new Response(
        JSON.stringify({
          ok: true,
          deliveryUsed: "active",
          channelId: "wecom",
          threadId: "u1",
          kind: "template_card",
        }),
        { status: 200 },
      );
    });
    const client = new WecomGatewayClient(
      { baseUrl: "http://gw", defaultChannelId: "wecom" },
      fetchImpl as unknown as typeof fetch,
    );
    // Mirror tool-built card (same as wecom-send-menu.ts)
    const templateCard = {
      card_type: "button_interaction",
      main_title: { title: "请选择" },
      button_list: [
        { text: "同意", key: "ok" },
        { text: "拒绝", key: "no" },
      ],
      task_id: "menu_1",
      card_action: { type: 1, url: "https://work.weixin.qq.com/" },
    };
    const r = await client.outbound({
      sessionId: "sess-2",
      kind: "template_card",
      templateCard,
      delivery: "active",
      cause: "tool:wecom_send_menu",
    });
    expect(r.ok).toBe(true);
    expect(fetchImpl).toHaveBeenCalled();
  });
});
