/**
 * Page render smoke: the un-sessioned state renders the agent source picker
 * (Req 10.1 / 1.3 / 1.5) without crashing.
 */
import { describe, expect, it } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { ChatApp } from "@/components/chat-app";

describe("ChatApp (un-sessioned)", () => {
  it("renders the agent source picker before any session is created", async () => {
    render(
      <ChatApp
        defaultSource="./examples/hello-agent"
        defaultModel="stub-model"
        defaultCwd="/tmp"
      />,
    );
    // 登录门禁(IdentityGate)先探测 /api/identity 才决定放行,故首帧是空的。
    // 探测失败/未配置云端 → 放行(见 components/auth/login-page.tsx 顶部判定表)。
    await waitFor(() =>
      expect(document.querySelector("[data-agent-source-picker]")).not.toBeNull(),
    );
    // i18n 默认 locale 为 zh(无 I18nProvider 时);文案经 t("agentSourcePicker.formTitle")。
    expect(screen.getByText(/启动一个 pi-web 会话/)).toBeInTheDocument();
    expect(
      document.querySelector("[data-agent-source-submit]"),
    ).not.toBeNull();
    // Default-source affordance is present when a default is configured.
    expect(
      document.querySelector("[data-agent-source-default]"),
    ).not.toBeNull();
  });
});
