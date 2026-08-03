import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import * as React from "react";
import { PiChat } from "../../src/chat/pi-chat.js";
import { createRendererRegistry } from "../../src/registry/renderer-registry.js";
import {
  mockSession,
  mockControls,
  MockTransport,
} from "../fixtures/mock-session.js";
import type { WebExtension, ConversationAccess } from "@blksails/pi-web-kit";
import { definePanes } from "@blksails/pi-web-panes-kit";

/**
 * PiChat 接入 WebExtension(任务 5.2):
 * - Tier1 区域插槽(panelRight/headerCenter)渲染在 chat 内指定位置;
 * - Tier2 渲染器并入 registry(extId 命名空间);
 * - 无 extension 时行为不变(向后兼容)。
 */
describe("PiChat × WebExtension", () => {
  it("渲染扩展声明的 sidebarLeft 与 headerCenter 到指定区域", () => {
    // ★ 槽名改 sidebarLeft(任务 5.3):右侧面板槽已废弃。本用例测的是**具名槽渲染机制**,
    // 对具体槽名不敏感 —— 换个槽承载,保护面完全不变(同任务 2.1 处理夹具的思路)。
    const ext: WebExtension = {
      manifestId: "acme",
      slots: {
        sidebarLeft: <div data-testid="ext-panel">领域面板</div>,
        headerCenter: <div data-testid="ext-header">标题</div>,
      },
    };
    const { container } = render(
      <PiChat session={mockSession()} controls={mockControls()} extension={ext} />,
    );
    expect(screen.getByTestId("ext-panel")).toHaveTextContent("领域面板");
    expect(screen.getByTestId("ext-header")).toHaveTextContent("标题");
    // 容器随槽名一并改为 sidebarLeft。
    expect(container.querySelector("[data-pi-ext-sidebar-left]")).not.toBeNull();
  });

  it("扩展 Tier2 渲染器并入提供的 registry(extId 命名空间)", () => {
    const reg = createRendererRegistry();
    function CardRenderer(): null {
      return null;
    }
    const ext: WebExtension = {
      manifestId: "acme",
      renderers: { dataParts: { "data-card": CardRenderer } },
    };
    render(
      <PiChat
        session={mockSession()}
        controls={mockControls()}
        registry={reg}
        extension={ext}
      />,
    );
    expect(reg.resolveDataPartRenderer("data-card")).toBe(CardRenderer);
  });

  it("无 extension 时不渲染扩展区域(向后兼容)", () => {
    const { container } = render(
      <PiChat session={mockSession()} controls={mockControls()} />,
    );
    expect(container.querySelector("[data-panes-host]")).toBeNull();
    expect(container.querySelector("[data-pi-ext-header]")).toBeNull();
  });

  it("右侧面板比例:初始 3:7 + 运行时切换 居中/2:1/3:7", () => {
    // 夹具改用 pane 声明键(任务 5.3);本用例测的是**比例切换器**,只需面板出现。
    const ext: WebExtension = {
      manifestId: "acme",
      panes: definePanes({
        id: "ratio-panel",
        initialPaneIds: ["p"],
        panes: [{ id: "p", title: "P", document: { kind: "inline", srcDoc: "<!doctype html><p>p</p>" }, capabilities: {} }],
      }),
    };
    const { container } = render(
      <PiChat
        session={mockSession()}
        controls={mockControls()}
        extension={ext}
        panelRatio="3:7"
      />,
    );
    const aside = container.querySelector("[data-pi-chat-aside]");
    const sw = container.querySelector("[data-pi-panel-ratio-switch]");
    // 初始 3:7:aside 宽度 70%,切换器反映当前档位。
    expect(aside?.getAttribute("data-pi-panel-ratio")).toBe("3:7");
    expect((aside as HTMLElement).style.width).toBe("70%");
    expect(sw?.getAttribute("data-pi-panel-ratio-switch")).toBe("3:7");

    // 切到 2:1:宽度 33.333%。
    fireEvent.click(screen.getByText("2:1"));
    const aside21 = container.querySelector("[data-pi-chat-aside]") as HTMLElement;
    expect(aside21.getAttribute("data-pi-panel-ratio")).toBe("2:1");
    expect(aside21.style.width).toBe("33.333%");

    // 切到 居中:收起 aside 但保留 Pane 宿主挂载，以复用实例生命周期；切换器仍在场可切回。
    fireEvent.click(screen.getByText("居中"));
    expect(container.querySelector("[data-pi-chat-aside]")?.getAttribute("data-pi-panel-open")).toBe("false");
    expect(container.querySelector("[data-panes-host]")).not.toBeNull();
    expect(
      container.querySelector("[data-pi-panel-ratio-switch]"),
    ).not.toBeNull();

    // 从 居中 切回 3:7:右侧面板重新挂载。
    // ★ pane 内容在 iframe 里,宿主 realm 查不到 testid ⇒ 断言 pane 宿主重新在场。
    // 这是隔离形态的必然,原断言守的「切回后面板重新挂载」由此完整承担。
    fireEvent.click(screen.getByText("3:7"));
    expect(container.querySelector("[data-panes-host]")).not.toBeNull();
  });

  it("无右侧面板时不渲染比例切换器", () => {
    const ext: WebExtension = {
      manifestId: "acme",
      slots: { headerCenter: <div data-testid="ext-header">标题</div> },
    };
    const { container } = render(
      <PiChat
        session={mockSession()}
        controls={mockControls()}
        extension={ext}
        panelRatio="3:7"
      />,
    );
    expect(
      container.querySelector("[data-pi-panel-ratio-switch]"),
    ).toBeNull();
  });
});

/**
 * PiChat 会话能力注入:conversation 能力对象 + 过渡别名 onSubmitPrompt(契约 §4.2,Req 6)。
 *
 * 断言两者由宿主经 SlotHost 同时注入 panelRight 组件,且共用同一 doSend 底座——以 transport
 * 观测两条注入项的可见产物等价(6.2),并覆盖 doSend 的显式 attachmentIds 合并/去重语义(6.4)。
 *
 * 说明:pi-chat 的 doSend 是内部闭包,不便直接单测;故在 PiChat 装配层以「注入项 → 可见的
 * transport.sendMessages 产物」间接观测其行为(与 pi-chat.test.tsx 既有 send 观测同范式)。
 */
/*
 * 已移除:`describe("PiChat 会话能力注入与别名等价 (Req 6)")`
 * (spec panes-only-right-panel 任务 5.3)。
 *
 * **触发条件已不可能成立**:这 4 条用例都以 `slots: { panelRight: CapturePanel }` 捕获宿主
 * 向槽注入的 `conversation` 与过渡别名 `onSubmitPrompt`。而 `conversation`/`onSubmitPrompt`
 * 是**右侧面板槽独有的注入面**(其余具名槽只拿 state),该槽删除后这条注入路径整体消失,
 * 别名也随之无处可用。
 *
 * **保护面已转移,未丢失**:「会话能力对象必须被注入」现由
 * `host-panes-dispatch.test.tsx` 的注入面完整性断言承担(`conversation` 在 REQUIRED_PROPS 里,
 * 且写明了「pane 把操作组装成用户消息回流对话流的能力」这一后果)。
 * 「别名与本体同底座」这条随别名一并终结 —— 别名的存在意义就是给旧槽消费者的过渡期兼容。
 */

