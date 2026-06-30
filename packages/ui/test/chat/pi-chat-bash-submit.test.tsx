/**
 * PiChat — bang shell 命令的提交分流(spec bang-shell-command,Req 1.1–1.5 / 5.5 / 7.4)。
 *
 * 验证:enableBash 开启时 `!`/`!!` 走 client.bash(不经 useChat/不发 LLM);关闭时 `!` 文本
 * 作为普通消息走 sendMessage;`!!`/前导空白解析正确;空命令不请求不发送。
 */
import { describe, it, expect, vi } from "vitest";
import { render, fireEvent, waitFor } from "@testing-library/react";
import { PiChat } from "../../src/chat/pi-chat.js";
import { createRendererRegistry } from "../../src/registry/renderer-registry.js";
import { mockSession, mockControls, MockTransport } from "../fixtures/mock-session.js";
import type { UsePiSessionResult } from "@blksails/pi-web-react";

type BashImpl = () => Promise<{
  output: string;
  exitCode?: number;
  cancelled: boolean;
  truncated: boolean;
}>;

function setup(enableBash: boolean, bashImpl?: BashImpl) {
  const transport = new MockTransport();
  const sendSpy = vi.spyOn(transport, "sendMessages");
  const bash = vi.fn(
    bashImpl ??
      (async () => ({
        output: "hi\n",
        exitCode: 0,
        cancelled: false,
        truncated: false,
      })),
  );
  const client = {
    bash,
    // 补全 effect(completion-provider-framework)在 client 就绪时拉取触发符;mock no-op。
    getCompletionTriggers: vi.fn(async () => ({ triggers: [] })),
    getCompletion: vi.fn(async () => ({ items: [] })),
  } as unknown as NonNullable<UsePiSessionResult["client"]>;
  const session = mockSession({
    transport: transport as unknown as UsePiSessionResult["transport"],
    client,
    sessionId: "s1",
  });
  const { container } = render(
    <PiChat
      session={session}
      controls={mockControls()}
      registry={createRendererRegistry()}
      {...(enableBash ? { enableBash: true } : {})}
    />,
  );
  const ta = container.querySelector(
    "[data-pi-input-textarea]",
  ) as HTMLTextAreaElement;
  const submit = (text: string): void => {
    fireEvent.change(ta, { target: { value: text } });
    fireEvent.keyDown(ta, { key: "Enter" });
  };
  return { bash, sendSpy, submit, container };
}

describe("PiChat bang shell 命令分流", () => {
  it("enableBash + '!echo hi' → 调 client.bash,不走 sendMessage(Req 1.1/5.5)", () => {
    const { bash, sendSpy, submit } = setup(true);
    submit("!echo hi");
    expect(bash).toHaveBeenCalledWith("s1", {
      command: "echo hi",
      excludeFromContext: false,
    });
    expect(sendSpy).not.toHaveBeenCalled();
  });

  it("enableBash + '!!echo hi' → excludeFromContext=true(Req 1.2)", () => {
    const { bash, submit } = setup(true);
    submit("!!echo hi");
    expect(bash).toHaveBeenCalledWith("s1", {
      command: "echo hi",
      excludeFromContext: true,
    });
  });

  it("enableBash + 前导空白 ' !ls' → 去前缀去空白(Req 1.4)", () => {
    const { bash, submit } = setup(true);
    submit("  !ls");
    expect(bash).toHaveBeenCalledWith("s1", {
      command: "ls",
      excludeFromContext: false,
    });
  });

  it("enableBash + 空命令 '!' → 不请求、不发送(Req 1.3)", () => {
    const { bash, sendSpy, submit } = setup(true);
    submit("!");
    expect(bash).not.toHaveBeenCalled();
    expect(sendSpy).not.toHaveBeenCalled();
  });

  it("enableBash=false + '!echo hi' → 当普通消息发送,不调 bash(Req 5.5)", async () => {
    const { bash, sendSpy, submit } = setup(false);
    submit("!echo hi");
    expect(bash).not.toHaveBeenCalled();
    await waitFor(() => expect(sendSpy).toHaveBeenCalled());
  });

  it("enableBash + bash 失败(404/网络)→ 注入可见错误卡片(Req 7.1/7.2)", async () => {
    const { submit, container } = setup(true, async () => {
      throw new Error("bash failed: 404");
    });
    submit("!badcmd");
    await waitFor(() => {
      const card = container.querySelector("[data-pi-bash-result]");
      expect(card).not.toBeNull();
      expect(card?.textContent).toContain("命令执行失败");
    });
  });
});
