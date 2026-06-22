import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { runEndpoint } from "../../src/engine/endpoint-adapter.js";
import type { EndpointBehavior, PickedResult } from "../../src/engine/types.js";

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
