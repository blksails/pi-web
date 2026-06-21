import { describe, it, expect, vi } from "vitest";
import { createPiClient } from "../../src/client/pi-client.js";
import {
  PiHttpError,
  PiProtocolVersionError,
} from "../../src/client/errors.js";
import { makeJsonResponse } from "../fixtures/sse-samples.js";

interface Captured {
  url: string;
  method: string;
  headers: Headers;
  body: string | undefined;
}

function mockFetch(
  response: Response,
): { fetch: typeof fetch; calls: Captured[] } {
  const calls: Captured[] = [];
  const f = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const headers = new Headers(init?.headers);
    calls.push({
      url: String(input),
      method: init?.method ?? "GET",
      headers,
      body: typeof init?.body === "string" ? init.body : undefined,
    });
    return response.clone();
  });
  return { fetch: f as unknown as typeof fetch, calls };
}

describe("createPiClient request shaping", () => {
  it("createSession POSTs CreateSessionRequest to /sessions and returns sessionId", async () => {
    const { fetch, calls } = mockFetch(
      makeJsonResponse({ sessionId: "s-1" }),
    );
    const client = createPiClient("http://api.test", fetch);
    const res = await client.createSession({ source: "claude", cwd: "/tmp" });
    expect(res.sessionId).toBe("s-1");
    expect(calls[0]?.url).toBe("http://api.test/sessions");
    expect(calls[0]?.method).toBe("POST");
    expect(JSON.parse(calls[0]?.body ?? "{}")).toEqual({
      source: "claude",
      cwd: "/tmp",
    });
    expect(calls[0]?.headers.get("content-type")).toBe("application/json");
  });

  it("prompt POSTs to /sessions/:id/messages", async () => {
    const { fetch, calls } = mockFetch(makeJsonResponse({ ok: true }));
    const client = createPiClient("http://api.test/", fetch);
    await client.prompt("s 1", { message: "hi" });
    expect(calls[0]?.url).toBe("http://api.test/sessions/s%201/messages");
    expect(JSON.parse(calls[0]?.body ?? "{}")).toEqual({ message: "hi" });
  });

  it("prompt serializes attachmentIds into the JSON body", async () => {
    const { fetch, calls } = mockFetch(makeJsonResponse({ ok: true }));
    const client = createPiClient("http://api.test", fetch);
    await client.prompt("s1", {
      message: "see file",
      attachmentIds: ["att_a", "att_b"],
    });
    expect(JSON.parse(calls[0]?.body ?? "{}")).toEqual({
      message: "see file",
      attachmentIds: ["att_a", "att_b"],
    });
  });

  it("steer / followUp hit distinct endpoints", async () => {
    const { fetch, calls } = mockFetch(makeJsonResponse({ ok: true }));
    const client = createPiClient("http://api.test", fetch);
    await client.steer("s1", { message: "left" });
    await client.followUp("s1", { message: "next" });
    expect(calls[0]?.url).toBe("http://api.test/sessions/s1/steer");
    expect(calls[1]?.url).toBe("http://api.test/sessions/s1/follow_up");
  });

  it("abort POSTs with no body", async () => {
    const { fetch, calls } = mockFetch(makeJsonResponse({ ok: true }));
    const client = createPiClient("http://api.test", fetch);
    await client.abort("s1");
    expect(calls[0]?.url).toBe("http://api.test/sessions/s1/abort");
    expect(calls[0]?.method).toBe("POST");
    expect(calls[0]?.body).toBeUndefined();
  });

  it("setModel / setThinking / uiResponse shape bodies", async () => {
    const { fetch, calls } = mockFetch(makeJsonResponse({ ok: true }));
    const client = createPiClient("http://api.test", fetch);
    await client.setModel("s1", { provider: "anthropic", modelId: "x" });
    await client.setThinking("s1", { level: "high" });
    await client.uiResponse("s1", {
      type: "extension_ui_response",
      id: "u1",
      confirmed: true,
    });
    expect(calls[0]?.url).toBe("http://api.test/sessions/s1/model");
    expect(JSON.parse(calls[0]?.body ?? "{}")).toEqual({
      provider: "anthropic",
      modelId: "x",
    });
    expect(calls[1]?.url).toBe("http://api.test/sessions/s1/thinking");
    expect(JSON.parse(calls[1]?.body ?? "{}")).toEqual({ level: "high" });
    expect(calls[2]?.url).toBe("http://api.test/sessions/s1/ui-response");
  });

  it("query methods use GET on correct paths", async () => {
    const { fetch, calls } = mockFetch(
      makeJsonResponse({ stats: {}, state: {}, messages: [], commands: [] }),
    );
    const client = createPiClient("http://api.test", fetch);
    await client.getState("s1");
    await client.getStats("s1");
    await client.getMessages("s1");
    await client.getCommands("s1");
    expect(calls.map((c) => `${c.method} ${c.url}`)).toEqual([
      "GET http://api.test/sessions/s1/state",
      "GET http://api.test/sessions/s1/stats",
      "GET http://api.test/sessions/s1/messages",
      "GET http://api.test/sessions/s1/commands",
    ]);
  });

  it("deleteSession uses DELETE", async () => {
    const { fetch, calls } = mockFetch(makeJsonResponse({ ok: true }));
    const client = createPiClient("http://api.test", fetch);
    await client.deleteSession("s1");
    expect(calls[0]?.method).toBe("DELETE");
    expect(calls[0]?.url).toBe("http://api.test/sessions/s1");
  });

  it("uses the injected fetch, not global fetch", async () => {
    const { fetch, calls } = mockFetch(makeJsonResponse({ sessionId: "s" }));
    const globalSpy = vi.spyOn(globalThis, "fetch");
    const client = createPiClient("http://api.test", fetch);
    await client.createSession({ source: "x" });
    expect(calls).toHaveLength(1);
    expect(globalSpy).not.toHaveBeenCalled();
    globalSpy.mockRestore();
  });

  it("non-2xx → PiHttpError with status and protocol error body", async () => {
    const { fetch } = mockFetch(
      makeJsonResponse({ code: "E_BAD", message: "nope" }, 422),
    );
    const client = createPiClient("http://api.test", fetch);
    await expect(client.createSession({ source: "x" })).rejects.toMatchObject({
      status: 422,
      code: "E_BAD",
    });
    await expect(
      client.createSession({ source: "x" }),
    ).rejects.toBeInstanceOf(PiHttpError);
  });

  it("incompatible protocolVersion in response → PiProtocolVersionError", async () => {
    const { fetch } = mockFetch(
      makeJsonResponse({ sessionId: "s", protocolVersion: "9.0.0" }),
    );
    const client = createPiClient("http://api.test", fetch);
    await expect(client.createSession({ source: "x" })).rejects.toBeInstanceOf(
      PiProtocolVersionError,
    );
  });
});

/** 一个通过 ModelSchema 的最小合法 Model(字段取自 protocol rpc/model)。 */
const sampleModel = {
  id: "claude-x",
  name: "Claude X",
  api: "anthropic",
  provider: "anthropic",
  baseUrl: "https://api.anthropic.com",
  reasoning: true,
  input: ["text"],
  cost: { input: 1, output: 2, cacheRead: 0, cacheWrite: 0 },
  contextWindow: 200000,
  maxTokens: 8192,
};

describe("createPiClient three-capability REST methods", () => {
  it("getAvailableModels GETs /sessions/:id/models and parses via schema", async () => {
    const { fetch, calls } = mockFetch(
      makeJsonResponse({ models: [sampleModel] }),
    );
    const client = createPiClient("http://api.test", fetch);
    const res = await client.getAvailableModels("s 1");
    expect(calls[0]?.method).toBe("GET");
    expect(calls[0]?.url).toBe("http://api.test/sessions/s%201/models");
    expect(calls[0]?.body).toBeUndefined();
    expect(res.models).toHaveLength(1);
    expect(res.models[0]?.id).toBe("claude-x");
  });

  it("fork POSTs ForkRequest to /sessions/:id/fork and parses via schema", async () => {
    const { fetch, calls } = mockFetch(
      makeJsonResponse({ text: "forked", cancelled: false }),
    );
    const client = createPiClient("http://api.test", fetch);
    const res = await client.fork("s1", { entryId: "e1" });
    expect(calls[0]?.method).toBe("POST");
    expect(calls[0]?.url).toBe("http://api.test/sessions/s1/fork");
    expect(JSON.parse(calls[0]?.body ?? "{}")).toEqual({ entryId: "e1" });
    expect(calls[0]?.headers.get("content-type")).toBe("application/json");
    expect(res).toEqual({ text: "forked", cancelled: false });
  });

  it("getForkMessages GETs /sessions/:id/fork-messages and parses via schema", async () => {
    const { fetch, calls } = mockFetch(
      makeJsonResponse({ messages: [{ entryId: "e1", text: "hi" }] }),
    );
    const client = createPiClient("http://api.test", fetch);
    const res = await client.getForkMessages("s1");
    expect(calls[0]?.method).toBe("GET");
    expect(calls[0]?.url).toBe("http://api.test/sessions/s1/fork-messages");
    expect(calls[0]?.body).toBeUndefined();
    expect(res.messages).toEqual([{ entryId: "e1", text: "hi" }]);
  });

  it("404 on any of the three endpoints throws an identifiable PiHttpError (status 404)", async () => {
    const make404 = () =>
      createPiClient("http://api.test", mockFetch(makeJsonResponse({}, 404)).fetch);

    await expect(make404().getAvailableModels("s1")).rejects.toBeInstanceOf(
      PiHttpError,
    );
    await expect(make404().getAvailableModels("s1")).rejects.toMatchObject({
      status: 404,
    });
    await expect(
      make404().fork("s1", { entryId: "e1" }),
    ).rejects.toMatchObject({ status: 404 });
    await expect(make404().getForkMessages("s1")).rejects.toMatchObject({
      status: 404,
    });
  });

  it("rejects when response payload violates the protocol schema", async () => {
    const { fetch } = mockFetch(
      makeJsonResponse({ models: [{ id: 123 }] }),
    );
    const client = createPiClient("http://api.test", fetch);
    await expect(client.getAvailableModels("s1")).rejects.toThrow();
  });
});
