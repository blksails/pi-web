import { describe, expect, it } from "vitest";
import type { AgentRouteDecl } from "@blksails/pi-web-agent-kit";
import {
  composePaneAgentModules,
  type PaneAgentModule,
  type PaneExtensionFactory,
} from "../../src/panes/agent-modules.js";

const ext = (): PaneExtensionFactory => () => undefined;
const route = (name: string): AgentRouteDecl => ({ name, handler: () => ({ ok: true }) });

describe("composePaneAgentModules", () => {
  it("merges pane-owned extensions and routes, deduping shared references", () => {
    const shared = ext();
    const sharedRoute = route("pane-data");
    const canvasExt = ext();
    const modules: PaneAgentModule[] = [
      { pane: { id: "files", capabilities: { routes: [{ name: "pane-data" }] } }, extensions: [shared], routes: [sharedRoute] },
      { pane: { id: "editor", capabilities: { routes: [{ name: "pane-data" }] } }, extensions: [shared], routes: [sharedRoute] },
      { pane: { id: "canvas" }, extensions: [canvasExt] },
    ];
    const composed = composePaneAgentModules(modules);
    expect(composed.extensions).toEqual([shared, canvasExt]);
    expect(composed.routes).toEqual([sharedRoute]);
  });

  it("rejects duplicate pane ids and conflicting distinct routes of the same name", () => {
    expect(() => composePaneAgentModules([
      { pane: { id: "files" } },
      { pane: { id: "files" } },
    ])).toThrow('duplicate pane module: files');
    expect(() => composePaneAgentModules([
      { pane: { id: "a" }, routes: [route("pane-data")] },
      { pane: { id: "b" }, routes: [route("pane-data")] },
    ])).toThrow('conflicting agent route "pane-data"');
  });

  it("fails fast when a pane grants a route no module provides", () => {
    expect(() => composePaneAgentModules([
      { pane: { id: "files", capabilities: { routes: [{ name: "pane-data" }] } } },
    ])).toThrow('pane "files" grants route "pane-data" but no pane module provides it');
  });
});
