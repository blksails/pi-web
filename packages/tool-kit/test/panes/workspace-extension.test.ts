import { describe, expect, it, vi } from "vitest";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { AttachmentToolContext } from "@blksails/pi-web-agent-kit";
import type { PaneWorkspaceReport, PanesWorkspaceSnapshot } from "@blksails/pi-web-panes-kit/workspace-protocol";
import { makePanesWorkspaceExtension } from "../../src/panes/workspace-extension.js";
import type { CreateSurfaceDeps } from "../../src/surface/create-surface.js";
import type { SessionStateAccess } from "../../src/session-state.js";
import { getSurfaceRegistry } from "../../src/surface/surface-registry.js";

interface RegisteredTool {
  name: string;
  execute(id: string, params: Record<string, unknown>): Promise<{ content: Array<{ type: string; text: string }> }>;
}

const UNAVAILABLE_ATT: AttachmentToolContext = {
  available: false,
  async resolve() { throw new Error("unavailable"); },
  async putOutput() { throw new Error("unavailable"); },
  async publish() { throw new Error("unavailable"); },
  async listBySession() { throw new Error("unavailable"); },
  async getMeta() { throw new Error("unavailable"); },
  async setMeta() { throw new Error("unavailable"); },
};

function makeHarness(reportTimeoutMs: number) {
  const scope: Record<string, unknown> = {};
  const store = new Map<string, unknown>();
  const state: SessionStateAccess = {
    available: true,
    get: <T,>(key: string) => store.get(key) as T | undefined,
    set: (key, value) => { store.set(key, value); },
    delete: (key) => { store.delete(key); },
    snapshot: () => Object.fromEntries(store),
  };
  const deps: CreateSurfaceDeps = {
    scope,
    getSessionState: () => state,
    getSurfaceRegistry: (s) => getSurfaceRegistry(s ?? scope),
    getAttachmentToolContext: () => UNAVAILABLE_ATT,
    schedule: (fn) => fn(),
  };
  const tools = new Map<string, RegisteredTool>();
  const pi = {
    registerCommand: vi.fn(),
    registerTool: vi.fn((tool: RegisteredTool) => { tools.set(tool.name, tool); }),
  } as unknown as ExtensionAPI;
  makePanesWorkspaceExtension({ reportTimeoutMs, surfaceDeps: deps })(pi);
  const snapshot = (): PanesWorkspaceSnapshot => store.get("surface:panes-workspace") as PanesWorkspaceSnapshot;
  const dispatchReport = (report: unknown) =>
    getSurfaceRegistry(scope).get("panes-workspace")!.dispatch("report", report);
  const parse = (result: { content: Array<{ type: string; text: string }> }): Record<string, unknown> =>
    JSON.parse(result.content[0]!.text) as Record<string, unknown>;
  return { tools, snapshot, dispatchReport, parse };
}

const REPORT: PaneWorkspaceReport = {
  appliedOpId: 1,
  activeInstanceId: "files-2",
  panes: [{ paneId: "files", title: "Files", openCount: 2, maxInstances: 3, allowMultiple: true }],
  instances: [
    { instanceId: "files-1", paneId: "files", epoch: 1, state: "hidden" },
    { instanceId: "files-2", paneId: "files", epoch: 1, state: "connecting" },
  ],
};

describe("panesWorkspaceExtension", () => {
  it("registers the five pane tools and the workspace surface", () => {
    const harness = makeHarness(0);
    expect([...harness.tools.keys()].sort()).toEqual([
      "pane_activate", "pane_close", "pane_list", "pane_open", "pane_reload",
    ]);
    expect(harness.snapshot()).toEqual({ revision: 0, ops: [] });
  });

  it("pane_open appends an op to the snapshot and resolves once the UI reports", async () => {
    const harness = makeHarness(1_000);
    const pending = harness.tools.get("pane_open")!.execute("t1", { paneId: "files" });
    expect(harness.snapshot().ops).toEqual([{ opId: 1, type: "open", paneId: "files" }]);
    await harness.dispatchReport(REPORT);
    const result = harness.parse(await pending);
    expect(result["applied"]).toBe(true);
    expect((result["workspace"] as PaneWorkspaceReport).activeInstanceId).toBe("files-2");
    // 回声写回快照 report 字段。
    expect(harness.snapshot().report?.appliedOpId).toBe(1);
  });

  it("pane_open degrades gracefully when no UI echo arrives in time", async () => {
    const harness = makeHarness(20);
    const result = harness.parse(await harness.tools.get("pane_open")!.execute("t1", { paneId: "files" }));
    expect(result["applied"]).toBe(false);
    expect(String(result["note"])).toContain("pane_list");
  });

  it("pane_list reflects the latest echo and pending ops", async () => {
    const harness = makeHarness(0);
    const before = harness.parse(await harness.tools.get("pane_list")!.execute("t1", {}));
    expect(before["connected"]).toBe(false);
    await harness.tools.get("pane_open")!.execute("t2", { paneId: "files" });
    await harness.dispatchReport(REPORT);
    const after = harness.parse(await harness.tools.get("pane_list")!.execute("t3", {}));
    expect(after["connected"]).toBe(true);
    expect(after["pendingOpIds"]).toEqual([]);
  });

  it("target tools require instanceId or paneId and ops window stays bounded", async () => {
    const harness = makeHarness(0);
    const bad = harness.parse(await harness.tools.get("pane_close")!.execute("t1", {}));
    expect(bad["error"]).toBe("instanceId or paneId is required");
    for (let i = 0; i < 40; i += 1) {
      await harness.tools.get("pane_open")!.execute(`t${i}`, { paneId: "files" });
    }
    expect(harness.snapshot().ops).toHaveLength(32);
    expect(harness.snapshot().ops.at(-1)?.opId).toBe(40);
  });

  it("rejects malformed reports with a stable error code", async () => {
    const harness = makeHarness(0);
    const result = await harness.dispatchReport({ nope: true });
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("invalid_report");
  });
});
