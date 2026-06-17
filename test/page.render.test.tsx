/**
 * Page render smoke: the un-sessioned state renders the agent source picker
 * (Req 10.1 / 1.3 / 1.5) without crashing.
 */
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { ChatApp } from "@/components/chat-app";

describe("ChatApp (un-sessioned)", () => {
  it("renders the agent source picker before any session is created", () => {
    render(
      <ChatApp
        defaultSource="./examples/hello-agent"
        defaultModel="stub-model"
        defaultCwd="/tmp"
      />,
    );
    expect(
      document.querySelector("[data-agent-source-picker]"),
    ).not.toBeNull();
    expect(screen.getByText(/Start a pi-web session/i)).toBeInTheDocument();
    expect(
      document.querySelector("[data-agent-source-submit]"),
    ).not.toBeNull();
    // Default-source affordance is present when a default is configured.
    expect(
      document.querySelector("[data-agent-source-default]"),
    ).not.toBeNull();
  });
});
