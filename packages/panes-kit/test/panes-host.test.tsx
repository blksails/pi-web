// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { StrictMode } from "react";
import { definePanes, PANE_PROTOCOL_VERSION } from "../src/index.js";
import { PanesHost } from "../src/react/index.js";

beforeEach(() => {
  const values = new Map<string, string>();
  Object.defineProperty(window, "localStorage", {
    configurable: true,
    value: {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
      removeItem: (key: string) => values.delete(key),
      clear: () => values.clear(),
    },
  });
  Reflect.deleteProperty(window, "__TAURI__");
});

afterEach(() => {
  cleanup();
  Reflect.deleteProperty(window, "__TAURI__");
  vi.unstubAllGlobals();
});

/**
 * 录制宿主发给 iframe 的 `pane:connected`(含转移的 MessagePort)。
 *
 * ★ 必须在 **render 之前**装:宿主会在挂载时主动补连(见 PanesHost 的补连扫描——
 * `onLoad` 与 `pane:ready` 都可能被错过,故不能只靠它们)。render 之后再替换
 * `frame.contentWindow.postMessage` 就晚了,那条 `pane:connected` 已经发走。
 *
 * 装在 `HTMLIFrameElement.prototype.contentWindow` 的 getter 上,因此对「宿主何时建连」
 * 不敏感 —— 无论挂载即连、load 后连还是收到 ready 才连,都录得到。
 */
function recordFrameMessages(onPort?: (port: MessagePort) => void): {
  readonly posted: Array<{ message: unknown; ports: readonly MessagePort[] }>;
  restore(): void;
} {
  const posted: Array<{ message: unknown; ports: readonly MessagePort[] }> = [];
  const original = Object.getOwnPropertyDescriptor(
    HTMLIFrameElement.prototype,
    "contentWindow",
  );
  Object.defineProperty(HTMLIFrameElement.prototype, "contentWindow", {
    configurable: true,
    get(this: HTMLIFrameElement) {
      const win = original?.get?.call(this) as (Window & { __recorded?: true }) | null;
      if (win !== null && win !== undefined && win.__recorded !== true) {
        win.__recorded = true;
        (win as unknown as { postMessage: unknown }).postMessage = (
          message: unknown,
          _target: unknown,
          transfer?: readonly MessagePort[],
        ) => {
          posted.push({ message, ports: transfer ?? [] });
          // 端口随 pane:connected 同宏任务 transfer 出来；立即挂钩才能在缓冲窗内
          // 收到同段推的 pane:surface/pane:signal（jsdom 跨宏任务即丢）。
          for (const port of transfer ?? []) onPort?.(port);
        };
      }
      return win;
    },
  });
  return {
    posted,
    restore: () => {
      if (original !== undefined) {
        Object.defineProperty(HTMLIFrameElement.prototype, "contentWindow", original);
      }
    },
  };
}

/**
 * 把录制到的 `pane:connected`（含转移端口）整理成按 instanceId 实时查找的请求器。
 * 宿主 tabs 已移入 pane 内部边车，UI 行为测试改经 `workspace.*` 请求驱动。
 * 注意：open 产生的新实例在录制期间才有端口，故须每次请求实时查找，不能缓存 Map。
 */
function driveConnections(posted: ReadonlyArray<{ message: unknown; ports: readonly MessagePort[] }>): {
  readonly request: (instanceId: string, operation: string, payload?: Record<string, unknown>) => Promise<void>;
} {
  const portFor = (instanceId: string): MessagePort => {
    const port = [...posted].reverse().find((entry) =>
      (entry.message as { instance?: { instanceId?: string } }).instance?.instanceId === instanceId,
    )?.ports[0];
    if (port === undefined) throw new Error(`drive: no port for instance ${instanceId}`);
    return port;
  };
  const request = (
    instanceId: string,
    operation: string,
    payload: Record<string, unknown> = {},
  ): Promise<void> =>
    act(async () => {
      const port = portFor(instanceId);
      // 不设 onmessage：端口收集由 recordFrameMessages 的 onPort 独占，
      // 否则会覆盖它并吞掉 pane:surface/pane:signal 缓冲。
      port.postMessage({
        type: "pane:request",
        requestId: `${operation}-${Math.random().toString(36).slice(2, 8)}`,
        operation,
        ...payload,
      });
      // MessageChannel 端口消息在 jsdom 走任务队列，需跨宏任务让 host 侧收到并 flush。
      await new Promise((resolve) => setTimeout(resolve, 30));
    });
  return { request };
}

function framesOf(container: HTMLElement): HTMLIFrameElement[] {
  return [...container.querySelectorAll("iframe")];
}

function frameOrder(container: HTMLElement): string[] {
  return framesOf(container).map((frame) => frame.id);
}

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
  it("restores opted-in local pane order, duplicates and active tab", async () => {
    const persistenceKey = "test:panes";
    window.localStorage.setItem(`${persistenceKey}:workspace`, JSON.stringify({
      paneIds: ["editor", "editor"],
      activeIndex: 0,
    }));
    let sequence = 0;
    const recorder = recordFrameMessages();
    let view: ReturnType<typeof render>;
    try {
      view = render(<PanesHost
        definition={definition}
        config={{ interactionMode: "advanced", persistenceKey }}
        createInstanceId={(paneId) => `${paneId}-${++sequence}`}
      />);
    } finally {
      recorder.restore();
    }
    expect(framesOf(view.container)).toHaveLength(2);
    // active tab 已移入 pane 内部边车；宿主仅以 display 区分激活实例。
    expect(framesOf(view.container).filter((frame) => frame.style.display === "block")).toHaveLength(1);

    const drive = driveConnections(recorder.posted);
    await drive.request("editor-1", "workspace.close", { instanceId: "editor-1" });
    const persisted = JSON.parse(window.localStorage.getItem(`${persistenceKey}:workspace`)!);
    expect(persisted.paneIds).toEqual(["editor"]);
    expect(persisted.instanceIds).toEqual(["editor-2"]);
    expect(persisted.activeIndex).toBe(0);
  });

  it("restores persisted instance ids so native child WebViews can be reused", () => {
    const persistenceKey = "test:panes:instance-ids";
    window.localStorage.setItem(`${persistenceKey}:workspace`, JSON.stringify({
      paneIds: ["editor"],
      instanceIds: ["editor-native"],
      activeIndex: 0,
    }));
    const view = render(<PanesHost
      definition={definition}
      config={{ persistenceKey }}
    />);
    expect(view.container.querySelector("[id=\"pane-view-editor-native\"]")).not.toBeNull();
  });

  it("auto-selects an embedded Tauri WebView carrier without changing pane declarations", async () => {
    const created: Array<{
      label: string;
      url: string;
      x: number;
      y: number;
      width: number;
      height: number;
      visible?: boolean;
    }> = [];
    let closed = 0;
    const actions: string[] = [];
    const relayListeners = new Set<(event: { payload: unknown }) => void>();
    class FakeResizeObserver {
      observe(): void {}
      disconnect(): void {}
    }
    vi.stubGlobal("ResizeObserver", FakeResizeObserver);
    Object.defineProperty(window, "__TAURI__", {
      configurable: true,
      value: {
        core: {
          invoke: vi.fn(async (command: string, args?: Record<string, unknown>) => {
            if (command === "pane_webview_window_create") {
              created.push(args as typeof created[number]);
            }
            if (command === "pane_webview_window_control") {
              actions.push(String(args?.action));
              if (args?.action === "close") closed += 1;
            }
          }),
        },
        event: {
          listen: vi.fn(async (
            _event: string,
            listener: (event: { payload: unknown }) => void,
          ) => {
            relayListeners.add(listener);
            return () => relayListeners.delete(listener);
          }),
        },
        webview: {},
        window: { getCurrentWindow: () => ({
          innerPosition: async () => ({ x: 0, y: 0 }),
          scaleFactor: async () => 1,
          onMoved: async () => () => {},
        }) },
      },
    });

    const nativeDefinition = definePanes({
      ...definition,
      panes: definition.panes.map((pane) => ({
        ...pane,
        document: { kind: "html" as const, src: "https://panes.example/editor.html" },
      })),
    });
    const createInstanceId = (): string => "editor-native";
    const view = render(
      <StrictMode>
        <PanesHost
          definition={nativeDefinition}
          createInstanceId={createInstanceId}
          sessionId="session-a"
        />
      </StrictMode>,
    );
    expect(view.container.querySelector("iframe")).toBeNull();
    expect(view.container.querySelector('[data-pane-carrier="tauri-webview"]')).not.toBeNull();
    expect(screen.getByRole("status", { name: "正在加载Editor…" })).not.toBeNull();
    // 启动预热：content shell + overlay shell 可能先 create；内容以 URL 认 editor。
    await waitFor(() => {
      expect(
        created.some((c) => c.url.includes("editor.html") && c.url.includes("pi-pane-instance=editor-native")),
      ).toBe(true);
    });
    const editorCreate = created.find(
      (c) => c.url.includes("editor.html") && c.url.includes("pi-pane-instance=editor-native"),
    )!;
    // 预热池命中 → pane-warm-N；未命中 → pane-editor-native-N。
    expect(editorCreate.label).toMatch(/^pane-(warm|editor-native)-\d+$/);
    expect(editorCreate.url).toBe(
      "https://panes.example/editor.html?pi-pane-instance=editor-native&pi-pane-id=editor#pi-pane-instance=editor-native",
    );
    expect(editorCreate.visible).toBe(false);
    expect(editorCreate).toMatchObject({ x: 0, y: 0, width: 1, height: 1 });
    await act(async () => {
      for (const listener of relayListeners) {
        listener({
          payload: {
            instanceId: "editor-native",
            epoch: 0,
            message: { type: "pane:ready", protocol: PANE_PROTOCOL_VERSION, paneId: "editor" },
          },
        });
      }
      await Promise.resolve();
    });
    await waitFor(() => expect(actions).toContain("show"));
    expect(view.container.querySelector("iframe")).toBeNull();
    const createdAfterReady = created.length;
    expect(closed).toBe(0);

    view.rerender(
      <StrictMode>
        <PanesHost
          definition={nativeDefinition}
          createInstanceId={createInstanceId}
          sessionId="session-a"
        />
      </StrictMode>,
    );
    await act(async () => Promise.resolve());
    expect(created.length).toBe(createdAfterReady);
    expect(closed).toBe(0);

    view.rerender(
      <StrictMode>
        <PanesHost
          definition={nativeDefinition}
          createInstanceId={createInstanceId}
          sessionId="session-b"
        />
      </StrictMode>,
    );
    await waitFor(() => {
      const editors = created.filter(
        (c) => c.url.includes("editor.html") && c.url.includes("pi-pane-instance=editor-native"),
      );
      expect(editors.length).toBeGreaterThanOrEqual(2);
    });
    const editorCreates = created.filter(
      (c) => c.url.includes("editor.html") && c.url.includes("pi-pane-instance=editor-native"),
    );
    // 会话切换：第二枚 editor 文档导航（池回收 navigate 或冷建）。
    expect(editorCreates.at(-1)!.label).toMatch(/^pane-(warm|editor-native)-\d+$/);
    expect(view.container.querySelector("iframe")).toBeNull();
  });

  it("renders every declared pane in a Guest iframe", () => {
    const guest = definePanes({
      id: "guest-test",
      panes: [{
        id: "logs",
        title: "Logs",
        icon: "scroll-text",
        document: { kind: "inline", srcDoc: "" },
        capabilities: {},
      }],
    });
    const view = render(<PanesHost definition={guest} />);
    const frame = view.container.querySelector("iframe")!;
    expect(frame).not.toBeNull();
    // 边车 chrome 已随 srcDoc 注入 pane 内部（宿主不再渲染 tabs 图标）。
    expect(frame.getAttribute("srcdoc")).toContain("pi-pane-chrome");
  });

  it("opens three independent iframe instances and truly closes a tab (destroy, not park)", async () => {
    let sequence = 0;
    const recorder = recordFrameMessages();
    let view: ReturnType<typeof render>;
    try {
      view = render(<PanesHost
        definition={definition}
        config={{ interactionMode: "advanced" }}
        createInstanceId={(paneId) => `${paneId}-${++sequence}`}
      />);
      const drive = driveConnections(recorder.posted);
      await drive.request("editor-1", "workspace.open", { paneId: "editor" });
      await drive.request("editor-1", "workspace.open", { paneId: "editor" });
      const frames = framesOf(view.container);
      expect(frames).toHaveLength(3);
      expect(new Set(frames.map((frame) => frame.id)).size).toBe(3);
      // 新开置前（MRU），与旧 tabs 一致。
      expect(frameOrder(view.container)).toEqual(["pane-view-editor-3", "pane-view-editor-2", "pane-view-editor-1"]);
      // 关闭即销毁 iframe；不再收进「更多」。
      await drive.request("editor-3", "workspace.close", { instanceId: "editor-3" });
      expect(framesOf(view.container)).toHaveLength(2);
      expect(view.container.querySelector("#pane-view-editor-3")).toBeNull();
      // 再开创建新实例（新 instanceId），非复用已关 DOM。
      await drive.request("editor-2", "workspace.open", { paneId: "editor" });
      expect(framesOf(view.container)).toHaveLength(3);
      expect(view.container.querySelector("#pane-view-editor-4")).not.toBeNull();
      expect(frameOrder(view.container)[0]).toBe("pane-view-editor-4");
    } finally {
      recorder.restore();
    }
  });

  it("activates via workspace.activate, closes all to empty state and reopens", async () => {
    let sequence = 0;
    const recorder = recordFrameMessages();
    let view: ReturnType<typeof render>;
    try {
      view = render(<PanesHost
        definition={definition}
        config={{ interactionMode: "advanced" }}
        createInstanceId={(paneId) => `${paneId}-${++sequence}`}
      />);
      const drive = driveConnections(recorder.posted);
      await drive.request("editor-1", "workspace.open", { paneId: "editor" });
      await drive.request("editor-1", "workspace.open", { paneId: "editor" });
      // MRU:新打开的排最前,故 editor-3/2/1。
      expect(frameOrder(view.container)).toEqual(["pane-view-editor-3", "pane-view-editor-2", "pane-view-editor-1"]);

      // 切换:激活 editor-2,选中但不改变顺序(仅新开才置前)
      await drive.request("editor-3", "workspace.activate", { instanceId: "editor-2" });
      expect(frameOrder(view.container)).toEqual(["pane-view-editor-3", "pane-view-editor-2", "pane-view-editor-1"]);
      const frameById = (id: string): HTMLIFrameElement =>
        view.container.querySelector<HTMLIFrameElement>(`#pane-view-${id}`)!;
      expect(frameById("editor-2").style.display).toBe("block");
      expect(frameById("editor-1").style.display).toBe("none");

      // 逐个真关闭（用仍存活实例的 port）；全关后无 iframe。
      await drive.request("editor-2", "workspace.close", { instanceId: "editor-3" });
      await drive.request("editor-2", "workspace.close", { instanceId: "editor-1" });
      await drive.request("editor-2", "workspace.close", { instanceId: "editor-2" });
      expect(framesOf(view.container)).toHaveLength(0);
      // 空工作区入口 → 新开 Pane 弹层再建
      fireEvent.click(screen.getByRole("button", { name: "打开一个 Pane" }));
      fireEvent.click(screen.getByRole("button", { name: /Editor/i }));
      await waitFor(() => expect(framesOf(view.container)).toHaveLength(1));
      expect(view.container.querySelector("#pane-view-editor-4")).not.toBeNull();
    } finally {
      recorder.restore();
    }
  });

  it("refreshes the active pane via workspace.reload", async () => {
    const recorder = recordFrameMessages();
    let view: ReturnType<typeof render>;
    try {
      view = render(<PanesHost
        definition={definition}
        createInstanceId={() => "editor-refresh"}
      />);
    } finally {
      recorder.restore();
    }
    const drive = driveConnections(recorder.posted);
    const before = view.container.querySelector("iframe");
    await drive.request("editor-refresh", "workspace.reload", {});
    const after = view.container.querySelector("iframe");
    expect(after).not.toBe(before);
    expect(framesOf(view.container)).toHaveLength(1);
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
        downloads: true,
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
    const closeSidebar = vi.fn();
    const surface = {
      run,
      getState: <T,>(_key: string): T | undefined => ({ revision: 1 }) as T,
      subscribe: () => () => {},
      hasCommand: () => true,
    };
    const recorder = recordFrameMessages();
    const view = render(<PanesHost
      definition={protocolDefinition}
      baseUrl="/api"
      sessionId="s1"
      upload={upload}
      surface={surface}
      onRequestClose={closeSidebar}
      createInstanceId={(paneId) => `${paneId}-1`}
    />);
    recorder.restore();
    const posted = recorder.posted;
    const frame = view.container.querySelector("iframe")!;
    expect(frame.getAttribute("sandbox")).toContain("allow-downloads");
    // 收起钮在 child 边车内；宿主 content-well 满铺不再渲染顶栏 collapse。
    expect(view.container.querySelector("[data-pane-sidebar-collapse]")).toBeNull();
    // 宿主挂载即补连(不依赖 onLoad / pane:ready 是否被错过),故此处已有且仅有一条。
    expect(posted).toHaveLength(1);
    expect(posted[0]!.message).toMatchObject({
      type: "pane:connected",
      protocol: PANE_PROTOCOL_VERSION,
      instance: { instanceId: "uploader-1", paneId: "uploader", epoch: 1 },
    });
    // guest 重挂后同 epoch 再发 ready;host 必须废弃旧通道并重建。
    // ★ recorder.restore() 只还原 prototype 上的 contentWindow getter,已被替换过的那个
    //   window 的 postMessage 仍是录制版,故 restore 之后发生的 postMessage 照样记进 posted。
    window.dispatchEvent(new MessageEvent("message", {
      data: { type: "pane:ready", protocol: PANE_PROTOCOL_VERSION, paneId: "uploader" },
      source: view!.container.querySelector("iframe")!.contentWindow,
    }));
    expect(posted).toHaveLength(2);
    const port = posted[1]!.ports[0]!;
    const results: Array<{ type?: string; requestId?: string; key?: string; value?: unknown }> = [];
    port.onmessage = ({ data }: MessageEvent) => results.push(data as never);
    // 边车 workspace.collapse → 宿主 onRequestClose
    port.postMessage({
      type: "pane:request",
      requestId: "collapse-1",
      operation: "workspace.collapse",
    });
    await until(() => closeSidebar.mock.calls.length === 1);
    expect(closeSidebar).toHaveBeenCalledOnce();

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
    // 录制必须覆盖「挂载 + 两次新开」的全过程:宿主对每个实例都是挂载即补连。
      const recorder = recordFrameMessages((port) => {
        mirrors.set(port, []);
        ports.push(port);
        port.onmessage = ({ data }: MessageEvent) => mirrors.get(port)!.push(data as never);
      });
      const mirrors = new Map<MessagePort, Array<{ type?: string; key?: string; value?: unknown }>>();
      const ports: MessagePort[] = [];
      let view: ReturnType<typeof render>;
      try {
        view = render(<PanesHost
          definition={canvasDefinition}
          surface={surface}
          workspaceDomain={false}
          createInstanceId={(paneId) => `${paneId}-${++sequence}`}
        />);
        const drive = driveConnections(recorder.posted);
        await drive.request("canvas-1", "workspace.open", { paneId: "canvas" });
        await drive.request("canvas-1", "workspace.open", { paneId: "canvas" });
        expect(framesOf(view.container)).toHaveLength(3);
        // 三个实例各拿到一条 pane:connected + 一个**独立**端口(F3:互不串扰)。
        expect(recorder.posted).toHaveLength(3);
        expect(new Set(ports).size).toBe(3);
        expect(listeners.size).toBe(3);

        const mirrorsOf = (index: number): unknown[] => mirrors.get(ports[index]!)!
          .filter((message) => message.type === "pane:surface" && message.key === "surface:canvas")
          .map((message) => message.value);
        await until(() => [0, 1, 2].every((index) => mirrorsOf(index).length === 1));
      expect([0, 1, 2].map((index) => mirrorsOf(index)[0])).toEqual([{ revision: 1 }, { revision: 1 }, { revision: 1 }]);

      // 权威更新:三个独立端口各自收到同一镜像。
      canvasState = { revision: 2 };
      for (const listener of [...listeners]) listener(canvasState);
      await until(() => [0, 1, 2].every((index) => mirrorsOf(index).length === 2));

      // 关闭 tab = 真销毁：surface 订阅随之卸下，仅存活实例继续收镜像。
      await drive.request("canvas-1", "workspace.close", { instanceId: "canvas-3" });
      expect(framesOf(view.container)).toHaveLength(2);
      expect(listeners.size).toBe(2);
      canvasState = { revision: 3 };
      for (const listener of [...listeners]) listener(canvasState);
      await until(() => [0, 1].every((index) => mirrorsOf(index).length === 3));
      expect(mirrorsOf(0)[2]).toEqual({ revision: 3 });
      expect(mirrorsOf(1)[2]).toEqual({ revision: 3 });
      // 已关实例端口不再追加
      expect(mirrorsOf(2).length).toBe(2);
    } finally {
      recorder.restore();
    }
  });

  it("★ 宿主具名信号:握手即全量下推、变更只推变的、未变不推(pane:signal)", async () => {
    // 信号搬运的是**只存在于宿主 realm** 的东西(主题类、宿主 chrome 点击)——
    // 它们既不属于 agent 权威快照(那走 surfaceKeys),pane 自己也观察不到(iframe 独立 document)。
    const signalDefinition = definePanes({
      id: "signal-test",
      initialPaneIds: ["p"],
      panes: [{
        id: "p",
        title: "P",
        document: { kind: "inline", srcDoc: "<!doctype html><p>p</p>" },
        capabilities: {},
        allowMultiple: false,
        maxInstances: 1,
        lifecycle: {},
      }],
    });

    const recorder = recordFrameMessages();
    let view: ReturnType<typeof render>;
    try {
      view = render(<PanesHost
        definition={signalDefinition}
        signals={{ "theme:dark": true }}
        createInstanceId={(paneId) => `${paneId}-1`}
      />);
    } finally {
      recorder.restore();
    }
    const port = recorder.posted[0]!.ports[0]!;
    const seen: Array<{ type?: string; name?: string; value?: unknown }> = [];
    port.onmessage = ({ data }: MessageEvent) => seen.push(data as never);
    const signalsSeen = (): Array<{ name?: string; value?: unknown }> =>
      seen.filter((m) => m.type === "pane:signal" && m.name !== "pi.workspace");

    // ★ 握手时即下推当前值:pane 首帧就该是对的,而不是先渲染错再纠正
    //   (主题若靠「等下一次变更」,暗色宿主下会先亮一下)。
    await until(() => signalsSeen().length === 1);
    expect(signalsSeen()[0]).toMatchObject({ name: "theme:dark", value: true });

    // 变更 → 只推变了的 key。theme 未变,不该重推。
    view!.rerender(<PanesHost
      definition={signalDefinition}
      signals={{ "theme:dark": true, "canvas:focus": "att_x#1" }}
      createInstanceId={(paneId) => `${paneId}-1`}
    />);
    await until(() => signalsSeen().length === 2);
    expect(signalsSeen()[1]).toMatchObject({ name: "canvas:focus", value: "att_x#1" });

    // 同值再渲染 → 一条都不推(否则 pane 侧订阅者会收到大量无变化回调并直接 setState)。
    view!.rerender(<PanesHost
      definition={signalDefinition}
      signals={{ "theme:dark": true, "canvas:focus": "att_x#1" }}
      createInstanceId={(paneId) => `${paneId}-1`}
    />);
    await new Promise((r) => setTimeout(r, 30));
    expect(signalsSeen()).toHaveLength(2);
  });

  it("仅向获订阅授权的 pane 中继事件，并按宿主映射激活目标 pane", async () => {
    const eventDefinition = definePanes({
      id: "event-test",
      initialPaneIds: ["materials", "canvas"],
      panes: [
        {
          id: "materials",
          title: "Materials",
          document: { kind: "inline", srcDoc: "<!doctype html><p>materials</p>" },
          capabilities: { events: { publish: ["aigc.canvas.import"] } },
        },
        {
          id: "canvas",
          title: "Canvas",
          document: { kind: "inline", srcDoc: "<!doctype html><p>canvas</p>" },
          capabilities: { events: { subscribe: ["aigc.canvas.import"] } },
        },
      ],
    });
    let sequence = 0;
    const onEvent = vi.fn(() => true);
    const view = render(<PanesHost
      definition={eventDefinition}
      config={{ eventTargets: { "aigc.canvas.import": "canvas" } }}
      onEvent={onEvent}
      createInstanceId={(paneId) => `${paneId}-${++sequence}`}
    />);
    const frames = [...view.container.querySelectorAll("iframe")];
    const ports = new Map<string, MessagePort>();
    for (const frame of frames) {
      const paneId = frame.title.toLowerCase();
      const posted: Array<{ ports: readonly MessagePort[] }> = [];
      frame.contentWindow!.postMessage = ((_message: unknown, _target: unknown, transfer?: readonly MessagePort[]) => {
        posted.push({ ports: transfer ?? [] });
      }) as unknown as typeof window.postMessage;
      window.dispatchEvent(new MessageEvent("message", {
        data: { type: "pane:ready", protocol: PANE_PROTOCOL_VERSION, paneId },
        source: frame.contentWindow,
      }));
      ports.set(paneId, posted[0]!.ports[0]!);
    }
    const sourceResults: Array<Record<string, unknown>> = [];
    const targetMessages: Array<Record<string, unknown>> = [];
    ports.get("materials")!.onmessage = ({ data }: MessageEvent) => sourceResults.push(data as never);
    ports.get("canvas")!.onmessage = ({ data }: MessageEvent) => targetMessages.push(data as never);

    await act(async () => {
      ports.get("materials")!.postMessage({
        type: "pane:request",
        requestId: "event-ok",
        operation: "event.publish",
        topic: "aigc.canvas.import",
        payload: { attachmentIds: ["att_1"] },
      });
      await until(() =>
        sourceResults.some((message) => message.requestId === "event-ok")
        && targetMessages.some((message) => message.type === "pane:event"));
    });

    expect(sourceResults.find((message) => message.requestId === "event-ok")).toMatchObject({
      ok: true,
      data: { delivered: 2 },
    });
    expect(onEvent).toHaveBeenCalledWith("aigc.canvas.import", { attachmentIds: ["att_1"] });
    expect(targetMessages.find((message) => message.type === "pane:event")).toEqual({
      type: "pane:event",
      topic: "aigc.canvas.import",
      payload: { attachmentIds: ["att_1"] },
      source: { instanceId: "materials-1", paneId: "materials" },
    });
    // 事件按宿主映射激活目标 pane：canvas 显示。
    const canvasFrame = view.container.querySelector<HTMLIFrameElement>("#pane-view-canvas-2")!;
    expect(canvasFrame.style.display).toBe("block");

    view.rerender(<PanesHost
      definition={eventDefinition}
      config={{ eventTargets: { "aigc.canvas.import": "canvas" } }}
      onEvent={onEvent}
      hostEvent={{
        id: 1,
        topic: "aigc.canvas.import",
        payload: { attachmentIds: ["att_host"] },
      }}
      createInstanceId={(paneId) => `${paneId}-${++sequence}`}
    />);
    await until(() => targetMessages.some(
      (message) =>
        message.type === "pane:event" &&
        (message.payload as { attachmentIds?: string[] } | undefined)?.attachmentIds?.[0] ===
          "att_host",
    ));
    expect(targetMessages.find(
      (message) =>
        message.type === "pane:event" &&
        (message.payload as { attachmentIds?: string[] } | undefined)?.attachmentIds?.[0] ===
          "att_host",
    )).toEqual({
      type: "pane:event",
      topic: "aigc.canvas.import",
      payload: { attachmentIds: ["att_host"] },
      source: { instanceId: "host", paneId: "host" },
    });

    ports.get("materials")!.postMessage({
      type: "pane:request",
      requestId: "event-denied",
      operation: "event.publish",
      topic: "admin.delete",
    });
    await until(() => sourceResults.some((message) => message.requestId === "event-denied"));
    expect(sourceResults.find((message) => message.requestId === "event-denied")).toMatchObject({
      ok: false,
      error: { code: "CAPABILITY_DENIED" },
    });
  });
});

/**
 * workspace 与 definition 的同步(spec panes-workspace-definition-sync 任务 4.1)。
 *
 * 缺陷本体是**竞态**:清单异步补齐时 workspace 已按首帧的不完整清单定型,且被写进持久化快照
 * 自我固化。排查期间曾出现「新建会话偶然全开、reload 又打回」——所以这里的时序一律用
 * `rerender` 显式构造,不依赖任何真实网络时机或定时器,否则测试本身也会时绿时红。
 */
const HOST_PANE_ID = "host:session-info";

function syncPane(id: string, title: string): Parameters<typeof definePanes>[0]["panes"][number] {
  return {
    id,
    title,
    document: { kind: "inline", srcDoc: `<!doctype html><p>${id}</p>` },
    capabilities: {},
  };
}

/** 首帧形态:清单尚未补齐,只有宿主内置 pane。 */
const hostOnlyDefinition = definePanes({
  id: "host-merged",
  maxOpenPanes: 8,
  panes: [syncPane(HOST_PANE_ID, "会话信息")],
});

/** 补齐后形态:agent 声明的两个 pane 到位,且声明为初始打开。 */
const fullDefinition = definePanes({
  id: "host-merged",
  maxOpenPanes: 8,
  initialPaneIds: ["alpha", "beta"],
  panes: [syncPane(HOST_PANE_ID, "会话信息"), syncPane("alpha", "Alpha"), syncPane("beta", "Beta")],
});

const openFrameCount = (container: HTMLElement): number => framesOf(container).length;

describe("PanesHost workspace ↔ definition 同步", () => {
  it("清单在首帧之后才补齐时,声明为初始打开的 pane 被补开", () => {
    const view = render(<PanesHost definition={hostOnlyDefinition} config={{}} />);
    // 首帧:清单里只有内置 pane,回退到 panes[0]。
    expect(openFrameCount(view.container)).toBe(1);

    // ★ 时序由 rerender 显式构造 —— 这正是真实场景里 webext 异步到达的那一刻。
    view.rerender(<PanesHost definition={fullDefinition} config={{}} />);

    expect(openFrameCount(view.container)).toBe(3);
  });

  it("可确证被污染的旧格式快照被纠正,并写回带 knownPaneIds 的新快照", () => {
    const persistenceKey = "test:panes:polluted";
    // 旧格式:没有 knownPaneIds。内容正是缺陷的产物——只剩宿主内置 pane。
    window.localStorage.setItem(`${persistenceKey}:workspace`, JSON.stringify({
      paneIds: [HOST_PANE_ID],
      activeIndex: 0,
    }));

    const view = render(<PanesHost definition={fullDefinition} config={{ persistenceKey }} />);

    expect(openFrameCount(view.container)).toBe(2);
    // 纠正后写回新格式,故下次进入不会再触发纠正(Req 3.2)。
    const persisted = JSON.parse(window.localStorage.getItem(`${persistenceKey}:workspace`)!);
    expect(persisted.knownPaneIds).toEqual([HOST_PANE_ID, "alpha", "beta"]);
  });

  it("与清单相称的快照原样沿用,不因纠正而丢弃用户布局", () => {
    const persistenceKey = "test:panes:intact";
    window.localStorage.setItem(`${persistenceKey}:workspace`, JSON.stringify({
      paneIds: ["beta", "alpha"],
      instanceIds: ["beta-kept", "alpha-kept"],
      knownPaneIds: [HOST_PANE_ID, "alpha", "beta"],
      activeIndex: 0,
    }));

    const view = render(<PanesHost definition={fullDefinition} config={{ persistenceKey }} />);

    // 用户自己排的顺序(beta 在前)必须原样保留。
    expect(frameOrder(view.container)).toEqual(["pane-view-beta-kept", "pane-view-alpha-kept"]);
    // instanceId 也原样复用 —— 桌面形态下这决定 WebView 是否被重建。
    expect(view.container.querySelector('[id="pane-view-beta-kept"]')).not.toBeNull();
  });

  it("用户关掉的 pane 重新进入后保持关闭", () => {
    const persistenceKey = "test:panes:user-closed";
    // knownPaneIds 里有 beta 而 paneIds 里没有 ⇒ 只能是用户主动关掉的。
    window.localStorage.setItem(`${persistenceKey}:workspace`, JSON.stringify({
      paneIds: ["alpha"],
      knownPaneIds: [HOST_PANE_ID, "alpha", "beta"],
      activeIndex: 0,
    }));

    const view = render(<PanesHost definition={fullDefinition} config={{ persistenceKey }} />);

    expect(openFrameCount(view.container)).toBe(1);
    // 未持久化 instanceIds 时按 paneId 生成（带随机后缀）。
    expect(frameOrder(view.container)[0]!.startsWith("pane-view-alpha")).toBe(true);
  });

  it("首帧清单即完整时行为与修复前一致", () => {
    const view = render(<PanesHost definition={fullDefinition} config={{}} />);
    expect(openFrameCount(view.container)).toBe(2);

    // 同一份 definition 再渲染一次不得产生任何变化(reconcile 应返回同一引用而跳过 setState)。
    view.rerender(<PanesHost definition={fullDefinition} config={{}} />);
    expect(openFrameCount(view.container)).toBe(2);
  });
});

