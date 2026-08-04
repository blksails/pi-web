/**
 * ModelSelectField 组件测试(ai-gateway-providers spec 任务 4.2 + model-catalog spec 任务 4.1
 * + multi-gateway-providers spec 任务 6.1)。
 *
 * 覆盖:选项来自注入的 /api/config/models、modelSelect 组按 provider 分组、
 * 带 `source` 字段的条目渲染来源徽章、不带 `source` 字段的条目不渲染徽章(未启用
 * ai-gateway 套件时与今天一致);model-catalog 任务 4.1:providerSelect 选项集恒等于
 * 响应 providers 数组(3.1)、availability="catalog" 条目不可选中且不可提交并附提示
 * 文案(3.2)、存量无效值原样显示不崩溃(3.3);multi-gateway-providers 任务 6.1
 * (Req 11.1, 11.2, 11.6):组件取数按 output=text 筛选统一端点、取数缓存按筛选参数
 * 分桶(不同参数互不串扰、同参数命中缓存)、provider 徽章按来源实例标识原样展示
 * (不再折叠为固定的"网关"/"自配"两档译文)。
 * fetch 经 __setModelOptionsFetchImpl 注入,取数经按筛选参数分桶的缓存,
 * __resetModelOptionsCache 复位。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, cleanup, waitFor, fireEvent, screen } from "@testing-library/react";
import type { FieldDescriptor } from "@blksails/pi-web-protocol";
import {
  ModelSelectField,
  __setModelOptionsFetchImpl,
  __resetModelOptionsCache,
  __loadModelOptionsForTest,
  __setModelOptionsNowFn,
  MODEL_OPTIONS_CACHE_TTL_MS,
} from "../../src/config/fields/model-select-field.js";
import type { FieldProps } from "../../src/config/field-registry.js";

const descriptor: FieldDescriptor = {
  key: "defaultModel",
  kind: "string",
  label: "默认模型",
  required: false,
  widget: "modelSelect",
};

function mockFetch(body: unknown, ok = true): void {
  __setModelOptionsFetchImpl(
    vi.fn(async () => ({
      ok,
      status: ok ? 200 : 500,
      json: async () => body,
    })) as unknown as typeof fetch,
  );
}

function renderField(value: unknown, onChange = vi.fn()): typeof onChange {
  const props: FieldProps = { descriptor, value, onChange, path: ["defaultModel"], errors: {} };
  render(<ModelSelectField {...props} />);
  return onChange;
}

describe("ModelSelectField — 来源徽章(Req 4.2)", () => {
  beforeEach(() => {
    __resetModelOptionsCache();
  });
  afterEach(() => {
    cleanup();
    __resetModelOptionsCache();
    vi.restoreAllMocks();
  });

  it("条目带 source='ai-gateway' → 渲染网关徽章", async () => {
    mockFetch({
      providers: ["anthropic", "openrouter"],
      models: [
        { provider: "anthropic", id: "claude-sonnet", name: "Claude Sonnet", source: "ai-gateway" },
        { provider: "openrouter", id: "self-model", name: "Self Model", source: "self" },
      ],
    });
    renderField("");
    fireEvent.click(screen.getByRole("combobox"));
    await waitFor(() => {
      expect(screen.getByText("claude-sonnet")).toBeInTheDocument();
    });
    const gatewayBadge = document.querySelector('[data-pi-model-source="ai-gateway"]');
    const selfBadge = document.querySelector('[data-pi-model-source="self"]');
    expect(gatewayBadge).not.toBeNull();
    expect(selfBadge).not.toBeNull();
  });

  it("条目不带 source(未启用 ai-gateway 套件)→ 不渲染任何来源徽章", async () => {
    mockFetch({
      providers: ["openrouter"],
      models: [{ provider: "openrouter", id: "plain-model", name: "Plain Model" }],
    });
    renderField("");
    fireEvent.click(screen.getByRole("combobox"));
    await waitFor(() => {
      expect(screen.getByText("plain-model")).toBeInTheDocument();
    });
    expect(document.querySelector("[data-pi-model-source]")).toBeNull();
  });
});

describe("ModelSelectField — 目录态与 provider 收敛(model-catalog 任务 4.1)", () => {
  beforeEach(() => {
    __resetModelOptionsCache();
  });
  afterEach(() => {
    cleanup();
    __resetModelOptionsCache();
    vi.restoreAllMocks();
  });

  it("providerSelect:选项集恒等于响应 providers 数组(models 内 ai-gateway 分组不出现)(3.1)", async () => {
    mockFetch({
      providers: ["apiservices", "dashscope"],
      models: [
        { provider: "apiservices", id: "m1", name: "M1" },
        {
          provider: "ai-gateway",
          id: "gw-model",
          name: "GW Model",
          source: "ai-gateway",
          availability: "catalog",
        },
      ],
    });
    const providerDescriptor: FieldDescriptor = {
      key: "defaultProvider",
      kind: "string",
      label: "默认 Provider",
      required: false,
      widget: "providerSelect",
    };
    const props: FieldProps = {
      descriptor: providerDescriptor,
      value: "",
      onChange: vi.fn(),
      path: ["defaultProvider"],
      errors: {},
    };
    render(<ModelSelectField {...props} />);
    fireEvent.click(screen.getByRole("combobox"));
    await waitFor(() => {
      expect(screen.getByText("apiservices")).toBeInTheDocument();
    });
    const labels = screen
      .getAllByRole("option")
      .map((el) => el.textContent?.trim());
    expect(labels).toEqual(["apiservices", "dashscope"]);
  });

  it("modelSelect:availability='catalog' 条目 disabled、点击不提交、附「未接入会话」提示(3.2)", async () => {
    mockFetch({
      providers: ["apiservices"],
      models: [
        {
          provider: "ai-gateway",
          id: "gw-model",
          name: "GW Model",
          source: "ai-gateway",
          availability: "catalog",
        },
      ],
    });
    const onChange = renderField("");
    fireEvent.click(screen.getByRole("combobox"));
    await waitFor(() => {
      expect(screen.getByText("gw-model")).toBeInTheDocument();
    });
    const item = screen.getByText("gw-model").closest('[role="option"]');
    expect(item).not.toBeNull();
    expect(item).toHaveAttribute("aria-disabled", "true");
    fireEvent.click(item as HTMLElement);
    expect(onChange).not.toHaveBeenCalled();
    // 提示文案(默认 locale zh)
    expect(screen.getByText("未接入会话")).toBeInTheDocument();
  });

  it("modelSelect:availability 缺省(session)条目可正常选中(回归)", async () => {
    mockFetch({
      providers: ["apiservices"],
      models: [
        { provider: "apiservices", id: "m1", name: "M1" },
        { provider: "apiservices", id: "m2", name: "M2", availability: "session" },
      ],
    });
    const onChange = renderField("");
    fireEvent.click(screen.getByRole("combobox"));
    await waitFor(() => {
      expect(screen.getByText("m1")).toBeInTheDocument();
    });
    const m1 = screen.getByText("m1").closest('[role="option"]');
    expect(m1).toHaveAttribute("aria-disabled", "false");
    const m2 = screen.getByText("m2").closest('[role="option"]');
    expect(m2).toHaveAttribute("aria-disabled", "false");
    // 可选条目不渲染目录态提示
    expect(screen.queryByText("未接入会话")).toBeNull();
    // 点击可选条目 → 正常提交(commit 会关闭面板,故放最后)
    fireEvent.click(m1 as HTMLElement);
    expect(onChange).toHaveBeenCalledWith("m1");
  });

  it("存量无效值:value 不在选项中 → 触发器原样显示且不崩溃(3.3),并带可辨识 orphan 标记(任务 7.2,Req 9.4)", async () => {
    mockFetch({
      providers: ["apiservices"],
      models: [{ provider: "apiservices", id: "m1", name: "M1" }],
    });
    renderField("legacy-ghost-model");
    const trigger = screen.getByRole("combobox");
    expect(trigger).toHaveTextContent("legacy-ghost-model");
    // 取数完成前不误报 orphan(避免首帧闪现)。
    // orphan 判定须等选项集就位,故用 waitFor 等待取数完成后再断言。
    await waitFor(() => {
      expect(trigger).toHaveAttribute("data-pi-model-orphan", "true");
    });
    fireEvent.click(trigger);
    await waitFor(() => {
      expect(screen.getByText("m1")).toBeInTheDocument();
    });
    // 打开面板后触发器仍原样显示存量值(保留,不静默清除)
    expect(trigger).toHaveTextContent("legacy-ghost-model");
    // 面板内以不可选的 orphan 条目呈现该值,而不是把它从清单里抹掉。
    const orphanEntry = document.querySelector(
      '[data-pi-model-orphan="true"][data-pi-model-current="true"]',
    );
    expect(orphanEntry).not.toBeNull();
    expect(orphanEntry).toHaveTextContent("legacy-ghost-model");
    expect(orphanEntry).toHaveAttribute("aria-disabled", "true");
  });

  it("徽章回归:source='ai-gateway' 的目录态条目仍渲染来源徽章(2.4)", async () => {
    mockFetch({
      providers: ["apiservices"],
      models: [
        {
          provider: "ai-gateway",
          id: "gw-model",
          name: "GW Model",
          source: "ai-gateway",
          availability: "catalog",
        },
      ],
    });
    renderField("");
    fireEvent.click(screen.getByRole("combobox"));
    await waitFor(() => {
      expect(screen.getByText("gw-model")).toBeInTheDocument();
    });
    expect(document.querySelector('[data-pi-model-source="ai-gateway"]')).not.toBeNull();
  });
});

describe("ModelSelectField — 指向已不存在 provider 的可辨识标记(任务 7.2,Req 6.5/9.4)", () => {
  beforeEach(() => {
    __resetModelOptionsCache();
  });
  afterEach(() => {
    cleanup();
    __resetModelOptionsCache();
    vi.restoreAllMocks();
  });

  it("providerSelect:当前 defaultProvider 不在 providers 清单内 → 保留该值并带 orphan 标记,不静默回落(Req 6.5)", async () => {
    mockFetch({
      providers: ["apiservices", "dashscope"],
      models: [{ provider: "apiservices", id: "m1", name: "M1" }],
    });
    const providerDescriptor: FieldDescriptor = {
      key: "defaultProvider",
      kind: "string",
      label: "默认 Provider",
      required: false,
      widget: "providerSelect",
    };
    const props: FieldProps = {
      descriptor: providerDescriptor,
      value: "removed-provider",
      onChange: vi.fn(),
      path: ["defaultProvider"],
      errors: {},
    };
    render(<ModelSelectField {...props} />);
    const trigger = screen.getByRole("combobox");
    await waitFor(() => {
      expect(trigger).toHaveAttribute("data-pi-model-orphan", "true");
    });
    // 值仍原样保留(不被静默清除)。
    expect(trigger).toHaveTextContent("removed-provider");
    // 与会话模型选择器(elements/model-selector.tsx,任务 6.4)及视觉模型下拉
    // (vision-model-select-field.tsx)同一套标记语义,不各造一套。
    expect(trigger).toHaveAttribute("title");
  });

  it("回归:当前值确实在选项内 → 不带 orphan 标记(marker 具区分度,而非恒真)", async () => {
    mockFetch({
      providers: ["apiservices"],
      models: [{ provider: "apiservices", id: "m1", name: "M1" }],
    });
    renderField("m1");
    const trigger = screen.getByRole("combobox");
    fireEvent.click(trigger);
    await waitFor(() => {
      expect(screen.getByText("m1")).toBeInTheDocument();
    });
    expect(trigger).not.toHaveAttribute("data-pi-model-orphan");
    expect(document.querySelector('[data-pi-model-orphan="true"]')).toBeNull();
  });

  it("取数完成前(loaded=false)不误报 orphan:首帧即带值时不闪现标记", async () => {
    // 用一个永不 resolve 的 fetch 模拟"取数进行中",断言首帧(loaded 尚为 false)不带
    // orphan 标记——避免任何已有值的字段在挂载瞬间被误判为"指向不存在的 provider"。
    __setModelOptionsFetchImpl(
      vi.fn(() => new Promise<never>(() => {})) as unknown as typeof fetch,
    );
    renderField("legacy-ghost-model");
    const trigger = screen.getByRole("combobox");
    expect(trigger).not.toHaveAttribute("data-pi-model-orphan");
  });
});

describe("ModelSelectField — 统一端点筛选与分桶缓存(multi-gateway-providers 任务 6.1)", () => {
  beforeEach(() => {
    __resetModelOptionsCache();
  });
  afterEach(() => {
    cleanup();
    __resetModelOptionsCache();
    vi.restoreAllMocks();
  });

  it("组件取数请求统一端点并带 output=text 筛选(Req 11.2, 11.6)", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        providers: ["anthropic"],
        models: [{ provider: "anthropic", id: "m1", name: "M1" }],
      }),
    }));
    __setModelOptionsFetchImpl(fetchMock as unknown as typeof fetch);
    renderField("");
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalled();
    });
    const [requestedUrl] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(requestedUrl).toBe("/api/config/models?output=text");
  });

  it("按筛选参数分桶:不同参数各自取数互不串扰,相同参数命中缓存不重复请求(Req 11.5)", async () => {
    const requestedUrls: string[] = [];
    const fetchMock = vi.fn(async (url: string) => {
      requestedUrls.push(url);
      const body = url.includes("output=image")
        ? { providers: ["image-provider"], models: [{ provider: "image-provider", id: "image-model", name: "Image" }] }
        : { providers: ["chat-provider"], models: [{ provider: "chat-provider", id: "chat-model", name: "Chat" }] };
      return { ok: true, status: 200, json: async () => body };
    });
    __setModelOptionsFetchImpl(fetchMock as unknown as typeof fetch);

    const textResult = await __loadModelOptionsForTest({ output: "text" });
    const imageResult = await __loadModelOptionsForTest({ output: "image" });
    // 相同参数第二次调用:命中缓存,结果不被后一次不同参数的请求污染。
    const textResultAgain = await __loadModelOptionsForTest({ output: "text" });

    expect(textResult.providers).toEqual(["chat-provider"]);
    expect(imageResult.providers).toEqual(["image-provider"]);
    expect(textResultAgain.providers).toEqual(["chat-provider"]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(requestedUrls).toEqual([
      "/api/config/models?output=text",
      "/api/config/models?output=image",
    ]);
  });

  it("provider 徽章按来源实例标识原样展示,不折叠为固定的'网关'/'自配'两档译文(Req 3.5,design「徽章按实例名」)", async () => {
    mockFetch({
      providers: ["gw-1", "gw-2"],
      models: [
        { provider: "gw-1", id: "m1", name: "M1", source: "gw-1" },
        { provider: "gw-2", id: "m2", name: "M2", source: "gw-2" },
      ],
    });
    renderField("");
    fireEvent.click(screen.getByRole("combobox"));
    await waitFor(() => {
      expect(screen.getByText("m1")).toBeInTheDocument();
    });
    const badge1 = document.querySelector('[data-pi-model-source="gw-1"]');
    const badge2 = document.querySelector('[data-pi-model-source="gw-2"]');
    expect(badge1).not.toBeNull();
    expect(badge2).not.toBeNull();
    expect(badge1).toHaveTextContent("gw-1");
    expect(badge2).toHaveTextContent("gw-2");
    // 回归:不再折叠为固定的两档通用译文(旧实现会把非字面量 "ai-gateway" 的
    // 来源全部误判显示为"自配")。
    expect(screen.queryByText("网关")).toBeNull();
    expect(screen.queryByText("自配")).toBeNull();
  });
});

describe("ModelSelectField — 缓存 TTL 失效(任务 6.6,Req 11.3/11.4/11.5)", () => {
  beforeEach(() => {
    __resetModelOptionsCache();
  });
  afterEach(() => {
    cleanup();
    __resetModelOptionsCache();
    __setModelOptionsNowFn(() => Date.now()); // 复位为默认时钟,避免污染其它用例
    vi.restoreAllMocks();
  });

  it("TTL 内:相同参数的第二次调用仍命中缓存(不重复请求)", async () => {
    let clock = 1_000_000;
    __setModelOptionsNowFn(() => clock);
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ providers: ["p1"], models: [{ provider: "p1", id: "m1", name: "M1" }] }),
    }));
    __setModelOptionsFetchImpl(fetchMock as unknown as typeof fetch);

    await __loadModelOptionsForTest({ output: "text" });
    clock += MODEL_OPTIONS_CACHE_TTL_MS - 1; // 差 1ms 未到期
    await __loadModelOptionsForTest({ output: "text" });

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("★ TTL 过期后:同一筛选参数的下一次挂载重新取数,拿到新增 provider(不必整页刷新)", async () => {
    let clock = 1_000_000;
    __setModelOptionsNowFn(() => clock);
    const before = { providers: ["existing"], models: [{ provider: "existing", id: "m1", name: "M1" }] };
    const after = {
      providers: ["existing", "brand-new"],
      models: [
        { provider: "existing", id: "m1", name: "M1" },
        { provider: "brand-new", id: "m2", name: "M2" },
      ],
    };
    const fetchMock = vi.fn(async () => {
      const body = clock < 1_000_000 + MODEL_OPTIONS_CACHE_TTL_MS ? before : after;
      return { ok: true, status: 200, json: async () => body };
    });
    __setModelOptionsFetchImpl(fetchMock as unknown as typeof fetch);

    const first = await __loadModelOptionsForTest({ output: "text" });
    expect(first.providers).toEqual(["existing"]);

    // 过期(TTL 之后)—— 模拟"新增 provider 后,用户切走再切回同一设置面板"。
    clock += MODEL_OPTIONS_CACHE_TTL_MS + 1;
    const second = await __loadModelOptionsForTest({ output: "text" });

    expect(second.providers).toEqual(["existing", "brand-new"]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("★ TTL 未过期(时钟不推进),但收到 pi-web:config-saved 事件 → 下一次取数立即刷新(任务 6.6 主机制;修复前只有 TTL 时本用例必须报红)", async () => {
    const clock = 1_000_000; // 恒定不推进——仅靠事件驱动失效,不能靠 TTL 兜底救场。
    __setModelOptionsNowFn(() => clock);
    const before = { providers: ["existing"], models: [{ provider: "existing", id: "m1", name: "M1" }] };
    const after = {
      providers: ["existing", "brand-new"],
      models: [
        { provider: "existing", id: "m1", name: "M1" },
        { provider: "brand-new", id: "m2", name: "M2" },
      ],
    };
    let saved = false;
    const fetchMock = vi.fn(async () => {
      const body = saved ? after : before;
      return { ok: true, status: 200, json: async () => body };
    });
    __setModelOptionsFetchImpl(fetchMock as unknown as typeof fetch);

    const first = await __loadModelOptionsForTest({ output: "text" });
    expect(first.providers).toEqual(["existing"]);

    // 保存成功后 useConfigDomain 会广播该事件;这里直接模拟广播,不经 React 组件。
    saved = true;
    globalThis.dispatchEvent(
      new CustomEvent("pi-web:config-saved", { detail: { domain: "providers" } }),
    );
    const second = await __loadModelOptionsForTest({ output: "text" });

    expect(second.providers).toEqual(["existing", "brand-new"]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
