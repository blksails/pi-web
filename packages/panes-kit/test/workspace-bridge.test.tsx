// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { act, cleanup, render, waitFor } from "@testing-library/react";
import { definePanes, PANES_WORKSPACE_DOMAIN, type PanesWorkspaceSnapshot } from "../src/index.js";
import { PanesHost, type PanesSurfaceAccess } from "../src/react/index.js";

afterEach(cleanup);

const definition = definePanes({
  id: "bridge-test",
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

const KEY = `surface:${PANES_WORKSPACE_DOMAIN}`;

interface FakeSurface {
  surface: PanesSurfaceAccess;
  runs: Array<{ domain: string; action: string; args: unknown }>;
  push(snapshot: PanesWorkspaceSnapshot): void;
}

function makeSurface(): FakeSurface {
  const states = new Map<string, unknown>();
  const listeners = new Map<string, Set<(value: unknown) => void>>();
  const runs: FakeSurface["runs"] = [];
  return {
    surface: {
      run: async (domain, action, args) => {
        runs.push({ domain, action, args });
        return { domain, action, ok: true };
      },
      getState: <T,>(key: string) => states.get(key) as T | undefined,
      subscribe: (key, listener) => {
        const set = listeners.get(key) ?? new Set();
        set.add(listener);
        listeners.set(key, set);
        return () => set.delete(listener);
      },
      hasCommand: () => true,
    },
    runs,
    push(snapshot) {
      states.set(KEY, snapshot);
      for (const listener of listeners.get(KEY) ?? []) listener(snapshot);
    },
  };
}

function lastReport(runs: FakeSurface["runs"]): { appliedOpId: number; instances: unknown[] } {
  const reports = runs.filter((run) => run.domain === PANES_WORKSPACE_DOMAIN && run.action === "report");
  expect(reports.length).toBeGreaterThan(0);
  return reports[reports.length - 1]!.args as { appliedOpId: number; instances: unknown[] };
}

describe("PanesHost workspace bridge", () => {
  it("baselines the first snapshot without replaying, then applies incremental ops and echoes reports", async () => {
    const fake = makeSurface();
    let sequence = 0;
    const view = render(<PanesHost
      definition={definition}
      surface={fake.surface}
      createInstanceId={(paneId) => `${paneId}-${++sequence}`}
    />);

    // 首帧含历史 op:仅取基线,不重放 → 仍只有初始 1 个 iframe。
    act(() => fake.push({ revision: 1, ops: [{ opId: 5, type: "open", paneId: "editor" }] }));
    expect(view.container.querySelectorAll("iframe")).toHaveLength(1);
    await waitFor(() => {
      const report = lastReport(fake.runs);
      expect(report.appliedOpId).toBe(5);
      expect(report.instances).toHaveLength(1);
    });

    // 增量 open op → 新开一个实例并回声。
    act(() => fake.push({
      revision: 2,
      ops: [
        { opId: 5, type: "open", paneId: "editor" },
        { opId: 6, type: "open", paneId: "editor" },
      ],
    }));
    expect(view.container.querySelectorAll("iframe")).toHaveLength(2);
    await waitFor(() => {
      const report = lastReport(fake.runs);
      expect(report.appliedOpId).toBe(6);
      expect(report.instances).toHaveLength(2);
    });

    // close by paneId → 关掉该 pane 首个实例。
    act(() => fake.push({
      revision: 3,
      ops: [
        { opId: 6, type: "open", paneId: "editor" },
        { opId: 7, type: "close", paneId: "editor" },
      ],
    }));
    expect(view.container.querySelectorAll("iframe")).toHaveLength(1);
    await waitFor(() => expect(lastReport(fake.runs).appliedOpId).toBe(7));
  });

  it("re-baselines when opIds regress (agent restart) instead of replaying stale state", async () => {
    const fake = makeSurface();
    let sequence = 0;
    const view = render(<PanesHost
      definition={definition}
      surface={fake.surface}
      createInstanceId={(paneId) => `${paneId}-${++sequence}`}
    />);
    act(() => fake.push({ revision: 1, ops: [{ opId: 9, type: "open", paneId: "editor" }] }));
    // agent 重启:opId 回退 → 再基线,不应用。
    act(() => fake.push({ revision: 2, ops: [{ opId: 1, type: "open", paneId: "editor" }] }));
    expect(view.container.querySelectorAll("iframe")).toHaveLength(1);
    // 重启后的增量 op 正常应用。
    act(() => fake.push({
      revision: 3,
      ops: [
        { opId: 1, type: "open", paneId: "editor" },
        { opId: 2, type: "open", paneId: "editor" },
      ],
    }));
    expect(view.container.querySelectorAll("iframe")).toHaveLength(2);
    await waitFor(() => expect(lastReport(fake.runs).appliedOpId).toBe(2));
  });

  it("reports the pane catalog and user-driven workspace changes", async () => {
    const fake = makeSurface();
    let sequence = 0;
    render(<PanesHost
      definition={definition}
      surface={fake.surface}
      createInstanceId={(paneId) => `${paneId}-${++sequence}`}
    />);
    act(() => fake.push({ revision: 1, ops: [] }));
    await waitFor(() => {
      const report = fake.runs.at(-1)!.args as {
        panes: Array<{ paneId: string; openCount: number; maxInstances: number; allowMultiple: boolean }>;
        activeInstanceId?: string;
      };
      expect(report.panes).toEqual([
        { paneId: "editor", title: "Editor", openCount: 1, maxInstances: 3, allowMultiple: true },
      ]);
      expect(report.activeInstanceId).toBe("editor-1");
    });
  });

  it("stays silent without a snapshot and ignores malformed snapshots", () => {
    const fake = makeSurface();
    const view = render(<PanesHost definition={definition} surface={fake.surface} />);
    act(() => fake.push({ revision: 1, ops: [{ opId: 0, type: "open", paneId: "editor" }] } as unknown as PanesWorkspaceSnapshot));
    expect(view.container.querySelectorAll("iframe")).toHaveLength(1);
    expect(fake.runs).toHaveLength(0);
  });
});
