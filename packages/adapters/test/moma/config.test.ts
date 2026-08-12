import { describe, expect, it, vi } from "vitest";
import {
  MOMA_API_KEY_ENV,
  MOMA_BASE_URL_ENV,
  MomaConfigError,
  normalizeMomaBaseUrl,
  resolveMomaConfig,
} from "../../src/moma/config.js";
import {
  MOMA_CHAT_MODEL_ID,
  MOMA_CHAT_MODEL_ENTRY,
  createMomaModelCatalog,
} from "../../src/moma/model-catalog.js";

describe("MOMA URL/config resolution", () => {
  it("accepts an OpenAI root and exposes a bare base plus /v1 API root", () => {
    expect(
      resolveMomaConfig({
        [MOMA_BASE_URL_ENV]: "https://moma.example.com/v1",
        [MOMA_API_KEY_ENV]: "moma-test-key",
      }),
    ).toEqual({
      baseUrl: "https://moma.example.com",
      apiBaseUrl: "https://moma.example.com/v1",
      apiKey: "moma-test-key",
    });
  });

  it("normalizes the full chat completions URL supplied by deployments", () => {
    expect(normalizeMomaBaseUrl("https://moma.example.com/v1/chat/completions")).toEqual({
      baseUrl: "https://moma.example.com",
      apiBaseUrl: "https://moma.example.com/v1",
    });
  });

  it("is disabled when either required variable is absent", () => {
    expect(resolveMomaConfig({ [MOMA_BASE_URL_ENV]: "https://moma.example.com/v1" })).toBeUndefined();
    expect(resolveMomaConfig({ [MOMA_API_KEY_ENV]: "moma-test-key" })).toBeUndefined();
  });

  it("rejects non-HTTP URLs without exposing a key", () => {
    expect(() => normalizeMomaBaseUrl("ftp://moma.example.com/v1")).toThrow(MomaConfigError);
  });
});

describe("MOMA Kimi catalog", () => {
  it("keeps Kimi visible while the remote catalog is refreshing", () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ data: [] }), { status: 200 }));
    const catalog = createMomaModelCatalog(
      {
        baseUrl: "https://moma.example.com",
        apiBaseUrl: "https://moma.example.com/v1",
        apiKey: "moma-test-key",
      },
      { fetchImpl: fetchImpl as unknown as typeof fetch },
    );
    expect(catalog.get()).toEqual([MOMA_CHAT_MODEL_ENTRY]);
  });

  it("uses the real namespaced model id and filters unrelated catalog entries", async () => {
    let authorization: string | null = null;
    const fetchImpl = vi.fn(async (_url, init) => {
      authorization = new Headers((init as RequestInit).headers).get("authorization");
      return new Response(
        JSON.stringify({
          data: [{ id: MOMA_CHAT_MODEL_ID, owned_by: "" }, { id: "other/model", owned_by: "other" }],
        }),
        { status: 200 },
      );
    });
    const catalog = createMomaModelCatalog(
      {
        baseUrl: "https://moma.example.com",
        apiBaseUrl: "https://moma.example.com/v1",
        apiKey: "moma-test-key",
      },
      { fetchImpl: fetchImpl as unknown as typeof fetch },
    );
    await catalog.refresh();
    expect(catalog.get()).toEqual([
      expect.objectContaining({
        model: MOMA_CHAT_MODEL_ID,
        name: "Kimi-K3",
        instanceId: "moma",
        input: ["text"],
        output: ["text"],
      }),
    ]);
    expect(authorization).toBe("Bearer moma-test-key");
    expect(fetchImpl).toHaveBeenCalledWith("https://moma.example.com/v1/models", expect.anything());
  });
});
