import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { PiChat } from "../../src/chat/pi-chat.js";
import type { Suggestion } from "@pi-web/react";
import type { RpcSlashCommand } from "@pi-web/protocol";
import { mockSession, mockControls } from "../fixtures/mock-session.js";

const CMD: RpcSlashCommand = {
  name: "compact",
  source: "prompt",
  sourceInfo: {
    path: "/cmd",
    source: "test",
    scope: "project",
    origin: "package",
  },
};

const PRESET: Suggestion = {
  id: "p1",
  label: "Summarize this",
  value: "Please summarize",
  mode: "send",
};

function gridLabels(): string[] {
  const grid = document.querySelector('[data-pi-suggestions-layout="grid"]');
  return Array.from(grid?.querySelectorAll("button") ?? []).map(
    (b) => b.textContent ?? "",
  );
}

describe("PiChat 空态标题/副标题透传", () => {
  it("emptyTitle/emptySubtitle props 渲染到空态", () => {
    render(
      <PiChat
        session={mockSession()}
        emptyTitle="需要我帮忙吗?"
        emptySubtitle="提出问题、编写代码或探索想法"
      />,
    );
    expect(screen.getByText("需要我帮忙吗?")).toBeInTheDocument();
    expect(
      screen.getByText("提出问题、编写代码或探索想法"),
    ).toBeInTheDocument();
  });

  it("未传时使用宿主默认标题", () => {
    render(<PiChat session={mockSession()} />);
    expect(screen.getByText("What can I help with?")).toBeInTheDocument();
  });
});

describe("PiChat suggestionsMerge 透传", () => {
  it("默认(append)命令在前、预设在后", () => {
    render(
      <PiChat
        session={mockSession()}
        controls={mockControls({ commands: [CMD] })}
        suggestionsPresets={[PRESET]}
      />,
    );
    expect(gridLabels()).toEqual(["/compact", "Summarize this"]);
  });

  it("prepend:预设在前、命令在后", () => {
    render(
      <PiChat
        session={mockSession()}
        controls={mockControls({ commands: [CMD] })}
        suggestionsPresets={[PRESET]}
        suggestionsMerge="prepend"
      />,
    );
    expect(gridLabels()).toEqual(["Summarize this", "/compact"]);
  });

  it("replace:仅预设,命令不展示", () => {
    render(
      <PiChat
        session={mockSession()}
        controls={mockControls({ commands: [CMD] })}
        suggestionsPresets={[PRESET]}
        suggestionsMerge="replace"
      />,
    );
    expect(gridLabels()).toEqual(["Summarize this"]);
  });
});
