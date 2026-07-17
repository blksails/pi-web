import { describe, expect, it, vi } from "vitest";
import { WecomGatewayClient } from "../src/client.js";

describe("WecomGatewayClient", () => {
  it("POST /api/outbound with sessionId", async () => {
    const fetchImpl = vi.fn(async (input: string | URL, init?: RequestInit) => {
      expect(String(input)).toBe("http://127.0.0.1:7930/api/outbound");
      expect(init?.method).toBe("POST");
      const body = JSON.parse(String(init?.body));
      expect(body.sessionId).toBe("s1");
      expect(body.text).toBe("hello");
      return new Response(
        JSON.stringify({
          ok: true,
          deliveryUsed: "active",
          channelId: "wecom",
          threadId: "u1",
          sessionId: "s1",
        }),
        { status: 200 },
      );
    });
    const client = new WecomGatewayClient(
      { baseUrl: "http://127.0.0.1:7930", defaultChannelId: "wecom" },
      fetchImpl as unknown as typeof fetch,
    );
    const r = await client.outbound({ sessionId: "s1", text: "hello", delivery: "active" });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.threadId).toBe("u1");
  });

  it("GET binding 404 → null", async () => {
    const fetchImpl = vi.fn(async () => new Response("no", { status: 404 }));
    const client = new WecomGatewayClient(
      { baseUrl: "http://127.0.0.1:7930", defaultChannelId: "wecom" },
      fetchImpl as unknown as typeof fetch,
    );
    expect(await client.getBinding("missing")).toBeNull();
  });

  it("health parses JSON", async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(JSON.stringify({ status: "ok", channels: [{ id: "wecom", transport: "live" }] }), {
        status: 200,
      }),
    );
    const client = new WecomGatewayClient(
      { baseUrl: "http://gw", defaultChannelId: "wecom" },
      fetchImpl as unknown as typeof fetch,
    );
    const h = await client.health();
    expect(h.status).toBe("ok");
    expect(h.channels?.[0]?.id).toBe("wecom");
  });

  it("adminWhoami parses role", async () => {
    const fetchImpl = vi.fn(async (input: string | URL) => {
      expect(String(input)).toContain("/api/admin/whoami?sessionId=s1");
      return new Response(
        JSON.stringify({
          ok: true,
          userId: "alice",
          channelType: "wecom",
          role: "admin",
        }),
        { status: 200 },
      );
    });
    const client = new WecomGatewayClient(
      { baseUrl: "http://127.0.0.1:7930", defaultChannelId: "wecom" },
      fetchImpl as unknown as typeof fetch,
    );
    const r = await client.adminWhoami("s1");
    expect("role" in r && r.role).toBe("admin");
  });

  it("adminList surfaces NOT_ADMIN", async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(JSON.stringify({ ok: false, code: "NOT_ADMIN", message: "admin role required" }), {
        status: 403,
      }),
    );
    const client = new WecomGatewayClient(
      { baseUrl: "http://gw", defaultChannelId: "wecom" },
      fetchImpl as unknown as typeof fetch,
    );
    const r = await client.adminList("sess-user");
    expect((r as { code?: string }).code).toBe("NOT_ADMIN");
  });
});
