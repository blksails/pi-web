// @vitest-environment jsdom
import * as React from "react";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { definePanes } from "../src/index.js";
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
});
