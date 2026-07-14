/**
 * 单元:wireSurfaceBridge(agent-authoritative-surface, Task 4.1)。
 * 用注入的 stdin(EventEmitter)/stdout(捕获)/globalScope(surface 注册表 seam)验证
 * 命中派发写回、非 surface 行放行、未注册 domain、畸形不写回、无 registry 降级。
 */
import { describe, it, expect, vi } from "vitest";
import { EventEmitter } from "node:events";
import { protocolVersion, type UiRpcRequest } from "@blksails/pi-web-protocol";
import {
  wireSurfaceBridge,
  SURFACE_REGISTRY_SEAM_KEY,
} from "../../src/runner/surface-wiring.js";
import { createInboundFrameRouter } from "../../src/runner/frame-channel/index.js";

const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

function makeHarness(withRegistry: boolean, dispatch?: ReturnType<typeof vi.fn>) {
  const stdin = new EventEmitter() as EventEmitter & { setEncoding(e: string): void };
  (stdin as unknown as { setEncoding: (e: string) => void }).setEncoding = () => {};
  const lines: string[] = [];
  const stdout = { write: (s: string) => (lines.push(s), true) };
  const stderr = { write: () => true };
  const globalScope: Record<string, unknown> = {};
  if (withRegistry) {
    globalScope[SURFACE_REGISTRY_SEAM_KEY] = {
      __piWebSurfaceRegistry: true,
      entries: new Map<string, unknown>([["demo", { dispatch: dispatch! }]]),
    };
  }
  const channel = createInboundFrameRouter({ sessionId: "s1", stdin, stdout, stderr });
  const wiring = wireSurfaceBridge(channel, {
    sessionId: "s1",
    stderr,
    globalScope,
  });
  const feed = (obj: unknown): void => {
    stdin.emit("data", JSON.stringify(obj) + "\n");
  };
  return { stdin, lines, wiring, feed };
}

function uiRpcLine(req: Partial<UiRpcRequest> & { payload: unknown }): unknown {
  const request: UiRpcRequest = {
    correlationId: req.correlationId ?? "c1",
    point: req.point ?? "command",
    action: req.action ?? "execute",
    payload: req.payload,
    protocolVersion,
  };
  return { type: "ui_rpc", request };
}

describe("wireSurfaceBridge", () => {
  it("installed 为 true", () => {
    const { wiring } = makeHarness(false);
    expect(wiring.installed).toBe(true);
  });

  it("命中 surface 命令 → dispatch 派发 → 回流 ui_rpc_response", async () => {
    const dispatch = vi.fn(async (action: string) => ({
      domain: "demo",
      action,
      ok: true,
      data: { count: 1 },
    }));
    const { lines, feed } = makeHarness(true, dispatch);
    feed(uiRpcLine({ payload: { domain: "demo", action: "increment" } }));
    await flush();
    expect(dispatch).toHaveBeenCalledWith("increment", undefined);
    expect(lines).toHaveLength(1);
    const frame = JSON.parse(lines[0]!.trim());
    expect(frame.type).toBe("ui_rpc_response");
    expect(frame.response.correlationId).toBe("c1");
    expect(frame.response.ok).toBe(true);
    expect(frame.response.result).toEqual({
      domain: "demo",
      action: "increment",
      ok: true,
      data: { count: 1 },
    });
  });

  it("dispatch 的 args 原样透传", async () => {
    const dispatch = vi.fn(async () => ({ domain: "demo", action: "echo", ok: true, data: {} }));
    const { feed } = makeHarness(true, dispatch);
    feed(uiRpcLine({ payload: { domain: "demo", action: "echo", args: { text: "hi" } } }));
    await flush();
    expect(dispatch).toHaveBeenCalledWith("echo", { text: "hi" });
  });

  it("非 surface 行放行(host 命令有 name)→ 不写回", async () => {
    const dispatch = vi.fn();
    const { lines, feed } = makeHarness(true, dispatch);
    // host 命令 payload 含顶层 name → SurfaceCommandPayload.safeParse 失败 → 放行
    feed(uiRpcLine({ payload: { name: "plugin", argv: "install x" } }));
    await flush();
    expect(dispatch).not.toHaveBeenCalled();
    expect(lines).toHaveLength(0);
  });

  it("非 command point 放行(如 slash list)→ 不写回", async () => {
    const dispatch = vi.fn();
    const { lines, feed } = makeHarness(true, dispatch);
    feed(uiRpcLine({ point: "slash", action: "list", payload: { domain: "demo", action: "x" } }));
    await flush();
    expect(dispatch).not.toHaveBeenCalled();
    expect(lines).toHaveLength(0);
  });

  it("未注册 domain → surface_not_registered(不派发,不崩)", async () => {
    const dispatch = vi.fn();
    const { lines, feed } = makeHarness(true, dispatch);
    feed(uiRpcLine({ payload: { domain: "absent", action: "x" } }));
    await flush();
    expect(dispatch).not.toHaveBeenCalled();
    expect(lines).toHaveLength(1);
    const frame = JSON.parse(lines[0]!.trim());
    expect(frame.response.ok).toBe(false);
    expect(frame.response.result.error.code).toBe("surface_not_registered");
  });

  it("畸形 payload 不写回(非 ui_rpc / 缺字段 / 非 JSON)", async () => {
    const dispatch = vi.fn();
    const { lines, feed, stdin } = makeHarness(true, dispatch);
    feed({ type: "not_ui_rpc", foo: 1 });
    feed(uiRpcLine({ payload: { domain: "", action: "x" } })); // domain 空 → SurfaceCommandPayload 失败
    stdin.emit("data", "{not json}\n");
    await flush();
    expect(dispatch).not.toHaveBeenCalled();
    expect(lines).toHaveLength(0);
  });

  it("无 registry seam → 惰性降级(surface 命令回 surface_not_registered,不崩)", async () => {
    const { lines, feed } = makeHarness(false);
    feed(uiRpcLine({ payload: { domain: "demo", action: "x" } }));
    await flush();
    expect(lines).toHaveLength(1);
    const frame = JSON.parse(lines[0]!.trim());
    expect(frame.response.result.error.code).toBe("surface_not_registered");
  });

  it("cleanup 幂等 + 卸载后不再处理", async () => {
    const dispatch = vi.fn(async () => ({ domain: "demo", action: "x", ok: true }));
    const { wiring, feed, lines } = makeHarness(true, dispatch);
    wiring.cleanup();
    wiring.cleanup();
    feed(uiRpcLine({ payload: { domain: "demo", action: "x" } }));
    await flush();
    expect(lines).toHaveLength(0);
  });
});
