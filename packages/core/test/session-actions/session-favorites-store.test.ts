/**
 * 单元:SessionFavoritesStore —— 会话收藏偏好的容错原子读写。
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createSessionFavoritesStore } from "../../src/session-actions/index.js";

let dir: string;
let filePath: string;

beforeEach(async () => {
  dir = join(
    tmpdir(),
    `sess-fav-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  await fs.mkdir(dir, { recursive: true });
  filePath = join(dir, "session-favorites.json");
});

afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

describe("SessionFavoritesStore", () => {
  it("returns [] when file is missing", async () => {
    const store = createSessionFavoritesStore({ root: dir });
    expect(await store.list()).toEqual([]);
  });

  it("returns [] on bad JSON (does not throw)", async () => {
    await fs.writeFile(filePath, "{ not json", "utf8");
    const store = createSessionFavoritesStore({ root: dir });
    expect(await store.list()).toEqual([]);
  });

  it("returns [] when sessionIds is not an array", async () => {
    await fs.writeFile(filePath, JSON.stringify({ sessionIds: "x" }), "utf8");
    const store = createSessionFavoritesStore({ root: dir });
    expect(await store.list()).toEqual([]);
  });

  it("set then list round-trips", async () => {
    const store = createSessionFavoritesStore({ root: dir });
    await store.set(["a", "b", "c"]);
    expect(await store.list()).toEqual(["a", "b", "c"]);
  });

  it("dedupes and drops empty strings on set", async () => {
    const store = createSessionFavoritesStore({ root: dir });
    await store.set(["a", "", "a", "b", ""]);
    expect(await store.list()).toEqual(["a", "b"]);
  });

  it("full-replace overwrites prior set", async () => {
    const store = createSessionFavoritesStore({ root: dir });
    await store.set(["a", "b"]);
    await store.set(["c"]);
    expect(await store.list()).toEqual(["c"]);
  });

  it("persists valid JSON on disk (no half-write)", async () => {
    const store = createSessionFavoritesStore({ root: dir });
    await store.set(["a"]);
    const raw = await fs.readFile(filePath, "utf8");
    expect(() => JSON.parse(raw)).not.toThrow();
    expect(JSON.parse(raw)).toEqual({ sessionIds: ["a"] });
  });

  it("drops filters bad entry types read from disk", async () => {
    await fs.writeFile(
      filePath,
      JSON.stringify({ sessionIds: ["a", 1, null, "b"] }),
      "utf8",
    );
    const store = createSessionFavoritesStore({ root: dir });
    expect(await store.list()).toEqual(["a", "b"]);
  });
});
