/**
 * MCP 面板渲染:mcp.json 走**原始 JSON 编辑**(/config/mcp 不喂 fileSchemas →
 * configFiles 控件回退 RawJsonEditor)。验证文本框编辑与合法 JSON 回写。
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import type { FieldDescriptor } from "@blksails/pi-web-protocol";
import { ConfigFilesField, __setSchemaFetchImpl } from "../../src/config/fields/config-files-field.js";
import type { FieldProps } from "../../src/config/field-registry.js";

const descriptor: FieldDescriptor = { key: "files", kind: "record", label: "MCP 配置 (mcp.json)", required: false, widget: "configFiles" };

function renderMcp(content: unknown, onChange = vi.fn()): typeof onChange {
  // 与 /config/mcp 一致:无 fileSchemas。
  const props: FieldProps = { descriptor, value: { "mcp.json": content }, onChange, path: ["files"], errors: {} };
  render(<ConfigFilesField {...props} />);
  return onChange;
}

beforeEach(() => {
  __setSchemaFetchImpl(vi.fn(async () => {
    throw new Error("no network");
  }) as unknown as typeof fetch);
});

describe("MCP 面板 — 原始 JSON 编辑", () => {
  it("无 fileSchemas → 渲染 JSON 文本框(非结构化字段)", () => {
    renderMcp({ settings: { toolPrefix: "server" } });
    const ta = screen.getByRole("textbox");
    expect(ta.tagName).toBe("TEXTAREA");
    expect((ta as HTMLTextAreaElement).value).toContain("toolPrefix");
  });

  it("编辑合法 JSON → 回写;非法 → 报错不回写", () => {
    const onChange = renderMcp({});
    const ta = screen.getByRole("textbox");
    fireEvent.change(ta, { target: { value: '{"mcpServers":{"fs":{"command":"npx"}}}' } });
    expect(onChange).toHaveBeenLastCalledWith({ "mcp.json": { mcpServers: { fs: { command: "npx" } } } });
    onChange.mockClear();
    fireEvent.change(ta, { target: { value: "{ broken" } });
    expect(screen.getByRole("alert")).toHaveTextContent("JSON 格式错误");
    expect(onChange).not.toHaveBeenCalled();
  });
});
