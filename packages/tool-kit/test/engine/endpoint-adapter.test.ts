import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { runEndpoint } from "../../src/engine/endpoint-adapter.js";
import type { EndpointBehavior, PickedResult } from "../../src/engine/endpoint-types.js";

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeJsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

const IMAGE_SET_RESULT: PickedResult = {
  kind: "image-set",
  urls: ["https://example.com/a.png", "https://example.com/b.png"],
};

/** Minimal sync behavior with injected fetch. */
function syncBehavior(
  fetchImpl: typeof fetch,
  extra?: Partial<EndpointBehavior>,
): EndpointBehavior {
  return {
    url: "https://api.example.com/generate",
    buildBody: (args) => ({ prompt: args["prompt"] }),
    pickResult: () => IMAGE_SET_RESULT,
    ...extra,
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("runEndpoint — sync", () => {
  it("returns PickedResult on success", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(makeJsonResponse({ ok: true }));
    const behavior = syncBehavior(fetchImpl);
    const result = await runEndpoint(behavior, { prompt: "a cat" }, { fetchImpl });
    expect(result).toEqual(IMAGE_SET_RESULT);
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it("throws when detectError fires", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      makeJsonResponse({ code: "ERROR", message: "quota exceeded" }),
    );
    const behavior: EndpointBehavior = {
      ...syncBehavior(fetchImpl),
      detectError: (r) => {
        const resp = r as { code?: string; message?: string };
        return resp.code === "ERROR" ? (resp.message ?? "error") : undefined;
      },
    };
    await expect(runEndpoint(behavior, {}, { fetchImpl })).rejects.toThrow("quota exceeded");
  });

  it("throws on non-200 upstream response", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response("Unauthorized", { status: 401 }),
    );
    const behavior = syncBehavior(fetchImpl);
    await expect(runEndpoint(behavior, {}, { fetchImpl })).rejects.toThrow("401");
  });

  it("throws on empty body with diagnostic message", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response("", { status: 200, headers: { "content-type": "application/json" } }),
    );
    const behavior = syncBehavior(fetchImpl);
    await expect(runEndpoint(behavior, {}, { fetchImpl })).rejects.toThrow(/empty body/);
  });
});

describe("runEndpoint — streaming (OpenAI-chat SSE)", () => {
  // openrouter 形态 pickResult:choices[].message.images[].image_url.url。
  const orPick = (r: unknown): PickedResult => {
    const urls: string[] = [];
    for (const c of (r as { choices?: { message?: { images?: { image_url?: { url?: string } }[] } }[] }).choices ?? []) {
      for (const img of c.message?.images ?? []) if (img.image_url?.url) urls.push(img.image_url.url);
    }
    if (urls.length === 0) return { kind: "raw", value: r };
    if (urls.length === 1) return { kind: "image", url: urls[0] as string };
    return { kind: "image-set", urls };
  };

  function sseResponse(chunks: string[]): Response {
    const enc = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      start(c) { for (const x of chunks) c.enqueue(enc.encode(x)); c.close(); },
    });
    return new Response(stream, { headers: { "content-type": "text/event-stream" } });
  }

  const streamBehavior = (fetchImpl: typeof fetch): EndpointBehavior => ({
    url: "https://openrouter.ai/api/v1/chat/completions",
    stream: true,
    buildBody: (args) => ({ model: "m", messages: [{ role: "user", content: args["prompt"] }] }),
    pickResult: orPick,
    detectError: (r) => (r as { error?: { message?: string } }).error?.message,
  });

  it("发 stream:true,逐帧上报 reasoning/图,返回最终 image PickedResult", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(sseResponse([
      'data: {"choices":[{"delta":{"reasoning":"plan"}}]}\n\n',
      'data: {"choices":[{"delta":{"images":[{"image_url":{"url":"data:image/png;base64,ZZ"}}]}}]}\n\n',
      "data: [DONE]\n\n",
    ]));
    const events: string[] = [];
    const result = await runEndpoint(streamBehavior(fetchImpl), { prompt: "cat" }, {
      fetchImpl,
      onStream: (ev) => events.push(ev.kind),
    });
    // 请求体确实带了 stream:true。
    const body = JSON.parse((fetchImpl.mock.calls[0]?.[1] as RequestInit).body as string);
    expect(body.stream).toBe(true);
    expect(events).toContain("reasoning");
    expect(events).toContain("image");
    expect(result).toEqual({ kind: "image", url: "data:image/png;base64,ZZ" });
  });

  it("网关忽略 stream 返回整包 JSON → 回退同步解析", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ choices: [{ message: { images: [{ image_url: { url: "u1" } }] } }] }), {
        status: 200, headers: { "content-type": "application/json" },
      }),
    );
    const result = await runEndpoint(streamBehavior(fetchImpl), { prompt: "cat" }, { fetchImpl });
    expect(result).toEqual({ kind: "image", url: "u1" });
  });

  it("流内 error 帧 → 抛出可读错误", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(sseResponse([
      'data: {"error":{"code":429,"message":"rate limited"}}\n\n',
      "data: [DONE]\n\n",
    ]));
    await expect(
      runEndpoint(streamBehavior(fetchImpl), { prompt: "cat" }, { fetchImpl }),
    ).rejects.toThrow("rate limited");
  });

  it("streamKind=images:逐张 partial 早弹 + completed 作最终图(由糊变清)", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(sseResponse([
      'data: {"type":"image_generation.partial_image","partial_image_index":0,"b64_json":"AA"}\n\n',
      'data: {"type":"image_generation.partial_image","partial_image_index":1,"b64_json":"BB"}\n\n',
      'data: {"type":"image_generation.completed","b64_json":"CC"}\n\n',
      "data: [DONE]\n\n",
    ]));
    const imgEvents: string[] = [];
    const behavior: EndpointBehavior = {
      url: "https://openrouter.ai/api/v1/images",
      stream: true,
      streamKind: "images",
      buildBody: (a) => ({ model: "m", prompt: a["prompt"] }),
      pickResult: () => ({ kind: "raw", value: null }), // images 分支不经此
    };
    const result = await runEndpoint(behavior, { prompt: "cat" }, {
      fetchImpl,
      onStream: (ev) => { if (ev.kind === "image" && ev.picked.kind === "image") imgEvents.push(ev.picked.url); },
    });
    // 请求体带 stream:true。
    expect(JSON.parse((fetchImpl.mock.calls[0]?.[1] as RequestInit).body as string).stream).toBe(true);
    // 3 次 image 事件:2 partial(渐进)+ 1 completed。
    expect(imgEvents).toEqual([
      "data:image/png;base64,AA",
      "data:image/png;base64,BB",
      "data:image/png;base64,CC",
    ]);
    // 最终返回 completed 图。
    expect(result).toEqual({ kind: "image", url: "data:image/png;base64,CC" });
  });
});

describe("runEndpoint — async polling", () => {
  it("polls until SUCCEEDED and returns result", async () => {
    const pendingResp = makeJsonResponse({ status: "PENDING" });
    const succeededResp = makeJsonResponse({ status: "SUCCEEDED" });
    const finalResp = makeJsonResponse({ result: "ok" });

    // Call sequence: submit → status(PENDING) → status(SUCCEEDED) → response
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(makeJsonResponse({ task_id: "t1" })) // submit
      .mockResolvedValueOnce(pendingResp)                          // poll 1
      .mockResolvedValueOnce(succeededResp)                        // poll 2
      .mockResolvedValueOnce(finalResp);                           // response fetch

    const behavior: EndpointBehavior = {
      url: "https://api.example.com/submit",
      buildBody: () => ({}),
      pickResult: () => IMAGE_SET_RESULT,
      async: {
        statusUrl: () => "https://api.example.com/status/t1",
        responseUrl: () => "https://api.example.com/result/t1",
        pollMs: 1,  // fast poll for tests
      },
    };

    const result = await runEndpoint(behavior, {}, { fetchImpl });
    expect(result).toEqual(IMAGE_SET_RESULT);
    expect(fetchImpl).toHaveBeenCalledTimes(4);
  });

  it("throws on timeout", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(makeJsonResponse({ task_id: "t2" }))  // submit
      .mockResolvedValue(makeJsonResponse({ status: "PENDING" })); // always pending

    const behavior: EndpointBehavior = {
      url: "https://api.example.com/submit",
      buildBody: () => ({}),
      pickResult: () => IMAGE_SET_RESULT,
      async: {
        statusUrl: () => "https://api.example.com/status/t2",
        responseUrl: () => "https://api.example.com/result/t2",
        pollMs: 1,
        timeoutMs: 5, // tiny timeout
      },
    };

    await expect(runEndpoint(behavior, {}, { fetchImpl })).rejects.toThrow(/timed out/);
  });

  it("throws AbortError when signal fires", async () => {
    const controller = new AbortController();

    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(makeJsonResponse({ task_id: "t3" })) // submit
      .mockImplementation(async () => {
        // Simulate slow poll — abort before it resolves.
        await new Promise((r) => setTimeout(r, 50));
        return makeJsonResponse({ status: "PENDING" });
      });

    const behavior: EndpointBehavior = {
      url: "https://api.example.com/submit",
      buildBody: () => ({}),
      pickResult: () => IMAGE_SET_RESULT,
      async: {
        statusUrl: () => "https://api.example.com/status/t3",
        responseUrl: () => "https://api.example.com/result/t3",
        pollMs: 10,
        timeoutMs: 60_000,
      },
    };

    // Abort after a short delay.
    setTimeout(() => controller.abort(), 20);

    await expect(
      runEndpoint(behavior, {}, { fetchImpl, signal: controller.signal }),
    ).rejects.toThrow(/abort/i);
  });

  it("throws when isFailed fires", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(makeJsonResponse({ task_id: "t4" }))           // submit
      .mockResolvedValue(makeJsonResponse({ status: "FAILED", error: "out of quota" })); // status

    const behavior: EndpointBehavior = {
      url: "https://api.example.com/submit",
      buildBody: () => ({}),
      pickResult: () => IMAGE_SET_RESULT,
      detectError: (r) => {
        const resp = r as { status?: string; error?: string };
        return resp.status === "FAILED" ? (resp.error ?? "failed") : undefined;
      },
      async: {
        statusUrl: () => "https://api.example.com/status/t4",
        responseUrl: () => "https://api.example.com/result/t4",
        isFailed: (r) => (r as { status?: string }).status === "FAILED",
        pollMs: 1,
        timeoutMs: 30_000,
      },
    };

    await expect(runEndpoint(behavior, {}, { fetchImpl })).rejects.toThrow("out of quota");
  });
});

describe("runEndpoint — runLocal", () => {
  it("delegates to runLocal when present", async () => {
    const localResult: PickedResult = { kind: "image", url: "local://out.png" };
    const behavior: EndpointBehavior = {
      runLocal: async () => localResult,
    };
    const result = await runEndpoint(behavior, {});
    expect(result).toEqual(localResult);
  });
});
