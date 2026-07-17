import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { FileMemoryStore } from "../../src/memory/file-store.js";
import { makeMemoryExtension } from "../../src/memory/extension.js";

const dirs: string[] = [];

afterEach(async () => {
  while (dirs.length > 0) {
    const d = dirs.pop();
    if (d) await rm(d, { recursive: true, force: true });
  }
});

type ToolDef = {
  name: string;
  execute: (
    id: string,
    params: Record<string, unknown>,
    signal?: AbortSignal,
  ) => Promise<{ details: unknown }>;
};

function mockPi(): { pi: ExtensionAPI; tools: Map<string, ToolDef> } {
  const tools = new Map<string, ToolDef>();
  const pi = {
    registerTool(def: ToolDef) {
      tools.set(def.name, def);
    },
  } as unknown as ExtensionAPI;
  return { pi, tools };
}

describe("memoryExtension", () => {
  it("registers five tools", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "pi-mem-ext-"));
    dirs.push(dir);
    const store = new FileMemoryStore(dir);
    const { pi, tools } = mockPi();
    makeMemoryExtension({ store })(pi);
    expect([...tools.keys()].sort()).toEqual([
      "memory_delete",
      "memory_list",
      "memory_read",
      "memory_search",
      "memory_write",
    ]);
  });

  it("write then read round-trip via tools", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "pi-mem-ext-"));
    dirs.push(dir);
    const store = new FileMemoryStore(dir);
    const { pi, tools } = mockPi();
    makeMemoryExtension({ store, defaultAgentSourceId: "demo" })(pi);

    const write = tools.get("memory_write")!;
    const w = await write.execute("1", {
      name: "prefs",
      content: "hello memory",
      tags: ["t"],
    });
    const wDetails = w.details as { ok: boolean; entry?: { content: string } };
    expect(wDetails.ok).toBe(true);
    expect(wDetails.entry?.content).toBe("hello memory");

    const read = tools.get("memory_read")!;
    const r = await read.execute("2", { name: "prefs" });
    const rDetails = r.details as { ok: boolean; entry?: { content: string } };
    expect(rDetails.ok).toBe(true);
    expect(rDetails.entry?.content).toBe("hello memory");

    const search = tools.get("memory_search")!;
    const s = await search.execute("3", { query: "hello" });
    const sDetails = s.details as { ok: boolean; count: number };
    expect(sDetails.ok).toBe(true);
    expect(sDetails.count).toBe(1);
  });
});
