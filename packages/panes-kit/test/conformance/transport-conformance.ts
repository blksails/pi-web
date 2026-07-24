/**
 * 跨宿主传输 conformance(spec isolated-panes 任务 5.3,F4 验收门)。
 *
 * 同一 Guest fixture(真实 `connectPaneGuest`)跑在每种传输之上,断言:
 * 握手身份、双向信封逐字透传(含宿主错误语义)、surface/lifecycle 下行、
 * epoch 换代隔离(旧 handle/旧 Guest 永不触达新 Guest)、dispose 双向静默。
 * 授权与错误码语义由宿主核心(authorization.ts)统一提供,传输层的义务是
 * 信封零改写——此处以深度相等锁定。
 */
import { describe, expect, it } from "vitest";
import { PANE_PROTOCOL_VERSION, PaneCapabilitiesSchema, type PaneConnectedMessage, type PaneInstance } from "../../src/index.js";
import { connectPaneGuest, type PaneGuestConnection } from "../../src/guest.js";
import type { PaneViewHandle } from "../../src/host-ports.js";
import type { FakeGuestWindow } from "./fake-guest-window.js";

export interface TransportMount {
  readonly handle: PaneViewHandle;
  readonly guestWindow: FakeGuestWindow;
}

export interface TransportHarness {
  /** 同 instanceId 再次 mount = 更高 epoch 重绑(reload 语义);旧 handle 保留用于隔离断言。 */
  mount(instance: Pick<PaneInstance, "instanceId" | "paneId" | "epoch">): Promise<TransportMount> | TransportMount;
}

const GRANTS = PaneCapabilitiesSchema.parse({});

const connectedMessage = (instance: Pick<PaneInstance, "instanceId" | "paneId" | "epoch">): PaneConnectedMessage => ({
  type: "pane:connected",
  protocol: PANE_PROTOCOL_VERSION,
  instance,
  grants: GRANTS,
  interactionMode: "standard",
});

async function until(predicate: () => boolean): Promise<void> {
  for (let i = 0; i < 200 && !predicate(); i += 1) await new Promise((resolve) => setTimeout(resolve, 5));
  expect(predicate()).toBe(true);
}

const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 50));

const typeOf = (message: unknown): unknown => (message as { type?: unknown } | null)?.type;

interface HandshakeResult {
  readonly guest: PaneGuestConnection;
  readonly seen: unknown[];
}

async function handshake(
  mounted: TransportMount,
  instance: Pick<PaneInstance, "instanceId" | "paneId" | "epoch">,
): Promise<HandshakeResult> {
  const seen: unknown[] = [];
  mounted.handle.port.listen((message) => seen.push(message));
  const pendingGuest = connectPaneGuest({ expectedPaneId: instance.paneId, window: mounted.guestWindow.asWindow() });
  await until(() => seen.some((message) => typeOf(message) === "pane:ready"));
  mounted.handle.port.post(connectedMessage(instance));
  return { guest: await pendingGuest, seen };
}

export function runPaneTransportConformance(name: string, makeHarness: () => TransportHarness): void {
  describe(`pane transport conformance: ${name}`, () => {
    const EDITOR = { instanceId: "editor-1", paneId: "editor", epoch: 1 } as const;

    it("completes the ready/connected handshake with exact identity and grants", async () => {
      const mounted = await makeHarness().mount(EDITOR);
      const { guest, seen } = await handshake(mounted, EDITOR);
      expect(seen.find((message) => typeOf(message) === "pane:ready")).toEqual({
        type: "pane:ready",
        protocol: PANE_PROTOCOL_VERSION,
        paneId: "editor",
      });
      expect(guest.instanceId).toBe("editor-1");
      expect(guest.paneId).toBe("editor");
      expect(guest.epoch).toBe(1);
      expect(guest.interactionMode).toBe("standard");
      expect(guest.grants).toEqual(GRANTS);
    });

    it("relays request/result envelopes verbatim both ways, including host error semantics", async () => {
      const mounted = await makeHarness().mount(EDITOR);
      const { guest, seen } = await handshake(mounted, EDITOR);
      mounted.handle.port.listen((message) => {
        const request = message as { type?: unknown; requestId: string; route?: unknown };
        if (request.type !== "pane:request") return;
        if (request.route === "files") {
          mounted.handle.port.post({ type: "pane:request" === request.type ? "pane:result" : "pane:result", requestId: request.requestId, ok: true, data: { files: ["a.txt"] } });
        } else {
          mounted.handle.port.post({
            type: "pane:result",
            requestId: request.requestId,
            ok: false,
            error: { code: "CAPABILITY_DENIED", message: "route is not granted", retryable: false },
          });
        }
      });
      await expect(guest.query("files")).resolves.toEqual({ files: ["a.txt"] });
      await expect(guest.query("denied")).rejects.toMatchObject({ code: "CAPABILITY_DENIED", retryable: false });
      // 上行信封逐字透传:字段不增、不减、不改。
      expect(seen.find((message) => typeOf(message) === "pane:request")).toEqual({
        type: "pane:request",
        requestId: "editor-1:1",
        operation: "route.query",
        route: "files",
        query: {},
      });
    });

    it("delivers surface mirrors and lifecycle transitions to the guest", async () => {
      const mounted = await makeHarness().mount(EDITOR);
      const { guest } = await handshake(mounted, EDITOR);
      const states: unknown[] = [];
      const lifecycles: string[] = [];
      guest.surface.subscribe("surface:canvas", (value) => states.push(value));
      guest.onLifecycle((state) => lifecycles.push(state));
      mounted.handle.port.post({ type: "pane:surface", key: "surface:canvas", value: { revision: 7 } });
      mounted.handle.port.post({ type: "pane:lifecycle", state: "hidden" });
      await until(() => states.length === 1 && lifecycles.length === 1);
      expect(states).toEqual([{ revision: 7 }]);
      expect(guest.surface.getState("surface:canvas")).toEqual({ revision: 7 });
      expect(lifecycles).toEqual(["hidden"]);
    });

    it("supersedes an epoch on reload: stale handle and stale guest never reach the new pair", async () => {
      const harness = makeHarness();
      const mounted1 = await harness.mount(EDITOR);
      const stale = await handshake(mounted1, EDITOR);
      const reloaded = { ...EDITOR, epoch: 2 };
      const mounted2 = await harness.mount(reloaded);
      const fresh = await handshake(mounted2, reloaded);

      const lifecycles: string[] = [];
      fresh.guest.onLifecycle((state) => lifecycles.push(state));
      mounted1.handle.port.post({ type: "pane:lifecycle", state: "closing" });
      mounted2.handle.port.post({ type: "pane:lifecycle", state: "visible" });
      await until(() => lifecycles.length > 0);
      expect(lifecycles).toEqual(["visible"]);

      void stale.guest.query("stale-route").catch(() => undefined);
      void fresh.guest.query("fresh-route").catch(() => undefined);
      await until(() => fresh.seen.some((message) => typeOf(message) === "pane:request"));
      await settle();
      const requests = fresh.seen.filter((message) => typeOf(message) === "pane:request") as Array<{ route?: unknown }>;
      expect(requests.map((request) => request.route)).toEqual(["fresh-route"]);

      // 旧 handle 的 dispose(含解绑)不得扰动新 epoch 的通道。
      mounted1.handle.dispose();
      mounted2.handle.port.post({ type: "pane:lifecycle", state: "hidden" });
      await until(() => lifecycles.length === 2);
      expect(lifecycles).toEqual(["visible", "hidden"]);
    });

    it("goes silent in both directions after dispose", async () => {
      const mounted = await makeHarness().mount(EDITOR);
      const { guest, seen } = await handshake(mounted, EDITOR);
      const lifecycles: string[] = [];
      guest.onLifecycle((state) => lifecycles.push(state));
      mounted.handle.dispose();
      mounted.handle.port.post({ type: "pane:lifecycle", state: "visible" });
      void guest.query("files").catch(() => undefined);
      await settle();
      expect(lifecycles).toEqual([]);
      expect(seen.filter((message) => typeOf(message) === "pane:request")).toHaveLength(0);
    });
  });
}
