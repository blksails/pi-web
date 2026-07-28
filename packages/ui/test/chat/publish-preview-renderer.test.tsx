/**
 * PublishPreviewRenderer 单测(spec publish-host-command,任务 3.4)。
 *
 * 重点验三条渲染约定,它们各自对应一条需求,且都是"写错了不会报错、只会静默误导"的类型:
 *  1. 差异声明按**布尔位**渲染(Req 2) —— 断言结构而非中文子串;
 *  2. 告警是**独立区块**且与错误可辨(Req 5.2) —— 告警被吞掉 = 预览是假预览;
 *  3. 文件清单**不截断**(Req 1.2) —— 渲染条目数必须等于 files.length。
 */
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { PublishPreviewRenderer } from "../../src/chat/publish-preview-renderer.js";
import type { PublishPreviewData } from "@blksails/pi-web-protocol";

function renderCard(data: PublishPreviewData): HTMLElement {
  const { container } = render(
    <PublishPreviewRenderer
      part={{ type: "data-publish-preview", data } as never}
      message={{ id: "m1", role: "assistant", parts: [] } as never}
    />,
  );
  return container;
}

const OK: PublishPreviewData = {
  ok: true,
  package: { id: "acme/x", version: "1.0.0", kind: "agent", displayName: "X" },
  files: [
    { path: "index.ts", integrity: "sha384-aaaaaaaaaaaaaaaaaaaa" },
    { path: "skills/a.md", integrity: "sha384-bbbbbbbbbbbbbbbbbbbb" },
  ],
  warnings: [],
  disclaimers: { unsigned: true, grantNotChecked: true },
};

describe("差异声明(Req 2)", () => {
  it("两位皆 true → 两条声明各自渲染", () => {
    const c = renderCard(OK);
    expect(c.querySelector("[data-pi-publish-disclaimer]")).not.toBeNull();
    expect(c.querySelector("[data-pi-publish-unsigned]")).not.toBeNull();
    expect(c.querySelector("[data-pi-publish-grant-unchecked]")).not.toBeNull();
  });

  it("按布尔位分别渲染:只 unsigned 为 true 时,授予那条不出现", () => {
    const c = renderCard({ ...OK, disclaimers: { unsigned: true, grantNotChecked: false } });
    expect(c.querySelector("[data-pi-publish-unsigned]")).not.toBeNull();
    expect(c.querySelector("[data-pi-publish-grant-unchecked]")).toBeNull();
  });

  it("两位皆 false(将来真发布成功)→ 不渲染预览声明", () => {
    const c = renderCard({ ...OK, disclaimers: { unsigned: false, grantNotChecked: false } });
    expect(c.querySelector("[data-pi-publish-disclaimer]")).toBeNull();
  });
});

describe("告警(Req 5.2)", () => {
  it("告警逐条渲染,且与错误区块**分开**", () => {
    const c = renderCard({ ...OK, warnings: ["webext 产物可能陈旧", "另一条"] });
    expect(c.querySelectorAll("[data-pi-publish-warning]")).toHaveLength(2);
    // 成功态不应出现错误区块 —— 告警不是错误。
    expect(c.querySelector("[data-pi-publish-error]")).toBeNull();
  });

  it("无告警时不渲染告警区块(不留空壳)", () => {
    const c = renderCard(OK);
    expect(c.querySelector("[data-pi-publish-warnings]")).toBeNull();
  });
});

describe("文件清单(Req 1.2)", () => {
  it("渲染条目数 === files.length(证明未截断)", () => {
    const many = Array.from({ length: 40 }, (_, i) => ({
      path: `f${i}.ts`,
      integrity: `sha384-${"x".repeat(20)}`,
    }));
    const c = renderCard({ ...OK, files: many });
    expect(c.querySelectorAll("[data-pi-publish-file]")).toHaveLength(40);
    expect(screen.getByText(/40 个/)).toBeTruthy();
  });
});

describe("失败态", () => {
  it("渲染 code/message/hint,并标记 ok=false", () => {
    const c = renderCard({
      ok: false,
      files: [],
      warnings: [],
      disclaimers: { unsigned: true, grantNotChecked: true },
      error: { code: "PUBLISH_KIND_MISMATCH", message: "类别不符", hint: "请改用 /plugin publish。" },
    });
    expect(c.querySelector("[data-pi-publish-preview]")?.getAttribute("data-pi-publish-ok")).toBe("false");
    expect(c.querySelector("[data-pi-publish-error]")?.textContent).toContain("PUBLISH_KIND_MISMATCH");
    expect(c.querySelector("[data-pi-publish-hint]")?.textContent).toContain("/plugin publish");
  });

  it("形状不合契约 → 降级为 JSON 块,不崩", () => {
    const c = renderCard({ nope: 1 } as never);
    expect(c.querySelector("[data-pi-publish-parse-error]")).not.toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// spec publish-execution:真实发布结果
// ─────────────────────────────────────────────────────────────────────────────

const PUBLISHED: PublishPreviewData = {
  ...OK,
  disclaimers: { unsigned: false, grantNotChecked: false },
  published: {
    sourceId: "blksails/x",
    version: "1.0.0",
    bundle: "bundles/abc.tgz",
    channel: "stable",
    channelMoved: true,
    publisherId: "pub-1",
    org: "blksails",
  },
};

describe("已发布结果(spec publish-execution)", () => {
  it("渲染已发布块:包标识、发布者身份、通道", () => {
    const c = renderCard(PUBLISHED);
    expect(c.querySelector("[data-pi-publish-published]")).not.toBeNull();
    expect(c.querySelector("[data-pi-publish-published-id]")?.textContent).toBe("blksails/x@1.0.0");
    expect(c.querySelector("[data-pi-publish-identity]")?.textContent).toContain("pub-1");
    expect(c.querySelector("[data-pi-publish-identity]")?.textContent).toContain("blksails");
    expect(c.querySelector("[data-pi-publish-channel]")).not.toBeNull();
  });

  it("★ 不可逆提示恒在 —— 发布不像安装那样可以撤销", () => {
    expect(renderCard(PUBLISHED).querySelector("[data-pi-publish-immutable]")).not.toBeNull();
  });

  it("已发布时不出预览声明(两位皆 false)", () => {
    expect(renderCard(PUBLISHED).querySelector("[data-pi-publish-disclaimer]")).toBeNull();
  });

  it("★ 通道未移 → 部分成功可单独辨认,且**不是**普通的通道行", () => {
    const c = renderCard({
      ...PUBLISHED,
      published: { ...PUBLISHED.published!, channelMoved: false },
    });
    expect(c.querySelector("[data-pi-publish-channel-not-moved]")).not.toBeNull();
    expect(c.querySelector("[data-pi-publish-channel]")).toBeNull();
    // 结构化标记而非文案匹配 —— 改文案不该让这条断言静默失效。
    expect(
      c.querySelector("[data-pi-publish-published]")?.getAttribute("data-pi-publish-channel-moved"),
    ).toBe("false");
  });

  it("头行状态区分「已发布」与「已登记」", () => {
    expect(renderCard(PUBLISHED).textContent).toContain("已发布");
    const partial = renderCard({
      ...PUBLISHED,
      published: { ...PUBLISHED.published!, channelMoved: false },
    });
    expect(partial.textContent).toContain("已登记");
  });

  it("预览结果不带 published → 不渲染已发布块(既有路径零影响)", () => {
    expect(renderCard(OK).querySelector("[data-pi-publish-published]")).toBeNull();
  });
});
