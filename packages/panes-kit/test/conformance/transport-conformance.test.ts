// @vitest-environment jsdom
/**
 * 双宿主传输 conformance(spec isolated-panes 任务 5.3)。
 *
 * - browser-iframe:模拟 PanesHost 路径(window 握手 + 每 epoch 独立 MessageChannel);
 * - tauri-webview:真实 `createTauriPaneViewAdapter` + `installTauriPaneBootstrap`,
 *   中间以 JS 忠实镜像 pane_relay.rs 注册表语义(绑定单调/epoch 匹配/标签鉴权);
 *   Rust 端同一语义另有 cargo 单测锁定。
 */
import { describe, expect, it } from "vitest";
import type { PanePort, PaneViewHandle } from "../../src/host-ports.js";
import type { PaneRelayEnvelope } from "../../src/adapters/relay.js";
import {
  createTauriPaneViewAdapter,
  paneWebviewLabel,
  TAURI_PANE_RELAY_BIND_COMMAND,
  TAURI_PANE_RELAY_TO_GUEST_COMMAND,
  TAURI_PANE_RELAY_TO_HOST_COMMAND,
  TAURI_PANE_RELAY_UNBIND_COMMAND,
  type TauriPaneEnv,
} from "../../src/adapters/tauri.js";
import { installTauriPaneBootstrap } from "../../src/adapters/tauri-bootstrap.js";
import { FakeGuestWindow, type FakeMessageEvent } from "./fake-guest-window.js";
import { runPaneTransportConformance, type TransportHarness } from "./transport-conformance.js";

function makeBrowserHarness(): TransportHarness {
  return {
    mount(_instance) {
      const guestWindow = new FakeGuestWindow();
      const portListeners = new Set<(message: unknown) => void>();
      let channelPort: MessagePort | undefined;
      let closed = false;
      // PanesHost 语义:pane:ready 走 window 消息抵达宿主。
      guestWindow.addEventListener("message", (event: FakeMessageEvent) => {
        const data = event.data as { type?: unknown } | null;
        if (event.source === guestWindow && data?.type === "pane:ready") {
          for (const listener of [...portListeners]) listener(event.data);
        }
      });
      const port: PanePort = {
        post(message) {
          if (closed) return;
          if ((message as { type?: unknown }).type === "pane:connected") {
            channelPort?.close();
            const channel = new MessageChannel();
            channelPort = channel.port1;
            channel.port1.onmessage = ({ data }: MessageEvent<unknown>) => {
              for (const listener of [...portListeners]) listener(data);
            };
            guestWindow.postMessage(message, "*", [channel.port2]);
          } else {
            channelPort?.postMessage(message);
          }
        },
        listen(listener) {
          portListeners.add(listener);
          return () => portListeners.delete(listener);
        },
        close() {
          closed = true;
          channelPort?.close();
        },
      };
      const handle: PaneViewHandle = {
        port,
        show() {},
        hide() {},
        reload() {},
        dispose() {
          port.close();
        },
      };
      return { handle, guestWindow };
    },
  };
}

interface FakeGuestRealm {
  deliver(envelope: unknown): void;
  teardown(): void;
}

function makeTauriEnv(): { env: TauriPaneEnv; takeGuestWindow(): FakeGuestWindow } {
  const bindings = new Map<string, { epoch: number; label: string }>();
  const hostListeners = new Set<(envelope: unknown) => void>();
  const guests = new Map<string, FakeGuestRealm>();
  let lastGuestWindow: FakeGuestWindow | undefined;

  const env: TauriPaneEnv = {
    async invoke(command, args) {
      if (command === TAURI_PANE_RELAY_BIND_COMMAND) {
        const { instanceId, epoch, label } = args as { instanceId: string; epoch: number; label: string };
        const existing = bindings.get(instanceId);
        if (existing !== undefined && epoch < existing.epoch) throw new Error("PANE_RELAY_STALE_EPOCH");
        bindings.set(instanceId, { epoch, label });
        return undefined;
      }
      if (command === TAURI_PANE_RELAY_UNBIND_COMMAND) {
        const { instanceId, epoch } = args as { instanceId: string; epoch: number };
        if (bindings.get(instanceId)?.epoch === epoch) bindings.delete(instanceId);
        return undefined;
      }
      if (command === TAURI_PANE_RELAY_TO_GUEST_COMMAND) {
        const { envelope } = args as { envelope: PaneRelayEnvelope };
        const binding = bindings.get(envelope.instanceId);
        if (binding === undefined) throw new Error("PANE_RELAY_UNBOUND");
        if (binding.epoch !== envelope.epoch) throw new Error("PANE_RELAY_STALE_EPOCH");
        const target = binding.label;
        queueMicrotask(() => guests.get(target)?.deliver(envelope));
        return undefined;
      }
      throw new Error(`unexpected host command: ${command}`);
    },
    onRelayMessage(listener) {
      hostListeners.add(listener);
      return () => hostListeners.delete(listener);
    },
    createPaneWebview({ label, instanceId }) {
      // Tauri webview 标签唯一:重建同标签即旧 Realm 消亡。
      guests.get(label)?.teardown();
      const guestWindow = new FakeGuestWindow();
      const deliverListeners = new Set<(envelope: unknown) => void>();
      const uninstall = installTauriPaneBootstrap({
        instanceId,
        window: guestWindow.asWindow(),
        async invoke(command, args) {
          if (command !== TAURI_PANE_RELAY_TO_HOST_COMMAND) throw new Error(`unexpected guest command: ${command}`);
          const { envelope } = args as { envelope: PaneRelayEnvelope };
          const binding = bindings.get(envelope.instanceId);
          if (binding === undefined) throw new Error("PANE_RELAY_UNBOUND");
          if (binding.label !== label) throw new Error("PANE_RELAY_LABEL_MISMATCH");
          if (envelope.epoch !== 0 && envelope.epoch !== binding.epoch) throw new Error("PANE_RELAY_STALE_EPOCH");
          queueMicrotask(() => {
            for (const listener of [...hostListeners]) listener(envelope);
          });
          return undefined;
        },
        onRelayMessage(listener) {
          deliverListeners.add(listener);
          return () => deliverListeners.delete(listener);
        },
      });
      const realm: FakeGuestRealm = {
        deliver(envelope) {
          for (const listener of [...deliverListeners]) listener(envelope);
        },
        teardown() {
          uninstall();
          deliverListeners.clear();
        },
      };
      guests.set(label, realm);
      lastGuestWindow = guestWindow;
      return {
        show() {},
        hide() {},
        reload() {},
        close() {
          // 标签唯一:同标签已被重建时本 webview 早已消亡,close 幂等且不触碰新 Realm。
          if (guests.get(label) !== realm) return;
          realm.teardown();
          guests.delete(label);
        },
      };
    },
  };
  return {
    env,
    takeGuestWindow() {
      if (lastGuestWindow === undefined) throw new Error("no pane webview was created");
      return lastGuestWindow;
    },
  };
}

function makeTauriHarness(): TransportHarness {
  const { env, takeGuestWindow } = makeTauriEnv();
  const adapter = createTauriPaneViewAdapter(env, { allowedProtocols: ["https:"] });
  return {
    async mount(instance) {
      const handle = await adapter.mount({ ...instance, url: "https://pane.local/doc" });
      return { handle, guestWindow: takeGuestWindow() };
    },
  };
}

runPaneTransportConformance("browser-iframe", makeBrowserHarness);
runPaneTransportConformance("tauri-webview", makeTauriHarness);

describe("createTauriPaneViewAdapter guardrails", () => {
  it("rejects undeclared document protocols at mount", async () => {
    const adapter = createTauriPaneViewAdapter(makeTauriEnv().env);
    await expect(
      (async () => adapter.mount({ instanceId: "editor-1", paneId: "editor", epoch: 1, url: "file:///etc/passwd" }))(),
    ).rejects.toThrow("Pane document protocol is not declared");
  });

  it("derives the capability-scoped pane-* webview label", () => {
    expect(paneWebviewLabel("editor-1")).toBe("pane-editor-1");
  });
});
