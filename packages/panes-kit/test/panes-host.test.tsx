// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { definePanes, PANE_PROTOCOL_VERSION } from "../src/index.js";
import { PanesHost } from "../src/react/index.js";

afterEach(cleanup);

const definition = definePanes({
  id: "host-test",
  initialPaneIds: ["editor"],
  maxOpenPanes: 4,
  panes: [{
    id: "editor",
    title: "Editor",
    document: { kind: "inline", srcDoc: "<!doctype html><p>editor</p>" },
    capabilities: {},
    allowMultiple: true,
    maxInstances: 3,
    lifecycle: {},
  }],
});

describe("PanesHost multi-open UI", () => {
  it("opens three independent iframe instances of the same pane and closes one", () => {
    let sequence = 0;
    const view = render(<PanesHost
      definition={definition}
      config={{ interactionMode: "advanced" }}
      createInstanceId={(paneId) => `${paneId}-${++sequence}`}
    />);
    const add = (): void => {
      fireEvent.click(screen.getByRole("button", { name: "新开 Pane" }));
      fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: /^Editor/ }));
    };
    add();
    add();
    const frames = [...view.container.querySelectorAll("iframe")];
    expect(frames).toHaveLength(3);
    expect(new Set(frames.map((frame) => frame.id)).size).toBe(3);
    expect(screen.getAllByRole("tab").map((tab) => tab.textContent?.trim())).toEqual(["Editor 1", "Editor 2", "Editor 3"]);
    fireEvent.click(screen.getAllByRole("button", { name: "关闭 Editor" })[0]!);
    expect(view.container.querySelectorAll("iframe")).toHaveLength(2);
  });

  it("activates on tab click, reorders via drag and recovers from an empty workspace", () => {
    let sequence = 0;
    const view = render(<PanesHost
      definition={definition}
      config={{ interactionMode: "advanced" }}
      createInstanceId={(paneId) => `${paneId}-${++sequence}`}
    />);
    const add = (): void => {
      fireEvent.click(screen.getByRole("button", { name: "新开 Pane" }));
      fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: /^Editor/ }));
    };
    add();
    add();
    const controlsOrder = (): string[] =>
      screen.getAllByRole("tab").map((tab) => tab.getAttribute("aria-controls") ?? "");
    expect(controlsOrder()).toEqual(["pane-view-editor-1", "pane-view-editor-2", "pane-view-editor-3"]);

    // 切换:点第二个 tab,选中态与 iframe 可见性同步
    fireEvent.click(screen.getAllByRole("tab")[1]!);
    expect(screen.getAllByRole("tab")[1]!.getAttribute("aria-selected")).toBe("true");
    const frameById = (id: string): HTMLIFrameElement =>
      view.container.querySelector<HTMLIFrameElement>(`#pane-view-${id}`)!;
    expect(frameById("editor-2").style.display).toBe("block");
    expect(frameById("editor-1").style.display).toBe("none");

    // 拖排:把第三个 tab 拖到第一个之前
    const wrappers = screen.getAllByRole("tab").map((tab) => tab.parentElement!);
    fireEvent.dragStart(wrappers[2]!);
    fireEvent.dragOver(wrappers[0]!);
    fireEvent.drop(wrappers[0]!);
    expect(controlsOrder()).toEqual(["pane-view-editor-3", "pane-view-editor-1", "pane-view-editor-2"]);

    // 空态:全部关闭后出现空工作区入口,可重新打开恢复
    for (let remaining = 3; remaining > 0; remaining -= 1) {
      fireEvent.click(screen.getAllByRole("button", { name: "关闭 Editor" })[0]!);
    }
    expect(view.container.querySelectorAll("iframe")).toHaveLength(0);
    fireEvent.click(screen.getByRole("button", { name: "打开一个 Pane" }));
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: /^Editor/ }));
    expect(view.container.querySelectorAll("iframe")).toHaveLength(1);
    expect(screen.getAllByRole("tab")[0]!.getAttribute("aria-selected")).toBe("true");
  });
});

describe("PanesHost guest protocol seam (任务 3.2)", () => {
  const protocolDefinition = definePanes({
    id: "protocol-test",
    initialPaneIds: ["uploader"],
    panes: [{
      id: "uploader",
      title: "Uploader",
      document: { kind: "inline", srcDoc: "<!doctype html><p>uploader</p>" },
      capabilities: {
        attachments: "read-write",
        surfaceKeys: ["surface:canvas"],
        surfaceCommands: [{ domain: "canvas", actions: ["ping"] }],
      },
      lifecycle: {},
    }],
  });

  const until = async (predicate: () => boolean): Promise<void> => {
    for (let i = 0; i < 200 && !predicate(); i += 1) await new Promise((resolve) => setTimeout(resolve, 5));
    expect(predicate()).toBe(true);
  };

  it("attachment.put 还原 File 走注入 upload,Guest 仅得 attachmentId/displayUrl;surface.run 逐 action 授权", async () => {
    const uploaded: Array<{ name: string; type: string; text: string }> = [];
    const upload = vi.fn(async (_baseUrl: string, _sessionId: string, file: File) => {
      // jsdom 的 File 无 arrayBuffer(),用 FileReader 读回内容。
      const text = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(reader.error);
        reader.readAsText(file);
      });
      uploaded.push({ name: file.name, type: file.type, text });
      return { attachment: { id: "att_1" }, displayUrl: "blob:preview" };
    });
    const run = vi.fn(async () => ({ ok: true }));
    const surface = {
      run,
      getState: <T,>(_key: string): T | undefined => ({ revision: 1 }) as T,
      subscribe: () => () => {},
      hasCommand: () => true,
    };
    const view = render(<PanesHost
      definition={protocolDefinition}
      baseUrl="/api"
      sessionId="s1"
      upload={upload}
      surface={surface}
      createInstanceId={(paneId) => `${paneId}-1`}
    />);
    const frame = view.container.querySelector("iframe")!;
    const posted: Array<{ message: unknown; ports: readonly MessagePort[] }> = [];
    frame.contentWindow!.postMessage = ((message: unknown, _target: unknown, transfer?: readonly MessagePort[]) => {
      posted.push({ message, ports: transfer ?? [] });
    }) as unknown as typeof window.postMessage;

    window.dispatchEvent(new MessageEvent("message", {
      data: { type: "pane:ready", protocol: PANE_PROTOCOL_VERSION, paneId: "uploader" },
      source: frame.contentWindow,
    }));
    expect(posted).toHaveLength(1);
    expect(posted[0]!.message).toMatchObject({
      type: "pane:connected",
      protocol: PANE_PROTOCOL_VERSION,
      instance: { instanceId: "uploader-1", paneId: "uploader", epoch: 1 },
    });
    const port = posted[0]!.ports[0]!;
    const results: Array<{ type?: string; requestId?: string; key?: string; value?: unknown }> = [];
    port.onmessage = ({ data }: MessageEvent) => results.push(data as never);

    // 已授权 surfaceKey 的镜像在连接建立时即下推。
    await until(() => results.some((message) => message.type === "pane:surface"));
    expect(results.find((message) => message.type === "pane:surface")).toEqual({
      type: "pane:surface",
      key: "surface:canvas",
      value: { revision: 1 },
    });

    const bytes = new TextEncoder().encode("png-bytes").buffer as ArrayBuffer;
    port.postMessage({ type: "pane:request", requestId: "r1", operation: "attachment.put", name: "a.png", mimeType: "image/png", bytes }, [bytes]);
    port.postMessage({ type: "pane:request", requestId: "r2", operation: "surface.run", domain: "canvas", action: "nope" });
    port.postMessage({ type: "pane:request", requestId: "r3", operation: "surface.run", domain: "canvas", action: "ping" });
    await until(() => ["r1", "r2", "r3"].every((id) => results.some((message) => message.requestId === id)));

    // Guest 仅得 attachmentId/displayUrl,上游 attachment 对象其余字段不外泄。
    expect(results.find((message) => message.requestId === "r1")).toEqual({
      type: "pane:result",
      requestId: "r1",
      ok: true,
      data: { attachmentId: "att_1", displayUrl: "blob:preview" },
    });
    expect(upload).toHaveBeenCalledWith("/api", "s1", expect.any(File));
    expect(uploaded).toEqual([{ name: "a.png", type: "image/png", text: "png-bytes" }]);

    expect(results.find((message) => message.requestId === "r2")).toMatchObject({
      ok: false,
      error: { code: "CAPABILITY_DENIED" },
    });
    expect(results.find((message) => message.requestId === "r3")).toMatchObject({ ok: true, data: { ok: true } });
    expect(run).toHaveBeenCalledTimes(1);
    expect(run).toHaveBeenCalledWith("canvas", "ping", undefined);
  });

  it("多实例独立端口观察同一 surface:canvas 镜像(F3),关闭其一不扰其余", async () => {
    const canvasDefinition = definePanes({
      id: "f3-test",
      initialPaneIds: ["canvas"],
      panes: [{
        id: "canvas",
        title: "Canvas",
        document: { kind: "inline", srcDoc: "<!doctype html><p>canvas</p>" },
        capabilities: { surfaceKeys: ["surface:canvas"] },
        allowMultiple: true,
        maxInstances: 3,
        lifecycle: {},
      }],
    });
    const listeners = new Set<(value: unknown) => void>();
    let canvasState: unknown = { revision: 1 };
    const surface = {
      run: vi.fn(async () => undefined),
      getState: <T,>(_key: string): T | undefined => canvasState as T,
      subscribe: (_key: string, listener: (value: unknown) => void) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
      hasCommand: () => true,
    };
    let sequence = 0;
    const view = render(<PanesHost
      definition={canvasDefinition}
      surface={surface}
      workspaceDomain={false}
      createInstanceId={(paneId) => `${paneId}-${++sequence}`}
    />);
    const add = (): void => {
      fireEvent.click(screen.getByRole("button", { name: "新开 Pane" }));
      fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: /^Canvas/ }));
    };
    add();
    add();
    const frames = [...view.container.querySelectorAll("iframe")];
    expect(frames).toHaveLength(3);
    const mirrors = new Map<number, Array<{ type?: string; key?: string; value?: unknown }>>();
    const ports: MessagePort[] = [];
    frames.forEach((frame, index) => {
      const posted: Array<{ ports: readonly MessagePort[] }> = [];
      frame.contentWindow!.postMessage = ((_message: unknown, _target: unknown, transfer?: readonly MessagePort[]) => {
        posted.push({ ports: transfer ?? [] });
      }) as unknown as typeof window.postMessage;
      window.dispatchEvent(new MessageEvent("message", {
        data: { type: "pane:ready", protocol: PANE_PROTOCOL_VERSION, paneId: "canvas" },
        source: frame.contentWindow,
      }));
      const port = posted[0]!.ports[0]!;
      ports.push(port);
      const seen: Array<{ type?: string; key?: string; value?: unknown }> = [];
      mirrors.set(index, seen);
      port.onmessage = ({ data }: MessageEvent) => seen.push(data as never);
    });
    expect(new Set(ports).size).toBe(3);
    expect(listeners.size).toBe(3);

    const mirrorsOf = (index: number): unknown[] => mirrors.get(index)!
      .filter((message) => message.type === "pane:surface" && message.key === "surface:canvas")
      .map((message) => message.value);
    await until(() => [0, 1, 2].every((index) => mirrorsOf(index).length === 1));
    expect([0, 1, 2].map((index) => mirrorsOf(index)[0])).toEqual([{ revision: 1 }, { revision: 1 }, { revision: 1 }]);

    // 权威更新:三个独立端口各自收到同一镜像。
    canvasState = { revision: 2 };
    for (const listener of [...listeners]) listener(canvasState);
    await until(() => [0, 1, 2].every((index) => mirrorsOf(index).length === 2));

    // 关闭第一个实例:其订阅解除,其余端口继续收镜像,关闭端口静默。
    fireEvent.click(screen.getAllByRole("button", { name: "关闭 Canvas" })[0]!);
    expect(listeners.size).toBe(2);
    canvasState = { revision: 3 };
    for (const listener of [...listeners]) listener(canvasState);
    await until(() => [1, 2].every((index) => mirrorsOf(index).length === 3));
    expect(mirrorsOf(0)).toHaveLength(2);
    expect(mirrorsOf(1)[2]).toEqual({ revision: 3 });
    expect(mirrorsOf(2)[2]).toEqual({ revision: 3 });
  });
});
