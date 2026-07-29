/**
 * 集成:真实 PiRpcProcess 通道 + stub agent。多订阅者一致 + 扩展 UI 往返(Req 10.4, 3.3, 5.x）。
 */
import { afterEach, describe, expect, it } from "vitest";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import type { SpawnSpec, SseFrame } from "@blksails/pi-web-protocol";
import { PiRpcProcess } from "../../src/rpc-channel/index.js";
import { PiSession } from "../../src/session/pi-session.js";
import type { SessionChannel } from "../../src/session/session.types.js";
import { makeResolved } from "./fixtures.js";

const STUB = fileURLToPath(
  new URL("./fixtures/session-stub-process.mjs", import.meta.url),
);

function spec(): SpawnSpec {
  return {
    cmd: process.execPath,
    args: [STUB],
    cwd: process.cwd(),
    env: { ...process.env } as Record<string, string>,
  };
}

let live: PiSession[] = [];
afterEach(async () => {
  await Promise.all(live.map((s) => s.stop().catch(() => undefined)));
  live = [];
});

function makeSession(): { session: PiSession; channel: PiRpcProcess } {
  const channel = new PiRpcProcess(spec());
  const session = new PiSession({
    id: randomUUID(),
    resolved: makeResolved(),
    channel: channel satisfies SessionChannel,
    idleMs: 0,
  });
  live.push(session);
  return { session, channel };
}

function chunkType(f: SseFrame): string {
  return f.kind === "uiMessageChunk" ? f.chunk.type : `control:${f.payload.control}`;
}

describe("PiSession integration (real channel + stub)", () => {
  it("broadcasts a consistent frame sequence to multiple subscribers", async () => {
    const { session } = makeSession();
    const a: string[] = [];
    const b: string[] = [];
    const done = new Promise<void>((resolve) => {
      session.subscribe((f) => {
        a.push(chunkType(f));
        if (chunkType(f) === "finish") resolve();
      });
    });
    session.subscribe((f) => b.push(chunkType(f)));
    await session.prompt("hi");
    await done;
    // both subscribers saw the identical AI-SDK-v5-compliant lifecycle sequence:
    // start → text-start → text-delta… → text-end → finish-step → finish.
    expect(a).toEqual([
      "start",
      "text-start",
      "text-delta",
      "text-delta",
      "text-end",
      "finish-step",
      "finish",
    ]);
    expect(b).toEqual(a);
  });

  it("extension UI round trip: pending registered, control frame broadcast, respond clears", async () => {
    const { session, channel } = makeSession();
    const frames: SseFrame[] = [];
    const gotControl = new Promise<void>((resolve) => {
      session.subscribe((f) => {
        frames.push(f);
        if (f.kind === "control" && f.payload.control === "extension-ui") resolve();
      });
    });
    // dispatch a raw "ext" command that makes the stub emit an extension_ui_request
    channel.send(JSON.stringify({ type: "ext", id: randomUUID() }));
    await gotControl;
    expect(session.listPendingExtensionUI()).toEqual(["ext-1"]);
    session.respondExtensionUI("ext-1", {
      type: "extension_ui_response",
      id: "ext-1",
      confirmed: true,
    });
    expect(session.listPendingExtensionUI()).toEqual([]);
  });
});
