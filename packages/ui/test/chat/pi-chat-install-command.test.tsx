/**
 * PiChat — `/install` host 命令结果的通用卡片追加(spec install-host-command,任务 3.1)。
 *
 * 验证:声明了 `resultDataPart` 的内置命令(/install)执行后,`result.data` 存在 → 追加
 * `data-install-result` 卡片(bang 模式同构);仅 `message`(用法/帮助,无 data)→ 纯文本追加;
 * 未声明 resultDataPart 的命令(/clear)行为不变(不追加卡片,只应用 effect)。
 */
import { describe, it, expect, vi } from "vitest";
import { render, fireEvent, waitFor } from "@testing-library/react";
import { PiChat } from "../../src/chat/pi-chat.js";
import { createRendererRegistry } from "../../src/registry/renderer-registry.js";
import { mockSession, mockControls, MockTransport } from "../fixtures/mock-session.js";
import type { UsePiSessionResult } from "@blksails/pi-web-react";
import type { RpcSlashCommand } from "@blksails/pi-web-protocol";

const INSTALL_CMD: RpcSlashCommand = { name: "install", source: "builtin" };
const CLEAR_CMD: RpcSlashCommand = { name: "clear", source: "builtin" };

function setupClient(uiRpcCommand: ReturnType<typeof vi.fn>) {
  const client = {
    uiRpcCommand,
    getCompletionTriggers: vi.fn(async () => ({ triggers: [] })),
    getCompletion: vi.fn(async () => ({ items: [] })),
  } as unknown as NonNullable<UsePiSessionResult["client"]>;
  return client;
}

function setup(
  builtinCommands: readonly RpcSlashCommand[],
  builtinResultDataParts: Record<string, string> | undefined,
  uiRpcCommand: ReturnType<typeof vi.fn>,
) {
  const client = setupClient(uiRpcCommand);
  const transport = new MockTransport();
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
      builtinCommands={builtinCommands}
      {...(builtinResultDataParts !== undefined ? { builtinResultDataParts } : {})}
    />,
  );
  const ta = container.querySelector(
    "[data-pi-input-textarea]",
  ) as HTMLTextAreaElement;
  const submit = (text: string): void => {
    fireEvent.change(ta, { target: { value: text } });
    fireEvent.keyDown(ta, { key: "Enter" });
  };
  return { submit, container };
}

describe("PiChat /install 结果卡片追加", () => {
  it("data 存在 + 词条声明 resultDataPart → 追加 data-install-result 卡片", async () => {
    const uiRpcCommand = vi.fn(async () => ({
      ok: true,
      result: {
        command: "install",
        effect: "panel-refresh",
        data: {
          action: "install",
          ok: true,
          kind: "agent",
          id: "local:./examples/hello-agent",
          steps: [],
        },
      },
    }));
    const { submit, container } = setup(
      [INSTALL_CMD],
      { install: "data-install-result" },
      uiRpcCommand,
    );
    submit("/install install local:./examples/hello-agent");
    await waitFor(() => {
      expect(container.querySelector("[data-pi-install-result]")).not.toBeNull();
    });
    expect(uiRpcCommand).toHaveBeenCalled();
  });

  it("仅 message(无 data,如用法文本)→ 以纯文本追加,不出卡片", async () => {
    const uiRpcCommand = vi.fn(async () => ({
      ok: true,
      result: { command: "install", effect: "none", message: "用法: /install install source" },
    }));
    const { submit, container } = setup(
      [INSTALL_CMD],
      { install: "data-install-result" },
      uiRpcCommand,
    );
    submit("/install");
    await waitFor(() => {
      expect(container.textContent).toContain("用法: /install install source");
    });
    expect(container.querySelector("[data-pi-install-result]")).toBeNull();
  });

  it("未声明 resultDataPart 的命令(/clear)→ 不追加卡片(行为不变)", async () => {
    const uiRpcCommand = vi.fn(async () => ({
      ok: true,
      result: { command: "clear", effect: "clear-transcript" },
    }));
    const { submit, container } = setup([CLEAR_CMD], undefined, uiRpcCommand);
    submit("/clear");
    await waitFor(() => expect(uiRpcCommand).toHaveBeenCalled());
    expect(container.querySelector("[data-pi-install-result]")).toBeNull();
  });
});
