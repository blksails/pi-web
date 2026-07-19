/**
 * examples/attachment-catalog-agent · jiti 装载冒烟(spec agent-attachment-catalog,任务 6.1)。
 *
 * 覆盖:
 *  - 经真实 `loadAgentDefinition`(jiti)装载示例,`attachmentCatalog` 归一化附加到工厂
 *    (形状校验通过,list/resolve 均为函数)。
 *  - `list`/`resolve` 的行为正确(过滤/惰性产出/未知 id 抛错)。
 *  - `publish-demo` route 在未注入 `AttachmentToolContext` seam 的进程内(本单测场景)
 *    安全降级为 `{ok:false}`,不抛不崩(兜底降级)。
 */
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { AgentContext } from "../../src/runner/agent-definition.js";
import { loadAgentDefinition } from "../../src/runner/agent-loader.js";
import { makeResolveProjectTrust } from "../../src/runner/project-trust.js";

const ATTACHMENT_CTX_KEY = "__piWebAttachmentToolContext__";

beforeEach(() => {
  delete (globalThis as Record<string, unknown>)[ATTACHMENT_CTX_KEY];
});
afterEach(() => {
  delete (globalThis as Record<string, unknown>)[ATTACHMENT_CTX_KEY];
});

const examplePath = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
  "..",
  "examples",
  "attachment-catalog-agent",
  "index.ts",
);

const ctx: AgentContext = { cwd: "/tmp/work", agentDir: "/tmp/agent", env: {}, settings: {} };
const trust = makeResolveProjectTrust(false);

describe("examples/attachment-catalog-agent — jiti 装载冒烟", () => {
  it("装载成功,attachmentCatalog 归一化附加(list/resolve 均为函数)", async () => {
    const factory = await loadAgentDefinition(examplePath, ctx, trust);
    expect(factory.attachmentCatalog).toBeDefined();
    expect(typeof factory.attachmentCatalog?.list).toBe("function");
    expect(typeof factory.attachmentCatalog?.resolve).toBe("function");
  });

  it("routes 归一化附加(publish-demo 已声明)", async () => {
    const factory = await loadAgentDefinition(examplePath, ctx, trust);
    expect(factory.routes?.some((r) => r.name === "publish-demo")).toBe(true);
  });

  it("list('') 枚举全部条目;list('month') 过滤命中 Monthly Report", async () => {
    const factory = await loadAgentDefinition(examplePath, ctx, trust);
    const all = await factory.attachmentCatalog!.list("");
    expect(all.length).toBeGreaterThanOrEqual(3);
    const filtered = await factory.attachmentCatalog!.list("month");
    expect(filtered).toHaveLength(1);
    expect(filtered[0]?.id).toBe("monthly-report");
  });

  it("resolve 已知 entryId → 产出字节;未知 entryId → 抛错", async () => {
    const factory = await loadAgentDefinition(examplePath, ctx, trust);
    const resolved = await factory.attachmentCatalog!.resolve("monthly-report");
    expect(resolved.name).toBe("Monthly Report.txt");
    expect(resolved.bytes.length).toBeGreaterThan(0);
    // resolve 声明允许同步返回(design.md 类型:`T | Promise<T>`);示例实现同步抛错,
    // 故此处直接断言同步抛出,而非 `.rejects`(后者要求被测表达式已是一个 rejected Promise)。
    expect(() => factory.attachmentCatalog!.resolve("ghost")).toThrow(
      "catalog entry not found: ghost",
    );
  });

  it("publish-demo route:未注入 AttachmentToolContext seam → 安全降级 {ok:false},不抛", async () => {
    const factory = await loadAgentDefinition(examplePath, ctx, trust);
    const route = factory.routes!.find((r) => r.name === "publish-demo")!;
    const result = (await route.handler({
      name: "publish-demo",
      method: "POST",
      query: {},
    })) as { ok: boolean };
    expect(result.ok).toBe(false);
  });
});
