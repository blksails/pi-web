/**
 * agentMessagesToUiMessages 单测:覆盖 user/assistant/toolResult 映射、toolResult 关联、
 * 孤立 toolResult 降级、未知 role 跳过、空输入、id 稳定性。
 */
import { describe, it, expect } from "vitest";
import type { AgentMessage } from "@pi-web/protocol";
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
