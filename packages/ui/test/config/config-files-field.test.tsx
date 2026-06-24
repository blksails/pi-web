import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import type { FieldDescriptor } from "@blksails/pi-web-protocol";
import {
  ConfigFilesField,
  __setSchemaFetchImpl,
} from "../../src/config/fields/config-files-field.js";
import type { FieldProps } from "../../src/config/field-registry.js";

const descriptor: FieldDescriptor = {
  key: "files",
  kind: "record",
  label: "独立配置文件",
  required: false,
  widget: "configFiles",
};

function renderField(value: unknown, onChange = vi.fn()): typeof onChange {
  const props: FieldProps = { descriptor, value, onChange, path: ["files"], errors: {} };
  render(<ConfigFilesField {...props} />);
  return onChange;
}

beforeEach(() => {
  // 默认拉取失败 → 回退原始 JSON(各用例可覆盖)。
  __setSchemaFetchImpl(vi.fn(async () => {
    throw new Error("no network");
  }) as unknown as typeof fetch);
});

describe("ConfigFilesField", () => {
  it("空值渲染占位", () => {
    renderField(undefined);
    expect(screen.getByText("暂无独立配置文件")).toBeInTheDocument();
  });

  it("无 $schema → 原始 JSON 编辑,合法解析回写,非法报错不回写", () => {
    const onChange = renderField({ "a.json": { enabled: true } });
    const ta = screen.getByRole("textbox");
    fireEvent.change(ta, { target: { value: '{"enabled":false}' } });
    expect(onChange).toHaveBeenLastCalledWith({ "a.json": { enabled: false } });
    onChange.mockClear();
    fireEvent.change(ta, { target: { value: "{ broken" } });
    expect(screen.getByRole("alert")).toHaveTextContent("JSON 格式错误");
    expect(onChange).not.toHaveBeenCalled();
  });

  it("有 $schema 且拉取成功 → 渲染结构化表单(SchemaForm)", async () => {
    __setSchemaFetchImpl(
      vi.fn(async () => ({
        ok: true,
        json: async () => ({
          title: "T",
          type: "object",
          properties: { enabled: { type: "boolean", title: "开关" } },
        }),
      })) as unknown as typeof fetch,
    );
    renderField({
      "proxy.json": {
        $schema: "https://raw.githubusercontent.com/aizigao/pi-proxy-fetch/master/schema.json",
        enabled: true,
      },
    });
    // owner 标签即时渲染;结构化字段在拉取完成后出现。
    expect(screen.getByText("aizigao/pi-proxy-fetch")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText("开关")).toBeInTheDocument());
    // 不再是原始 JSON textarea。
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  });

  it("有 $schema 但拉取失败 → 回退原始 JSON", async () => {
    renderField({
      "x.json": {
        $schema: "https://raw.githubusercontent.com/foo/bar-fail/master/schema.json",
        a: 1,
      },
    });
    await waitFor(() => expect(screen.getByRole("textbox")).toBeInTheDocument());
  });
});
