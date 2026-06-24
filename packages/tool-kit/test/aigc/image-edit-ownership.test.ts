/**
 * image_edit 输入附件越权/无效 → 降级不泄漏(Req 2.4)。
 *
 * 工具侧契约:输入图以 att_id 承载,`resolveMediaFields` → `ctx.resolve` 解析。
 * 当 resolve 抛错(越权被 beforeToolCall 拒后、或无效引用),工具必须返回 `ok:false`
 * 可读错误,且**不继续**调用 provider / `putOutput`(不访问越权资源、不产出半结果)。
 */
import { describe, it, expect, vi } from "vitest";
import { buildAigcTools } from "../../src/aigc/index.js";
import type { AttachmentToolContext } from "@blksails/pi-web-agent-kit";

describe("image_edit · 输入越权/无效降级(Req 2.4)", () => {
  it("ctx.resolve 抛错 → ok:false 且未调用 putOutput(不泄漏)", async () => {
    const saved = process.env["NEWAPI_API_KEY"];
    process.env["NEWAPI_API_KEY"] = "test-key";

    const putOutput = vi.fn(async () => {
      throw new Error("putOutput must not be called on ownership failure");
    });
    const fetchImpl = vi.fn(async () => {
      throw new Error("provider fetch must not be called on ownership failure");
    });
    const ctx: AttachmentToolContext = {
      available: true,
      async resolve() {
        throw new Error(
          "Attachment att_other is not owned by the current session.",
        );
      },
      putOutput: putOutput as unknown as AttachmentToolContext["putOutput"],
    };

    try {
      const tools = buildAigcTools({
        include: ["image_edit"],
        deps: {
          getCtx: () => ctx,
          fetchImpl: fetchImpl as unknown as typeof fetch,
        },
      });
      const tool = tools.find((t) => t.name === "image_edit")!;

      const result = await tool.execute(
        "tc-owner",
        { prompt: "make it red", image: "att_other_session" },
        undefined,
        undefined,
        {} as never,
      );

      const details = result.details as { ok: boolean; error?: string };
      expect(details.ok).toBe(false);
      expect(details.error).toMatch(/not owned|att_/i);
      // 关键:解析越权输入失败后,绝不访问 provider / 落库(不泄漏、不半产出)。
      expect(fetchImpl).not.toHaveBeenCalled();
      expect(putOutput).not.toHaveBeenCalled();
    } finally {
      if (saved !== undefined) process.env["NEWAPI_API_KEY"] = saved;
      else delete process.env["NEWAPI_API_KEY"];
    }
  });
});
