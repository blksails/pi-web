/**
 * aigc-agent 装配集成测试(task 6;Req 5.3, 6.1, 6.2)。
 *
 * 验证「真实默认装配」路径(不注入 deps,工具经默认 `getAttachmentToolContext` 读 globalThis seam):
 *  - `buildAigcTools()` 产出 text_to_image 与 image_edit 两工具(6.1/6.2);
 *  - 未注入 attachment seam 且缺 provider 密钥时,工具调用返回结构化降级 `ok:false`、不抛错、
 *    不崩溃(5.3)——这正是 `examples/aigc-agent` 在 runner 装配缺失 / 密钥未配时的行为。
 */
import { describe, it, expect } from "vitest";
import { buildAigcTools } from "../../src/aigc/index.js";

const SEAM_KEY = "__piWebAttachmentToolContext__";

describe("aigc-agent 装配 · 默认路径", () => {
  it("buildAigcTools() 产出 text_to_image 与 image_edit 两工具", () => {
    const tools = buildAigcTools();
    const names = tools.map((t) => t.name).sort();
    expect(names).toEqual(["image_edit", "text_to_image"]);
  });

  it("include 筛选只编译子集", () => {
    const tools = buildAigcTools({ include: ["text_to_image"] });
    expect(tools.map((t) => t.name)).toEqual(["text_to_image"]);
  });

  it("未注入 seam / 缺 provider 密钥 → 工具调用降级而非抛错(5.3)", async () => {
    const savedEnv = { ...process.env };
    delete process.env["DASHSCOPE_API_KEY"];
    delete process.env["OPENROUTER_API_KEY"];
    delete process.env["NEWAPI_API_KEY"];
    const scope = globalThis as Record<string, unknown>;
    const savedSeam = scope[SEAM_KEY];
    delete scope[SEAM_KEY];
    try {
      const tools = buildAigcTools();
      const t2i = tools.find((t) => t.name === "text_to_image");
      expect(t2i).toBeDefined();
      const result = await t2i!.execute(
        "call-degrade",
        { prompt: "a calm lake" },
        undefined,
        undefined,
        {} as never,
      );
      const details = result.details as { ok: boolean; error?: string };
      expect(details.ok).toBe(false);
      expect(typeof details.error).toBe("string");
    } finally {
      Object.assign(process.env, savedEnv);
      if (savedSeam !== undefined) scope[SEAM_KEY] = savedSeam;
    }
  });
});
