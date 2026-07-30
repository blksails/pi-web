/**
 * PiChat — `/agent`、`/plugin` host 命令结果的通用卡片追加
 * (spec agent-plugin-commands,任务 3.4;迁自 pi-chat-install-command)。
 *
 * 验证:声明了 `resultDataPart` 的内置命令执行后,`result.data` 存在 → 追加
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

const AGENT_CMD: RpcSlashCommand = { name: "agent", source: "builtin" };
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

describe("PiChat /agent 与 /plugin 结果卡片追加", () => {
  it("data 存在 + 词条声明 resultDataPart → 追加 data-install-result 卡片", async () => {
    const uiRpcCommand = vi.fn(async () => ({
      ok: true,
      result: {
        command: "agent",
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
      [AGENT_CMD],
      { agent: "data-install-result" },
      uiRpcCommand,
    );
    submit("/agent install local:./examples/hello-agent");
    await waitFor(() => {
      expect(container.querySelector("[data-pi-install-result]")).not.toBeNull();
    });
    expect(uiRpcCommand).toHaveBeenCalled();
  });

  it("仅 message(无 data,如用法文本)→ 以纯文本追加,不出卡片", async () => {
    const uiRpcCommand = vi.fn(async () => ({
      ok: true,
      result: { command: "agent", effect: "none", message: "用法: /agent install source" },
    }));
    const { submit, container } = setup(
      [AGENT_CMD],
      { agent: "data-install-result" },
      uiRpcCommand,
    );
    // 载体取参数阶段的输入而非裸 `/agent`:命令名阶段的 Enter/Tab 由命令面板捕获,
    // 对有 argSpec 的命令一律只填 `/cmd ` 进入子命令阶段、不执行(见 pi-command-palette
    // 的 select:argSpec 分支先于 builtin 分支)。此处要验的是"结果仅有 message 时以纯文本
    // 追加",与用哪条 argv 触发无关。
    submit("/agent install foo");
    await waitFor(() => {
      expect(container.textContent).toContain("用法: /agent install source");
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

// ---------------------------------------------------------------------------
// 卡片类型优先级(spec publish-host-command,任务 1.3)
//
// 决策 2 的护栏:此前卡片类型**只**按命令名查表,一个命令因此只能有一种结果卡片。
// `/agent install` 与 `/agent publish` 的结果形状完全不同,故让服务端经
// `CommandResult.dataPart` 逐次指定,优先于查表。
// ---------------------------------------------------------------------------

describe("卡片类型:result.dataPart 优先于按命令名查表", () => {
  it("同一个 /agent,result.dataPart 指定 publish 卡片 → 渲染 publish 卡片而非 install 卡片", async () => {
    const uiRpcCommand = vi.fn(async () => ({
      ok: true,
      result: {
        command: "agent",
        effect: "notify",
        dataPart: "data-publish-preview",
        data: {
          ok: true,
          package: { id: "acme/x", version: "1.0.0", kind: "agent", displayName: "X" },
          files: [{ path: "index.ts", integrity: "sha384-aaaaaaaaaaaaaaaa" }],
          warnings: [],
          disclaimers: { unsigned: true, grantNotChecked: true },
        },
      },
    }));
    // 查表里 agent → data-install-result;若优先级写反,渲染出的会是 install 卡片。
    const { submit, container } = setup(
      [AGENT_CMD],
      { agent: "data-install-result" },
      uiRpcCommand,
    );
    submit("/agent publish ./examples/x --dry-run");
    await waitFor(() => {
      expect(container.querySelector("[data-pi-publish-preview]")).not.toBeNull();
    });
    expect(container.querySelector("[data-pi-install-result]")).toBeNull();
  });

  it("未给 dataPart → 仍按命令名查表(既有行为不变)", async () => {
    const uiRpcCommand = vi.fn(async () => ({
      ok: true,
      result: {
        command: "agent",
        effect: "panel-refresh",
        data: { action: "install", ok: true, kind: "agent", id: "x", steps: [] },
      },
    }));
    const { submit, container } = setup(
      [AGENT_CMD],
      { agent: "data-install-result" },
      uiRpcCommand,
    );
    submit("/agent install x");
    await waitFor(() => {
      expect(container.querySelector("[data-pi-install-result]")).not.toBeNull();
    });
  });
});
