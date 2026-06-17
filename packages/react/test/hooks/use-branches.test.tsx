import { describe, it, expect, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useBranches } from "../../src/hooks/use-branches.js";
import type { PiClient } from "../../src/client/pi-client.js";

function makeClient(overrides: Partial<PiClient> = {}): PiClient {
  return {
    baseUrl: "http://api.test",
    fork: vi.fn(async () => ({ text: "forked" })),
    getForkMessages: vi.fn(async () => ({
      messages: [
        { entryId: "e1", text: "version a" },
        { entryId: "e1", text: "version b" },
      ],
    })),
    ...overrides,
  } as unknown as PiClient;
}

describe("useBranches", () => {
  it("createBranch posts to fork with sessionId and entryId", async () => {
    const client = makeClient();
    const { result } = renderHook(() =>
      useBranches({ sessionId: "s1", client, available: true }),
    );
    await act(async () => {
      await result.current.createBranch("e1");
    });
    expect(client.fork).toHaveBeenCalledWith("s1", { entryId: "e1" });
  });

  it("select loads fork messages and updates branch info (N/M)", async () => {
    const client = makeClient();
    const { result } = renderHook(() =>
      useBranches({ sessionId: "s1", client, available: true }),
    );
    await act(async () => {
      await result.current.select("e1", 1);
    });
    expect(client.getForkMessages).toHaveBeenCalledWith("s1");
    const info = result.current.branchOf("e1");
    expect(info).toEqual({ entryId: "e1", index: 1, total: 2 });
  });

  it("branchOf returns undefined for unknown entry", () => {
    const client = makeClient();
    const { result } = renderHook(() =>
      useBranches({ sessionId: "s1", client, available: true }),
    );
    expect(result.current.branchOf("nope")).toBeUndefined();
  });

  it("available=false makes createBranch a no-op", async () => {
    const client = makeClient();
    const { result } = renderHook(() =>
      useBranches({ sessionId: "s1", client, available: false }),
    );
    await act(async () => {
      await result.current.createBranch("e1");
    });
    expect(client.fork).not.toHaveBeenCalled();
    expect(result.current.available).toBe(false);
  });

  it("available=false makes select a no-op", async () => {
    const client = makeClient();
    const { result } = renderHook(() =>
      useBranches({ sessionId: "s1", client, available: false }),
    );
    await act(async () => {
      await result.current.select("e1", 1);
    });
    expect(client.getForkMessages).not.toHaveBeenCalled();
    expect(result.current.branchOf("e1")).toBeUndefined();
  });

  it("degrades on error: exposes error and does not throw", async () => {
    const err = new Error("404");
    const client = makeClient({
      getForkMessages: vi.fn(async () => {
        throw err;
      }),
    });
    const { result } = renderHook(() =>
      useBranches({ sessionId: "s1", client, available: true }),
    );
    await act(async () => {
      await result.current.select("e1", 0);
    });
    expect(result.current.error).toBe(err);
    expect(result.current.branchOf("e1")).toBeUndefined();
  });

  it("createBranch error is captured in error state", async () => {
    const err = new Error("fork failed");
    const client = makeClient({
      fork: vi.fn(async () => {
        throw err;
      }),
    });
    const { result } = renderHook(() =>
      useBranches({ sessionId: "s1", client, available: true }),
    );
    await act(async () => {
      await result.current.createBranch("e1");
    });
    expect(result.current.error).toBe(err);
  });
});
