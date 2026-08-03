import { describe, it, expect, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useModels } from "../../src/hooks/use-models.js";
import type { PiClient } from "../../src/client/pi-client.js";
import type { Model, SessionSnapshot } from "@blksails/pi-web-protocol";

function model(provider: string, id: string, name: string): Model {
  return {
    id,
    name,
    api: "anthropic",
    provider,
    baseUrl: "http://x",
    reasoning: false,
    input: ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 1000,
    maxTokens: 100,
  };
}

function makeClient(
  overrides: Partial<PiClient> = {},
): PiClient {
  return {
    baseUrl: "http://api.test",
    getAvailableModels: vi.fn(async () => ({
      models: [
        model("anthropic", "claude", "Claude"),
        model("openai", "gpt", "GPT"),
        model("anthropic", "claude-2", "Claude 2"),
      ],
    })),
    setModel: vi.fn(async () => ({ ok: true }) as never),
    ...overrides,
  } as unknown as PiClient;
}

/** 构造带 session 快照的 controls 桩,`model` 字段承载 pi SDK Model 形状。 */
function controlsWithSessionModel(
  sessionModel: unknown,
): Parameters<typeof useModels>[0]["controls"] {
  const session = {
    lifecycle: "ready",
    busy: false,
    model: sessionModel,
  } as unknown as SessionSnapshot;
  return {
    setModel: vi.fn(async () => undefined),
    session,
  } as unknown as Parameters<typeof useModels>[0]["controls"];
}

describe("useModels", () => {
  it("does not load until ensureLoaded is called (lazy)", () => {
    const client = makeClient();
    const { result } = renderHook(() =>
      useModels({ sessionId: "s1", client }),
    );
    expect(client.getAvailableModels).not.toHaveBeenCalled();
    expect(result.current.groups).toEqual([]);
    expect(result.current.available).toBe(false);
  });

  it("ensureLoaded fetches and groups models by provider", async () => {
    const client = makeClient();
    const { result } = renderHook(() =>
      useModels({ sessionId: "s1", client }),
    );
    await act(async () => {
      await result.current.ensureLoaded();
    });
    expect(client.getAvailableModels).toHaveBeenCalledTimes(1);
    expect(client.getAvailableModels).toHaveBeenCalledWith("s1");
    expect(result.current.available).toBe(true);
    const providers = result.current.groups.map((g) => g.provider).sort();
    expect(providers).toEqual(["anthropic", "openai"]);
    const anthropic = result.current.groups.find(
      (g) => g.provider === "anthropic",
    );
    expect(anthropic?.models.map((m) => m.modelId)).toEqual([
      "claude",
      "claude-2",
    ]);
    expect(anthropic?.models[0]).toEqual({
      provider: "anthropic",
      modelId: "claude",
      label: "Claude",
    });
  });

  it("ensureLoaded only fetches once (caches)", async () => {
    const client = makeClient();
    const { result } = renderHook(() =>
      useModels({ sessionId: "s1", client }),
    );
    await act(async () => {
      await result.current.ensureLoaded();
      await result.current.ensureLoaded();
    });
    expect(client.getAvailableModels).toHaveBeenCalledTimes(1);
  });

  it("select calls setModel and updates current", async () => {
    const client = makeClient();
    const { result } = renderHook(() =>
      useModels({ sessionId: "s1", client }),
    );
    await act(async () => {
      await result.current.ensureLoaded();
    });
    await act(async () => {
      await result.current.select("openai", "gpt");
    });
    expect(client.setModel).toHaveBeenCalledWith("s1", {
      provider: "openai",
      modelId: "gpt",
    });
    expect(result.current.current).toEqual({
      provider: "openai",
      modelId: "gpt",
    });
  });

  it("prefers controls.setModel when provided", async () => {
    const client = makeClient();
    const controlsSetModel = vi.fn(async () => undefined);
    const controls = {
      setModel: controlsSetModel,
    } as unknown as Parameters<typeof useModels>[0]["controls"];
    const { result } = renderHook(() =>
      useModels({ sessionId: "s1", client, controls }),
    );
    await act(async () => {
      await result.current.select("openai", "gpt");
    });
    expect(controlsSetModel).toHaveBeenCalledWith({
      provider: "openai",
      modelId: "gpt",
    });
    expect(client.setModel).not.toHaveBeenCalled();
  });

  it("empty model list degrades to available=false", async () => {
    const client = makeClient({
      getAvailableModels: vi.fn(async () => ({ models: [] })),
    });
    const { result } = renderHook(() =>
      useModels({ sessionId: "s1", client }),
    );
    await act(async () => {
      await result.current.ensureLoaded();
    });
    expect(result.current.available).toBe(false);
    expect(result.current.groups).toEqual([]);
  });

  it("error degrades to available=false and exposes error", async () => {
    const err = new Error("404");
    const client = makeClient({
      getAvailableModels: vi.fn(async () => {
        throw err;
      }),
    });
    const { result } = renderHook(() =>
      useModels({ sessionId: "s1", client }),
    );
    await act(async () => {
      await result.current.ensureLoaded();
    });
    expect(result.current.available).toBe(false);
    expect(result.current.error).toBe(err);
    expect(result.current.groups).toEqual([]);
  });

  it("derives current from session snapshot on initial render without select() (Req 11.8)", () => {
    const client = makeClient();
    const controls = controlsWithSessionModel(
      model("anthropic", "claude-2", "Claude 2"),
    );
    const { result } = renderHook(() =>
      useModels({ sessionId: "s1", client, controls }),
    );
    // 从未调用 select(),也从未 ensureLoaded():current 须仍由会话快照派生,
    // 印证「刷新页面后仍显示选中态」(不只是记本地 state)。
    expect(result.current.current).toEqual({
      provider: "anthropic",
      modelId: "claude-2",
    });
  });

  it("keeps session-derived current identifiable even when absent from groups (Req 11.9)", async () => {
    const client = makeClient();
    const controls = controlsWithSessionModel(
      model("retired-provider", "retired-model", "Retired"),
    );
    const { result } = renderHook(() =>
      useModels({ sessionId: "s1", client, controls }),
    );
    await act(async () => {
      await result.current.ensureLoaded();
    });
    // groups 里没有 retired-provider(fixture 只有 anthropic/openai),
    // 但 current 不得静默消失——仍须原样透出以供 UI 标记。
    const providers = result.current.groups.map((g) => g.provider);
    expect(providers).not.toContain("retired-provider");
    expect(result.current.current).toEqual({
      provider: "retired-provider",
      modelId: "retired-model",
    });
  });

  it("current follows session snapshot across updates rather than sticking to a prior value (Req 11.8)", () => {
    const client = makeClient();
    const { result, rerender } = renderHook(
      (props: { sessionModel: unknown }) =>
        useModels({
          sessionId: "s1",
          client,
          controls: controlsWithSessionModel(props.sessionModel),
        }),
      {
        initialProps: {
          sessionModel: model("anthropic", "claude", "Claude"),
        },
      },
    );
    expect(result.current.current).toEqual({
      provider: "anthropic",
      modelId: "claude",
    });
    // 会话快照更新(如另一端触发 set_model)后,派生值须跟随快照而非停留在旧值。
    rerender({ sessionModel: model("openai", "gpt", "GPT") });
    expect(result.current.current).toEqual({
      provider: "openai",
      modelId: "gpt",
    });
  });
});
