/**
 * 集成:用真实 proxy.json 内容 + 其 JSON Schema,经 ConfigFilesField 渲染**结构化表单**
 * (适配器 → IR → SchemaForm → ObjectField/ObjectListField),替代浏览器截图验证。
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import type { FieldDescriptor } from "@blksails/pi-web-protocol";
import {
  ConfigFilesField,
  __setSchemaFetchImpl,
} from "../../src/config/fields/config-files-field.js";
import type { FieldProps } from "../../src/config/field-registry.js";

// 真实 proxy.json 的 schema 结构(含 $defs / oneOf / 嵌套对象数组)。
const PROXY_SCHEMA = {
  title: "pi-proxy-fetch Config",
  type: "object",
  required: ["version", "enabled", "profileName", "profileConfig"],
  properties: {
    version: { type: "number", const: 1 },
    enabled: { type: "boolean", title: "启用" },
    profileName: { type: "string", title: "当前 Profile" },
    profileConfig: {
      type: "array",
      items: { oneOf: [{ $ref: "#/$defs/proxyServer" }, { $ref: "#/$defs/autoSwitch" }] },
    },
  },
  $defs: {
    proxyServer: {
      type: "object",
      title: "Proxy Server",
      required: ["name", "type", "server"],
      properties: {
        name: { type: "string", title: "名称" },
        type: { type: "string", const: "proxy_server" },
        server: { type: "string", title: "服务器" },
      },
    },
    autoSwitch: {
      type: "object",
      title: "Auto Switch",
      properties: {
        name: { type: "string", title: "名称" },
        type: { type: "string", const: "autoSwitch" },
        switchRules: {
          type: "array",
          items: { type: "object", properties: { note: { type: "string", title: "备注" } } },
        },
      },
    },
  },
};

// 真实 proxy.json 内容(my_clash socks5 + auto-switch)。
const PROXY_CONTENT = {
  $schema: "https://raw.githubusercontent.com/aizigao/pi-proxy-fetch/master/schema.json",
  version: 1,
  enabled: true,
  profileName: "my_clash",
  profileConfig: [
    { name: "my_clash", type: "proxy_server", server: "socks5://127.0.0.1:1080" },
    { name: "auto-switch", type: "autoSwitch", switchRules: [{ note: "Force proxy" }] },
  ],
};

const descriptor: FieldDescriptor = {
  key: "files",
  kind: "record",
  label: "独立配置文件",
  required: false,
  widget: "configFiles",
};

beforeEach(() => {
  __setSchemaFetchImpl(
    vi.fn(async () => ({ ok: true, json: async () => PROXY_SCHEMA })) as unknown as typeof fetch,
  );
});

describe("proxy.json 结构化表单(端到端渲染)", () => {
  it("拉取 schema 后渲染结构化字段而非原始 JSON", async () => {
    const onChange = vi.fn();
    const props: FieldProps = {
      descriptor,
      value: { "proxy.json": PROXY_CONTENT },
      onChange,
      path: ["files"],
      errors: {},
    };
    render(<ConfigFilesField {...props} />);

    // 所属扩展标签即时渲染。
    expect(screen.getByText("aizigao/pi-proxy-fetch")).toBeInTheDocument();

    // 拉取完成 → 结构化字段出现(启用开关 + profile 名输入),不再是原始 JSON textarea。
    await waitFor(() => expect(screen.getByText("启用")).toBeInTheDocument());
    expect(screen.getByText("当前 Profile")).toBeInTheDocument();
    // profileName 与首个 profile 的 name 同为 "my_clash" → 至少出现 2 处(确认结构化字段已渲染)。
    expect(screen.getAllByDisplayValue("my_clash").length).toBeGreaterThanOrEqual(2);

    // profileConfig 为对象数组,且 autoSwitch 项内 switchRules 又是嵌套对象数组
    // → 至少 2 个「添加条目」按钮(顶层 profileConfig + 嵌套 switchRules)。
    expect(screen.getAllByRole("button", { name: "添加条目" }).length).toBeGreaterThanOrEqual(2);
    // 2 个 profile 项 → 2 个变体(type)选择器(proxy_server / autoSwitch)。
    expect(screen.getAllByRole("combobox").length).toBe(2);
    // 第一项是 proxy_server,显示「服务器」字段值。
    expect(screen.getByDisplayValue("socks5://127.0.0.1:1080")).toBeInTheDocument();

    // 编辑 enabled 开关 → onChange 保留 $schema 与结构。
    const toggle = screen.getByRole("checkbox");
    fireEvent.click(toggle);
    const last = onChange.mock.calls.at(-1)?.[0] as Record<string, any>;
    expect(last["proxy.json"]["$schema"]).toBe(PROXY_CONTENT.$schema);
    expect(last["proxy.json"]["enabled"]).toBe(false);
    expect(Array.isArray(last["proxy.json"]["profileConfig"])).toBe(true);
  });

  it("切换某 profile 的变体(type)重置该项", async () => {
    const onChange = vi.fn();
    render(
      <ConfigFilesField
        descriptor={descriptor}
        value={{ "proxy.json": PROXY_CONTENT }}
        onChange={onChange}
        path={["files"]}
        errors={{}}
      />,
    );
    await waitFor(() => expect(screen.getByText("启用")).toBeInTheDocument());
    const selects = screen.getAllByRole("combobox");
    // 把第一项(proxy_server)切到 autoSwitch。
    fireEvent.change(selects[0]!, { target: { value: "autoSwitch" } });
    const last = onChange.mock.calls.at(-1)?.[0] as Record<string, any>;
    expect(last["proxy.json"]["profileConfig"][0]).toEqual({ type: "autoSwitch" });
  });
});
