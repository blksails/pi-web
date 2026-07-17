import { describe, expect, it } from "vitest";
import {
  createMemoryStore,
  memoryConfigFromEnv,
  MemoryConfigError,
  FileMemoryStore,
  SupabaseMemoryStore,
} from "../../src/memory/index.js";

describe("memoryConfigFromEnv", () => {
  it("defaults to file backend", () => {
    const cfg = memoryConfigFromEnv({});
    expect(cfg.backend).toBe("file");
    expect(cfg.dir.length).toBeGreaterThan(0);
  });

  it("accepts file + custom dir", () => {
    const cfg = memoryConfigFromEnv({
      PI_WEB_MEMORY_BACKEND: "file",
      PI_WEB_MEMORY_DIR: "/tmp/mem",
    });
    expect(cfg.backend).toBe("file");
    expect(cfg.dir).toBe("/tmp/mem");
  });

  it("requires supabase credentials", () => {
    expect(() =>
      memoryConfigFromEnv({ PI_WEB_MEMORY_BACKEND: "supabase" }),
    ).toThrow(MemoryConfigError);
  });

  it("rejects unknown backend", () => {
    expect(() =>
      memoryConfigFromEnv({ PI_WEB_MEMORY_BACKEND: "redis" }),
    ).toThrow(/unknown/);
  });

  it("createMemoryStore returns correct class", () => {
    const file = createMemoryStore({
      config: {
        backend: "file",
        dir: "/tmp/x",
        supabaseTable: "pi_web_memories",
      },
    });
    expect(file).toBeInstanceOf(FileMemoryStore);

    const sb = createMemoryStore({
      config: {
        backend: "supabase",
        dir: "/tmp/x",
        supabaseUrl: "https://x.supabase.co",
        supabaseKey: "k",
        supabaseTable: "pi_web_memories",
      },
      fetchImpl: async () => new Response("[]", { status: 200 }),
    });
    expect(sb).toBeInstanceOf(SupabaseMemoryStore);
  });
});
