import { beforeEach, describe, expect, it, vi } from "vitest";
import { paneDataHandler } from "../examples/panes-agent/routes/pane-data.js";
import {
  getPanesSnapshot,
  inspectPanesForLlm,
  resetPanesForTests,
  setPanesPublisher,
} from "../examples/panes-agent/panes-state.js";

describe("panes-agent data plane", () => {
  beforeEach(() => resetPanesForTests());

  it("writes through Agent Route and publishes the same authoritative revision", () => {
    const publish = vi.fn();
    const dispose = setPanesPublisher(publish);
    const result = paneDataHandler({
      name: "pane-data",
      method: "POST",
      query: {},
      body: {
        paneId: "editor",
        operation: "write-file",
        expectedRevision: 0,
        payload: { path: "src/main.ts", content: "export const answer = 42;\n" },
      },
    }) as { ok: boolean; revision: number };

    expect(result).toEqual({ ok: true, revision: 1, version: 2 });
    expect(getPanesSnapshot()).toMatchObject({
      revision: 1,
      changes: [{ revision: 1, paneId: "editor", summary: "updated src/main.ts" }],
    });
    expect(inspectPanesForLlm()).toMatchObject({
      revision: 1,
      files: expect.arrayContaining([
        expect.objectContaining({ path: "src/main.ts", preview: "export const answer = 42;\n" }),
      ]),
    });
    expect(inspectPanesForLlm("src/main.ts")).toMatchObject({
      requestedFile: { path: "src/main.ts", content: "export const answer = 42;\n" },
    });
    expect(publish).toHaveBeenLastCalledWith(expect.objectContaining({ revision: 1 }));
    dispose();
  });

  it("rejects stale writes and keeps the current revision", () => {
    const result = paneDataHandler({
      name: "pane-data",
      method: "POST",
      query: {},
      body: {
        paneId: "files",
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

  it("keeps the diff pane read-only", () => {
    expect(paneDataHandler({
      name: "pane-data",
      method: "POST",
      query: {},
      body: { paneId: "diff", operation: "write-file", payload: {} },
    })).toEqual({ ok: false, error: "operation is not allowed for this pane" });
  });

  it("rejects executable markup in file paths", () => {
    expect(paneDataHandler({
      name: "pane-data",
      method: "POST",
      query: {},
      body: {
        paneId: "files",
        operation: "add-file",
        payload: { path: "<img-onerror>.md" },
      },
    })).toEqual({ ok: false, error: "path must be a safe non-empty string" });
  });

  it("supports an artifact lifecycle through the same revisioned Agent Route", () => {
    const created = paneDataHandler({
      name: "pane-data",
      method: "POST",
      query: {},
      body: {
        paneId: "artifact",
        operation: "create-artifact",
        expectedRevision: 0,
        payload: { title: "Release note", body: "Ready for review." },
      },
    }) as { ok: boolean; revision: number; artifactId: string };
    expect(created).toMatchObject({ ok: true, revision: 1 });

    expect(paneDataHandler({
      name: "pane-data",
      method: "POST",
      query: {},
      body: {
        paneId: "artifact",
        operation: "set-artifact-status",
        expectedRevision: 1,
        payload: { artifactId: created.artifactId, status: "published" },
      },
    })).toEqual({ ok: true, revision: 2 });
    expect(inspectPanesForLlm()).toMatchObject({
      revision: 2,
      artifacts: expect.arrayContaining([
        expect.objectContaining({ id: created.artifactId, status: "published" }),
      ]),
    });
  });
});
