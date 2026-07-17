/**
 * Backend-agnostic MemoryStore contract suite.
 * Call with a factory that yields a fresh empty store per test.
 */

import { expect, it } from "vitest";
import type { MemoryStore } from "../../src/memory/types.js";

export function runMemoryStoreContract(makeStore: () => MemoryStore | Promise<MemoryStore>): void {
  it("upserts and reads back (global)", async () => {
    const store = await makeStore();
    const put = await store.put({
      name: "user-prefs",
      content: "prefer Chinese",
      description: "prefs",
      tags: ["prefs"],
    });
    expect(put.name).toBe("user-prefs");
    expect(put.scope).toBe("global");
    const got = await store.get("user-prefs");
    expect(got?.content).toBe("prefer Chinese");
    expect(got?.tags).toEqual(["prefs"]);
  });

  it("overwrites same name/scope and preserves createdAt", async () => {
    const store = await makeStore();
    const a = await store.put({ name: "note", content: "v1" });
    const b = await store.put({ name: "note", content: "v2", tags: ["t"] });
    expect(b.content).toBe("v2");
    expect(b.createdAt).toBe(a.createdAt);
    expect(b.updatedAt >= a.updatedAt).toBe(true);
  });

  it("global is visible without agentSourceId", async () => {
    const store = await makeStore();
    await store.put({ name: "shared", content: "x" });
    expect((await store.get("shared"))?.content).toBe("x");
    expect((await store.list()).some((m) => m.name === "shared")).toBe(true);
  });

  it("agent-source isolation", async () => {
    const store = await makeStore();
    await store.put({
      name: "secret",
      content: "only-a",
      scope: "agent-source",
      agentSourceId: "agent-a",
    });
    expect(await store.get("secret")).toBeUndefined();
    expect(await store.get("secret", { agentSourceId: "agent-b" })).toBeUndefined();
    expect(
      (await store.get("secret", { agentSourceId: "agent-a" }))?.content,
    ).toBe("only-a");
    const listed = await store.list({ agentSourceId: "agent-a" });
    expect(listed.some((m) => m.name === "secret")).toBe(true);
    const listedB = await store.list({ agentSourceId: "agent-b" });
    expect(listedB.some((m) => m.name === "secret")).toBe(false);
  });

  it("prefers agent-source over global when both exist for same name", async () => {
    const store = await makeStore();
    await store.put({ name: "dual", content: "g", scope: "global" });
    await store.put({
      name: "dual",
      content: "local",
      scope: "agent-source",
      agentSourceId: "agent-a",
    });
    expect((await store.get("dual", { agentSourceId: "agent-a" }))?.content).toBe(
      "local",
    );
    expect((await store.get("dual"))?.content).toBe("g");
  });

  it("list tags filter requires all tags", async () => {
    const store = await makeStore();
    await store.put({ name: "a", content: "1", tags: ["x", "y"] });
    await store.put({ name: "b", content: "2", tags: ["x"] });
    const items = await store.list({ tags: ["x", "y"] });
    expect(items.map((i) => i.name)).toEqual(["a"]);
  });

  it("search matches keyword in body", async () => {
    const store = await makeStore();
    await store.put({ name: "one", content: "hello WORLD" });
    await store.put({ name: "two", content: "nothing" });
    const hits = await store.search("world");
    expect(hits.map((h) => h.name)).toEqual(["one"]);
  });

  it("delete is idempotent and removes entry", async () => {
    const store = await makeStore();
    await store.put({ name: "gone", content: "x" });
    expect(await store.delete("gone")).toBe(true);
    expect(await store.get("gone")).toBeUndefined();
    expect(await store.delete("gone")).toBe(false);
  });

  it("rejects agent-source put without agentSourceId", async () => {
    const store = await makeStore();
    await expect(
      store.put({ name: "bad", content: "x", scope: "agent-source" }),
    ).rejects.toBeTruthy();
  });
}
