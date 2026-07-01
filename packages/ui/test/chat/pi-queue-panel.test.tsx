import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { PiQueuePanel } from "../../src/chat/pi-queue-panel.js";

/**
 * PiQueuePanel(message-queue-ui):纯 props 呈现 —— 非空渲染条目+计数、空返回 null、data-* 标记。
 */
describe("PiQueuePanel", () => {
  it("空队列渲染为 null(不占布局)", () => {
    const { container } = render(
      <PiQueuePanel queue={{ steering: [], followUp: [] }} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("非空渲染条目、分组与 pending 合计计数", () => {
    const { container } = render(
      <PiQueuePanel
        queue={{ steering: ["ping", "again"], followUp: ["later"] }}
      />,
    );
    // 计数 = 合计 3,经稳定 data-* 暴露
    const count = container.querySelector("[data-pi-queue-count]");
    expect(count).not.toBeNull();
    expect(count?.getAttribute("data-pi-queue-count")).toBe("3");
    // 分组存在
    expect(
      container.querySelector('[data-pi-queue-group="steering"]'),
    ).not.toBeNull();
    expect(
      container.querySelector('[data-pi-queue-group="followUp"]'),
    ).not.toBeNull();
    // 条目数量
    expect(container.querySelectorAll("[data-pi-queue-item]").length).toBe(3);
  });

  it("仅 followUp 时不渲染空 steering 分组", () => {
    const { container } = render(
      <PiQueuePanel queue={{ steering: [], followUp: ["x"] }} />,
    );
    expect(
      container.querySelector('[data-pi-queue-group="steering"]'),
    ).toBeNull();
    expect(container.querySelector("[data-pi-queue-count]")?.textContent).toBe(
      "1",
    );
  });
});
