/**
 * 内存存储:create/get/delete/list + 未找到语义(Req 9.x)。
 */
import { describe, expect, it } from "vitest";
import { InMemorySessionStore } from "../../src/session/session-store.js";
import { PiSession } from "../../src/session/pi-session.js";
import { MockChannel } from "./mock-channel.js";
import { makeResolved } from "./fixtures.js";

function makeSession(id: string): PiSession {
  return new PiSession({
    id,
    resolved: makeResolved(),
    channel: new MockChannel(),
    idleMs: 0,
  });
}

describe("InMemorySessionStore", () => {
  it("create then get returns the session", () => {
    const store = new InMemorySessionStore(true);
    const s = makeSession("a");
    store.create(s);
    expect(store.get("a")).toBe(s);
  });

  it("get on unknown id returns undefined (not throw)", () => {
    const store = new InMemorySessionStore(true);
    expect(store.get("nope")).toBeUndefined();
  });

  it("delete removes and returns existence", () => {
    const store = new InMemorySessionStore(true);
    const s = makeSession("a");
    store.create(s);
    expect(store.delete("a")).toBe(true);
    expect(store.get("a")).toBeUndefined();
    expect(store.delete("a")).toBe(false);
  });

  it("list returns all current sessions", () => {
    const store = new InMemorySessionStore(true);
    const a = makeSession("a");
    const b = makeSession("b");
    store.create(a);
    store.create(b);
    expect(store.list()).toHaveLength(2);
    expect(store.list()).toEqual(expect.arrayContaining([a, b]));
  });
});
