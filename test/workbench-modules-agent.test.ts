import { beforeEach, describe, expect, it, vi } from "vitest";
import { workbenchDataHandler } from "../examples/workbench-modules-agent/routes/workbench-data.js";
import {
  getWorkbenchSnapshot,
  inspectWorkbenchForLlm,
  resetWorkbenchForTests,
  setWorkbenchPublisher,
} from "../examples/workbench-modules-agent/workbench-state.js";

describe("workbench-modules-agent data plane", () => {
  beforeEach(() => resetWorkbenchForTests());

  it("writes through Agent Route and publishes the same authoritative revision", () => {
    const publish = vi.fn();
    const dispose = setWorkbenchPublisher(publish);
    const result = workbenchDataHandler({
      name: "workbench-data",
      method: "POST",
      query: {},
      body: {
        moduleId: "editor",
        operation: "write-file",
        expectedRevision: 0,
        payload: { path: "src/main.ts", content: "export const answer = 42;\n" },
      },
    }) as { ok: boolean; revision: number };

    expect(result).toEqual({ ok: true, revision: 1, version: 2 });
    expect(getWorkbenchSnapshot()).toMatchObject({
      revision: 1,
      changes: [{ revision: 1, moduleId: "editor", summary: "updated src/main.ts" }],
    });
    expect(inspectWorkbenchForLlm()).toMatchObject({
      revision: 1,
      files: expect.arrayContaining([
        expect.objectContaining({ path: "src/main.ts", preview: "export const answer = 42;\n" }),
      ]),
    });
    expect(inspectWorkbenchForLlm("src/main.ts")).toMatchObject({
      requestedFile: { path: "src/main.ts", content: "export const answer = 42;\n" },
    });
    expect(publish).toHaveBeenLastCalledWith(expect.objectContaining({ revision: 1 }));
    dispose();
  });

  it("rejects stale writes and keeps the current revision", () => {
    const result = workbenchDataHandler({
      name: "workbench-data",
      method: "POST",
      query: {},
      body: {
        moduleId: "files",
        operation: "add-file",
        expectedRevision: 99,
        payload: { path: "notes.md" },
      },
    });
    expect(result).toEqual({
      ok: false,
      error: "revision conflict: expected 99, current 0",
      revision: 0,
    });
  });

  it("keeps the diff module read-only", () => {
    expect(workbenchDataHandler({
      name: "workbench-data",
      method: "POST",
      query: {},
      body: { moduleId: "diff", operation: "write-file", payload: {} },
    })).toEqual({ ok: false, error: "operation is not allowed for this module" });
  });

  it("rejects executable markup in file paths", () => {
    expect(workbenchDataHandler({
      name: "workbench-data",
      method: "POST",
      query: {},
      body: {
        moduleId: "files",
        operation: "add-file",
        payload: { path: "<img-onerror>.md" },
      },
    })).toEqual({ ok: false, error: "path must be a safe non-empty string" });
  });
});
