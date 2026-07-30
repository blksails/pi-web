/**
 * 多会话并行下的工作状态(spec session-meta-index, Req 7.1/7.2/7.5 的多会话面)。
 *
 * 与既有用例的区别:这里**不用 stub 的 activityOf**,而是照 `lib/app/pi-handler.ts` 的真实接线
 * 构造 —— 从活跃会话注册表按标识取 `PiSession.activity`。验的是「多个会话同时活着时,
 * 列表能不能各自给出正确状态」,而不是「投影函数会不会被调用」。
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  ListSessionsResponseSchema,
  type AgentEvent,
  type RpcExtensionUIRequest,
  type SessionActivity,
} from "@blksails/pi-web-protocol";
import { createPiWebHandler } from "../../src/http/index.js";
import { InMemorySessionStore } from "../../src/session/session-store.js";
import { SessionManager } from "../../src/session/session-manager.js";
import { FsSessionEntryStore } from "../../src/session-store/index.js";
import { createSessionListRoutes } from "../../src/session-list/index.js";
import { MockChannel } from "../session/mock-channel.js";
import { makeResolved } from "../session/fixtures.js";

const start = { type: "agent_start" } as AgentEvent;
const end = { type: "agent_end", messages: [] } as unknown as AgentEvent;
const CONFIRM: RpcExtensionUIRequest = {
  type: "extension_ui_request",
  id: "ui-1",
  method: "confirm",
  title: "Proceed?",
  message: "Run?",
};
const NOTIFY: RpcExtensionUIRequest = {
  type: "extension_ui_request",
  id: "n-1",
  method: "notify",
  message: "done",
};

let dir: string;
const cwd = "/tmp/multi-activity-proj";

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "multi-activity-"));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

interface Rig {
  readonly fetch: (req: Request) => Promise<Response>;
  readonly channels: Map<string, MockChannel>;
}

/** 建 N 个**真实活跃**会话 + 一个照 pi-handler 接线的列表端点。 */
async function rig(ids: readonly string[]): Promise<Rig> {
  const entryStore = new FsSessionEntryStore(dir);
  for (const [i, id] of ids.entries()) {
    await entryStore.create({
      type: "session",
      id,
      version: 1,
      cwd,
      timestamp: `2026-06-01T00:00:0${i}.000Z`,
    });
  }

  const store = new InMemorySessionStore(true);
  const manager = new SessionManager({ store, idleMs: 0, snapshotAuthority: true });
  const channels = new Map<string, MockChannel>();
  for (const id of ids) {
    const channel = new MockChannel();
    channels.set(id, channel);
    manager.createSession({ resolved: makeResolved(), channel, id });
  }

  // ★ 与 lib/app/pi-handler.ts 同一写法:从活跃会话注册表取活跃态投影。
  const sessionActivityOf = (sessionId: string): SessionActivity | undefined =>
    store.get(sessionId)?.activity;

  return {
    fetch: createPiWebHandler({
      manager,
      store,
      routes: createSessionListRoutes({
        createEntryStore: async () => entryStore,
        activityOf: sessionActivityOf,
      }),
      authResolver: () => ({ anonymous: true }),
    }),
    channels,
  };
}

async function activities(r: Rig): Promise<Record<string, SessionActivity | undefined>> {
  const res = await r.fetch(
    new Request("http://x/sessions"),
  );
  const body = ListSessionsResponseSchema.parse(JSON.parse(await res.text()));
  return Object.fromEntries(body.sessions.map((s) => [s.sessionId, s.activity]));
}

describe("多会话并行的工作状态", () => {
  it("★ 三个会话同时活着:各自状态互不串台", async () => {
    const r = await rig(["a", "b", "c"]);
    // a 在跑;b 在等用户回应;c 空闲
    r.channels.get("a")!.emitEvent(start);
    r.channels.get("b")!.emitEvent(start);
    r.channels.get("b")!.emitExtensionUIRequest(CONFIRM);

    expect(await activities(r)).toEqual({
      a: "working",
      b: "awaiting-input",
      c: undefined,
    });
  });

  it("★ 一次列表请求同时反映多个会话的忙态(不只是当前查看的那个)", async () => {
    const r = await rig(["a", "b", "c"]);
    for (const id of ["a", "b", "c"]) r.channels.get(id)!.emitEvent(start);
    expect(await activities(r)).toEqual({
      a: "working",
      b: "working",
      c: "working",
    });
  });

  it("某个会话结束后只有它回到空闲,其余不受影响", async () => {
    const r = await rig(["a", "b"]);
    r.channels.get("a")!.emitEvent(start);
    r.channels.get("b")!.emitEvent(start);
    expect(await activities(r)).toEqual({ a: "working", b: "working" });

    r.channels.get("a")!.emitEvent(end);
    expect(await activities(r)).toEqual({ a: undefined, b: "working" });
  });

  it("推送类请求滞留在某个会话的挂起表里,不影响它或其他会话的状态判定", async () => {
    const r = await rig(["a", "b"]);
    r.channels.get("a")!.emitExtensionUIRequest(NOTIFY);
    r.channels.get("b")!.emitEvent(start);
    expect(await activities(r)).toEqual({ a: undefined, b: "working" });
  });

  it("未加载的历史会话恒空闲,且不因此被加载", async () => {
    // 只为 a 建活跃会话;b 只存在于持久化里
    const entryStore = new FsSessionEntryStore(dir);
    for (const [i, id] of ["a", "b"].entries()) {
      await entryStore.create({
        type: "session",
        id,
        version: 1,
        cwd,
        timestamp: `2026-06-01T00:00:0${i}.000Z`,
      });
    }
    const store = new InMemorySessionStore(true);
    const manager = new SessionManager({ store, idleMs: 0, snapshotAuthority: true });
    const channel = new MockChannel();
    manager.createSession({ resolved: makeResolved(), channel, id: "a" });
    channel.emitEvent(start);

    const handler = createPiWebHandler({
      manager,
      store,
      routes: createSessionListRoutes({
        createEntryStore: async () => entryStore,
        activityOf: (id) => store.get(id)?.activity,
      }),
      authResolver: () => ({ anonymous: true }),
    });
    const res = await handler(
      new Request("http://x/sessions"),
    );
    const body = ListSessionsResponseSchema.parse(JSON.parse(await res.text()));
    const map = Object.fromEntries(body.sessions.map((s) => [s.sessionId, s.activity]));
    expect(map).toEqual({ a: "working", b: undefined });
    // 取状态没有把 b 加载进活跃注册表
    expect(store.get("b")).toBeUndefined();
  });
});
