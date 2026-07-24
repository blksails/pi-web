import { describe, expect, it } from "vitest";
import {
  PaneGuestRequestSchema,
  authorizePaneRequest,
  createPaneWorkspace,
  definePanes,
  PaneHostError,
  reducePaneWorkspace,
  type PaneCapabilities,
} from "../src/index.js";

const capabilities: PaneCapabilities = {
  routes: [{ name: "data", methods: ["GET", "POST"], maxRequestBytes: 1024 }],
  surfaceKeys: ["surface:canvas"],
  surfaceCommands: [{ domain: "canvas", actions: ["sync"] }],
  attachments: "read-write",
  conversation: "submit",
};

const definition = definePanes({
  id: "test",
  initialPaneIds: ["editor", "canvas"],
  maxOpenPanes: 5,
  panes: [
    {
      id: "editor",
      title: "Editor",
      document: { kind: "inline", srcDoc: "<p>editor</p>" },
      capabilities,
      allowMultiple: true,
      maxInstances: 3,
      lifecycle: {},
    },
    {
      id: "canvas",
      title: "Canvas",
      document: { kind: "inline", srcDoc: "<p>canvas</p>" },
      capabilities,
      allowMultiple: true,
      maxInstances: 2,
      lifecycle: {},
    },
  ],
});

describe("pane contract and instance model", () => {
  it("rejects duplicate pane ids", () => {
    expect(() => definePanes({
      id: "duplicate",
      panes: [definition.panes[0]!, definition.panes[0]!],
    })).toThrow("Duplicate pane id");
  });

  it("opens multiple isolated instances, reloads epoch and closes active instance", () => {
    let sequence = 0;
    let state = createPaneWorkspace(definition, (paneId) => `${paneId}-${++sequence}`);
    expect(state.instances.map((item) => item.instanceId)).toEqual(["editor-1", "canvas-2"]);
    state = reducePaneWorkspace(definition, state, { type: "open", paneId: "editor", instanceId: "editor-3" });
    expect(state.instances.filter((item) => item.paneId === "editor")).toHaveLength(2);
    expect(state.activeInstanceId).toBe("editor-3");
    state = reducePaneWorkspace(definition, state, { type: "reload", instanceId: "editor-3" });
    expect(state.instances.find((item) => item.instanceId === "editor-3")?.epoch).toBe(2);
    state = reducePaneWorkspace(definition, state, { type: "close", instanceId: "editor-3" });
    expect(state.instances.map((item) => item.instanceId)).toEqual(["editor-1", "canvas-2"]);
    expect(state.activeInstanceId).toBe("canvas-2");
  });

  it("enforces maxInstances and maxOpenPanes", () => {
    let state = createPaneWorkspace(definition, (paneId, index) => `${paneId}-${index}`);
    state = reducePaneWorkspace(definition, state, { type: "open", paneId: "canvas", instanceId: "canvas-extra" });
    state = reducePaneWorkspace(definition, state, { type: "open", paneId: "canvas", instanceId: "canvas-denied" });
    expect(state.instances.filter((item) => item.paneId === "canvas")).toHaveLength(2);
  });
});

describe("default-deny authorization", () => {
  it("allows declared routes and surface commands", () => {
    const route = PaneGuestRequestSchema.parse({ type: "pane:request", requestId: "1", operation: "route.query", route: "data" });
    const surface = PaneGuestRequestSchema.parse({ type: "pane:request", requestId: "2", operation: "surface.run", domain: "canvas", action: "sync" });
    expect(() => authorizePaneRequest(capabilities, route)).not.toThrow();
    expect(() => authorizePaneRequest(capabilities, surface)).not.toThrow();
  });

  it("rejects undeclared route, method and surface action", () => {
    for (const request of [
      PaneGuestRequestSchema.parse({ type: "pane:request", requestId: "1", operation: "route.query", route: "secret" }),
      PaneGuestRequestSchema.parse({ type: "pane:request", requestId: "2", operation: "surface.run", domain: "canvas", action: "delete-all" }),
    ]) {
      expect(() => authorizePaneRequest(capabilities, request)).toThrowError(PaneHostError);
    }
  });
});
