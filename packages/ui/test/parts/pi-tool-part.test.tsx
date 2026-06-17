import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { PiToolPart } from "../../src/parts/pi-tool-part.js";
import {
  toolStartPart,
  toolUpdatePart,
  toolEndPart,
  toolErrorPart,
} from "../fixtures/ui-message-fixtures.js";

describe("PiToolPart 三态", () => {
  it("start 态显示工具名与入参", () => {
    render(<PiToolPart part={toolStartPart("search", { q: "pi" })} />);
    const card = screen.getByText("search").closest("[data-pi-tool]");
    expect(card).toHaveAttribute("data-pi-tool-phase", "start");
    expect(screen.getByText(/"q": "pi"/)).toBeInTheDocument();
    expect(screen.getByText("Running")).toBeInTheDocument();
  });

  it("update 态用最新累积值替换显示", () => {
    render(
      <PiToolPart
        part={toolUpdatePart("search", { q: "pi" }, { partial: 1 })}
      />,
    );
    const card = screen.getByText("search").closest("[data-pi-tool]");
    expect(card).toHaveAttribute("data-pi-tool-phase", "update");
    expect(screen.getByText(/"partial": 1/)).toBeInTheDocument();
  });

  it("end 态显示结果", () => {
    render(
      <PiToolPart part={toolEndPart("search", { q: "pi" }, { hits: 3 })} />,
    );
    const card = screen.getByText("search").closest("[data-pi-tool]");
    expect(card).toHaveAttribute("data-pi-tool-phase", "end");
    expect(screen.getByText(/"hits": 3/)).toBeInTheDocument();
    expect(screen.getByText("Completed")).toBeInTheDocument();
  });

  it("error 态以错误样式呈现", () => {
    render(
      <PiToolPart part={toolErrorPart("search", { q: "pi" }, "boom")} />,
    );
    const card = screen.getByText("search").closest("[data-pi-tool]");
    expect(card).toHaveAttribute("data-pi-tool-phase", "error");
    expect(screen.getByText("boom")).toBeInTheDocument();
    expect(screen.getByText("Error")).toBeInTheDocument();
  });

  it("折叠区可键盘展开且带 aria 状态", async () => {
    const user = userEvent.setup();
    render(
      <PiToolPart
        part={toolEndPart("search", {}, { hits: 3 })}
        defaultOpen={false}
      />,
    );
    const toggle = screen.getByRole("button");
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    toggle.focus();
    await user.keyboard("{Enter}");
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText(/"hits": 3/)).toBeInTheDocument();
  });
});
