import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { PiSessionStats } from "../../src/controls/pi-session-stats.js";
import { mockControls, sampleStats } from "../fixtures/mock-session.js";

describe("PiSessionStats", () => {
  it("无 stats 时显示空态", () => {
    render(<PiSessionStats controls={mockControls()} />);
    expect(screen.getByText(/暂无统计/)).toBeInTheDocument();
  });

  it("展示用量与成本统计", () => {
    const controls = mockControls({ stats: sampleStats() });
    render(<PiSessionStats controls={controls} />);
    expect(screen.getByText("$0.0123")).toBeInTheDocument();
    expect(screen.getByText("150")).toBeInTheDocument();
  });

  it("统计更新后刷新显示", () => {
    const controls = mockControls({ stats: sampleStats() });
    const { rerender } = render(<PiSessionStats controls={controls} />);
    expect(screen.getByText("$0.0123")).toBeInTheDocument();
    const next = mockControls({
      stats: { ...sampleStats(), cost: 0.5 },
    });
    rerender(<PiSessionStats controls={next} />);
    expect(screen.getByText("$0.5000")).toBeInTheDocument();
  });
});
