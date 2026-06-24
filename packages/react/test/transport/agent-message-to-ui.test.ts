/**
 * agentMessagesToUiMessages 单测:覆盖 user/assistant/toolResult 映射、toolResult 关联、
 * 孤立 toolResult 降级、未知 role 跳过、空输入、id 稳定性。
 */
import { describe, it, expect } from "vitest";
import type { AgentMessage } from "@blksails/pi-web-protocol";
import { agentMessagesToUiMessages } from "../../src/transport/agent-message-to-ui.js";

/** 构造测试消息(放宽类型,聚焦转换逻辑)。 */
function msgs(list: unknown[]): readonly AgentMessage[] {
  return list as unknown as readonly AgentMessage[];
}

describe("agentMessagesToUiMessages", () => {
  it("空输入返回空数组", () => {
    expect(agentMessagesToUiMessages(msgs([]))).toEqual([]);
  });

  it("user string content → 单个 text part;id 稳定为 msg-<i>", () => {
    const out = agentMessagesToUiMessages(
      msgs([{ role: "user", content: "hello" }]),
    );
    expect(out).toHaveLength(1);
    expect(out[0]?.id).toBe("msg-0");
    expect(out[0]?.role).toBe("user");
    expect(out[0]?.parts).toEqual([
      { type: "text", text: "hello", state: "done" },
    ]);
  });

  it("user string content 含附件引用占位符 → 剥离占位符,只留用户文本", () => {
    // 复刻 server 端 injectAttachmentRefs 的注入形态:占位符块在前、空行分隔、原文本在后。
    const out = agentMessagesToUiMessages(
      msgs([
        {
          role: "user",
          content:
            "[attachment id=att_-ELR9OCaib2J8DK4jIbPsg type=image/jpeg name=4A532F59-8139-4DF4-B8C0-A41197503462_1_105_c.jpeg]\n\n看到什么",
        },
      ]),
    );
    expect(out[0]?.parts).toEqual([
      { type: "text", text: "看到什么", state: "done" },
    ]);
  });

  it("user string content 多个占位符 + 文本 → 全部剥离,只留文本", () => {
    const out = agentMessagesToUiMessages(
      msgs([
        {
          role: "user",
          content:
            "[attachment id=att_a type=image/png name=a.png]\n[attachment id=att_b type=application/pdf name=b.pdf]\n\n看看这两个",
        },
      ]),
    );
    expect(out[0]?.parts).toEqual([
      { type: "text", text: "看看这两个", state: "done" },
    ]);
  });

  it("user string content 纯附件无文本 → 不产生空 text part", () => {
    const out = agentMessagesToUiMessages(
      msgs([
        {
          role: "user",
          content: "[attachment id=att_a type=image/png name=a.png]\n\n",
        },
      ]),
    );
    expect(out[0]?.role).toBe("user");
    expect(out[0]?.parts).toEqual([]);
  });

  it("user string content 无占位符 → 原样保留(不误伤普通方括号文本)", () => {
    const out = agentMessagesToUiMessages(
      msgs([{ role: "user", content: "数组写作 a[0] 看 [TODO] 项" }]),
    );
    expect(out[0]?.parts).toEqual([
      { type: "text", text: "数组写作 a[0] 看 [TODO] 项", state: "done" },
    ]);
  });

  it("user 数组 content → text + file(image)parts", () => {
    const out = agentMessagesToUiMessages(
      msgs([
        {
          role: "user",
          content: [
            { type: "text", text: "look" },
            { type: "image", mimeType: "image/png", data: "AAAA" },
          ],
        },
      ]),
    );
    const parts = out[0]?.parts ?? [];
    expect(parts[0]).toEqual({ type: "text", text: "look", state: "done" });
    expect(parts[1]).toMatchObject({
      type: "file",
      mediaType: "image/png",
      url: "data:image/png;base64,AAAA",
    });
  });

  it("assistant text/thinking/toolCall → text/reasoning/dynamic-tool parts", () => {
    const out = agentMessagesToUiMessages(
      msgs([
        {
          role: "assistant",
          content: [
            { type: "thinking", thinking: "hmm" },
            { type: "text", text: "answer" },
            { type: "toolCall", id: "t1", name: "echo", arguments: { x: 1 } },
          ],
        },
      ]),
    );
    const parts = out[0]?.parts ?? [];
    expect(parts[0]).toEqual({ type: "reasoning", text: "hmm", state: "done" });
    expect(parts[1]).toEqual({ type: "text", text: "answer", state: "done" });
    expect(parts[2]).toMatchObject({
      type: "dynamic-tool",
      toolName: "echo",
      toolCallId: "t1",
      state: "input-available",
      input: { x: 1 },
    });
  });

  it("assistant stopReason=error(content 空)→ 追加 data-pi-error part 承载 errorMessage", () => {
    const out = agentMessagesToUiMessages(
      msgs([
        {
          role: "assistant",
          content: [],
          stopReason: "error",
          errorMessage: "400 Provider returned error: Could not process image",
        },
      ]),
    );
    expect(out).toHaveLength(1);
    expect(out[0]?.role).toBe("assistant");
    expect(out[0]?.parts).toEqual([
      {
        type: "data-pi-error",
        data: {
          errorText: "400 Provider returned error: Could not process image",
        },
      },
    ]);
  });

  it("assistant stopReason=error 但 errorMessage 缺失 → 用兜底文案", () => {
    const out = agentMessagesToUiMessages(
      msgs([{ role: "assistant", content: [], stopReason: "error" }]),
    );
    expect(out[0]?.parts).toEqual([
      {
        type: "data-pi-error",
        data: { errorText: "对话失败,但运行时未提供具体错误信息。" },
      },
    ]);
  });

  it("assistant stopReason=error 且有 content → content parts 在前,错误 part 在后", () => {
    const out = agentMessagesToUiMessages(
      msgs([
        {
          role: "assistant",
          content: [{ type: "text", text: "部分回答" }],
          stopReason: "error",
          errorMessage: "中途失败",
        },
      ]),
    );
    expect(out[0]?.parts).toEqual([
      { type: "text", text: "部分回答", state: "done" },
      { type: "data-pi-error", data: { errorText: "中途失败" } },
    ]);
  });

  it("assistant stopReason=stop → 不产生 data-pi-error part(仅 error 才补)", () => {
    const out = agentMessagesToUiMessages(
      msgs([
        { role: "assistant", content: [{ type: "text", text: "ok" }], stopReason: "stop" },
      ]),
    );
    expect(out[0]?.parts).toEqual([
      { type: "text", text: "ok", state: "done" },
    ]);
  });

  it("toolResult 并入对应 tool part(output-available)", () => {
    const out = agentMessagesToUiMessages(
      msgs([
        {
          role: "assistant",
          content: [{ type: "toolCall", id: "t1", name: "echo", arguments: {} }],
        },
        {
          role: "toolResult",
          toolCallId: "t1",
          toolName: "echo",
          content: [{ type: "text", text: "ok" }],
          isError: false,
        },
      ]),
    );
    // toolResult 不产生新 UIMessage,而是回填 assistant 的 tool part。
    expect(out).toHaveLength(1);
    const tool = (out[0]?.parts ?? [])[0] as Record<string, unknown>;
    expect(tool.state).toBe("output-available");
    expect(tool.output).toEqual([{ type: "text", text: "ok" }]);
  });

  it("toolResult 含 details → output 透传 { content, details }(对齐即时 streaming)", () => {
    const details = {
      ok: true,
      assets: [
        { attachmentId: "att_x", displayUrl: "/api/attachments/att_x/raw?sig=y" },
      ],
    };
    const out = agentMessagesToUiMessages(
      msgs([
        {
          role: "assistant",
          content: [
            { type: "toolCall", id: "t1", name: "text_to_image", arguments: {} },
          ],
        },
        {
          role: "toolResult",
          toolCallId: "t1",
          toolName: "text_to_image",
          content: [{ type: "text", text: "生成成功" }],
          details,
          isError: false,
        },
      ]),
    );
    const tool = (out[0]?.parts ?? [])[0] as Record<string, unknown>;
    expect(tool.state).toBe("output-available");
    // 历史也透传 details(pi 持久化保留),与即时 streaming 的 { content, details } 同构。
    expect(tool.output).toEqual({
      content: [{ type: "text", text: "生成成功" }],
      details,
    });
  });

  it("toolResult isError → output-error + errorText", () => {
    const out = agentMessagesToUiMessages(
      msgs([
        {
          role: "assistant",
          content: [{ type: "toolCall", id: "t1", name: "echo", arguments: {} }],
        },
        {
          role: "toolResult",
          toolCallId: "t1",
          toolName: "echo",
          content: [{ type: "text", text: "boom" }],
          isError: true,
        },
      ]),
    );
    const tool = (out[0]?.parts ?? [])[0] as Record<string, unknown>;
    expect(tool.state).toBe("output-error");
    expect(tool.errorText).toBe("boom");
  });

  it("孤立 toolResult → 独立 assistant message", () => {
    const out = agentMessagesToUiMessages(
      msgs([
        {
          role: "toolResult",
          toolCallId: "orphan",
          toolName: "echo",
          content: [{ type: "text", text: "late" }],
          isError: false,
        },
      ]),
    );
    expect(out).toHaveLength(1);
    expect(out[0]?.role).toBe("assistant");
    expect((out[0]?.parts ?? [])[0]).toMatchObject({
      type: "dynamic-tool",
      toolCallId: "orphan",
      state: "output-available",
    });
  });

  it("历史 image 带公开 id(attachmentId)→ url 指向分发端点(非 data:)", () => {
    const out = agentMessagesToUiMessages(
      msgs([
        {
          role: "user",
          content: [
            {
              type: "image",
              mimeType: "image/png",
              data: "AAAA",
              attachmentId: "att_abc123",
            },
          ],
        },
      ]),
    );
    const part = (out[0]?.parts ?? [])[0] as Record<string, unknown>;
    expect(part.type).toBe("file");
    expect(part.mediaType).toBe("image/png");
    // 指向分发端点而非内联 base64。
    expect(String(part.url)).toContain("/attachments/att_abc123/raw");
    expect(String(part.url).startsWith("data:")).toBe(false);
  });

  it("历史 image 带公开 id(attachmentId)+ baseUrl(/api)→ url 前缀为 /api/attachments/:id/raw", () => {
    // 与 useAttachments.resolveDisplayUrl 同策略:根相对历史 URL 经 baseUrl 前缀为可达 URL,
    // 否则 Next 只在 /api/attachments/:id/raw 服务,根相对会 404。
    const out = agentMessagesToUiMessages(
      msgs([
        {
          role: "user",
          content: [
            {
              type: "image",
              mimeType: "image/png",
              data: "AAAA",
              attachmentId: "att_abc123",
            },
          ],
        },
      ]),
      { baseUrl: "/api" },
    );
    const part = (out[0]?.parts ?? [])[0] as Record<string, unknown>;
    expect(part.type).toBe("file");
    // 前缀为 /api/attachments/:id/raw(根相对走 baseUrl 前缀)。
    expect(part.url).toBe("/api/attachments/att_abc123/raw");
    expect(String(part.url).startsWith("data:")).toBe(false);
  });

  it("历史 image 带绝对 displayUrl(http(s))+ baseUrl → displayUrl 原样不前缀", () => {
    // 已是绝对 http(s) 的 displayUrl 不应被 baseUrl 前缀(仅根相对才前缀)。
    const out = agentMessagesToUiMessages(
      msgs([
        {
          role: "user",
          content: [
            {
              type: "image",
              mimeType: "image/png",
              data: "AAAA",
              displayUrl:
                "https://example.test/attachments/att_xyz/raw?exp=1&sig=deadbeef",
            },
          ],
        },
      ]),
      { baseUrl: "/api" },
    );
    const part = (out[0]?.parts ?? [])[0] as Record<string, unknown>;
    expect(part.url).toBe(
      "https://example.test/attachments/att_xyz/raw?exp=1&sig=deadbeef",
    );
  });

  it("遗留无 id 内联 base64 image + baseUrl → 仍渲染 data: 不前缀(防回归)", () => {
    // data: URL 不是根相对,baseUrl 不应影响它(防回归)。
    const out = agentMessagesToUiMessages(
      msgs([
        {
          role: "user",
          content: [{ type: "image", mimeType: "image/png", data: "AAAA" }],
        },
      ]),
      { baseUrl: "/api" },
    );
    const part = (out[0]?.parts ?? [])[0] as Record<string, unknown>;
    expect(part.url).toBe("data:image/png;base64,AAAA");
  });

  it("历史 image 带分发 displayUrl(http(s))→ 原样作为分发 URL", () => {
    const out = agentMessagesToUiMessages(
      msgs([
        {
          role: "user",
          content: [
            {
              type: "image",
              mimeType: "image/png",
              data: "AAAA",
              displayUrl:
                "https://example.test/attachments/att_xyz/raw?exp=1&sig=deadbeef",
            },
          ],
        },
      ]),
    );
    const part = (out[0]?.parts ?? [])[0] as Record<string, unknown>;
    expect(part.type).toBe("file");
    expect(part.url).toBe(
      "https://example.test/attachments/att_xyz/raw?exp=1&sig=deadbeef",
    );
    expect(String(part.url).startsWith("data:")).toBe(false);
  });

  it("遗留无 id 内联 base64 image → 仍重建 data: 内联 URL(防回归)", () => {
    const out = agentMessagesToUiMessages(
      msgs([
        {
          role: "user",
          content: [
            { type: "image", mimeType: "image/png", data: "AAAA" },
          ],
        },
      ]),
    );
    const part = (out[0]?.parts ?? [])[0] as Record<string, unknown>;
    expect(part.type).toBe("file");
    expect(part.mediaType).toBe("image/png");
    expect(part.url).toBe("data:image/png;base64,AAAA");
  });

  it("未知 role 被跳过", () => {
    const out = agentMessagesToUiMessages(
      msgs([
        { role: "system", content: "x" },
        { role: "user", content: "hi" },
      ]),
    );
    expect(out).toHaveLength(1);
    expect(out[0]?.role).toBe("user");
    // id 仍按原下标生成,保证与原始序列对齐。
    expect(out[0]?.id).toBe("msg-1");
  });
});
