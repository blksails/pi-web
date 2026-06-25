import { describe, expect, it, vi } from "vitest";
import { createClearHostCommand } from "@/lib/app/clear-host-command";

describe("createClearHostCommand", () => {
  it("调用 session.clearContext 并返回 clear-transcript effect", async () => {
    const clearContext = vi.fn(async () => undefined);
    const cmd = createClearHostCommand();
    const r = await cmd.execute({ session: { clearContext } as never, argv: "" });
    expect(clearContext).toHaveBeenCalledOnce();
    expect(r).toMatchObject({ command: "clear", effect: "clear-transcript" });
  });

  it("clearContext 抛错时仍返回 clear-transcript(best-effort,UI 仍清空)", async () => {
    const clearContext = vi.fn(async () => {
      throw new Error("通道不支持");
    });
    const cmd = createClearHostCommand();
    const r = await cmd.execute({ session: { clearContext } as never, argv: "" });
    expect(r.effect).toBe("clear-transcript");
  });

  it("name 为 clear", () => {
    expect(createClearHostCommand().name).toBe("clear");
  });
});
