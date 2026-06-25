import { describe, expect, it, vi } from "vitest";
import { createPluginHostCommand } from "@/lib/app/plugin-command/plugin-host-command";
import { DEFAULT_ALLOWLIST, type PiCli } from "@blksails/pi-web-server";

function fakePiCli(over: Partial<PiCli> = {}): PiCli & { runCalls: string[][] } {
  const runCalls: string[][] = [];
  return {
    runCalls,
    runPiCommand: async (args) => {
      runCalls.push([...args]);
      return { ok: true, stdout: "", exitCode: 0 };
    },
    listExtensions: async () => [
      { id: "npm:pi-x", kind: "npm", scope: "global" },
    ],
    ...over,
  };
}

const allowlistLocal = { ...DEFAULT_ALLOWLIST, allowLocal: true };
const session = { restartRunner: async () => undefined } as never;

describe("createPluginHostCommand", () => {
  it("空 argv → open-panel + 列表快照", async () => {
    const cmd = createPluginHostCommand({
      piCli: fakePiCli(),
      allowlist: DEFAULT_ALLOWLIST,
      allowMutate: false,
      reload: async () => undefined,
    });
    const r = await cmd.execute({ session, argv: "" });
    expect(r.effect).toBe("open-panel");
    expect((r.data as { extensions: unknown[] }).extensions).toHaveLength(1);
  });

  it("list → panel-refresh", async () => {
    const cmd = createPluginHostCommand({
      piCli: fakePiCli(),
      allowlist: DEFAULT_ALLOWLIST,
      allowMutate: false,
      reload: async () => undefined,
    });
    expect((await cmd.execute({ session, argv: "list" })).effect).toBe("panel-refresh");
  });

  it("install 本地源 → 调 pi install(npm/local args) + reload + panel-refresh", async () => {
    const piCli = fakePiCli();
    const reload = vi.fn(async () => undefined);
    const cmd = createPluginHostCommand({
      piCli,
      allowlist: allowlistLocal,
      allowMutate: true,
      reload,
    });
    const r = await cmd.execute({ session, argv: "install local:/tmp/x" });
    expect(piCli.runCalls[0]?.[0]).toBe("install");
    expect(reload).toHaveBeenCalledOnce();
    expect(r.effect).toBe("panel-refresh");
    expect(r.message).toContain("已安装");
  });

  it("install 无目标 → 抛用法错误", async () => {
    const cmd = createPluginHostCommand({
      piCli: fakePiCli(),
      allowlist: allowlistLocal,
      allowMutate: true,
      reload: async () => undefined,
    });
    await expect(cmd.execute({ session, argv: "install" })).rejects.toThrow(/用法/);
  });

  it("allowMutate=false → install 被拒(抛错)", async () => {
    const cmd = createPluginHostCommand({
      piCli: fakePiCli(),
      allowlist: allowlistLocal,
      allowMutate: false,
      reload: async () => undefined,
    });
    await expect(cmd.execute({ session, argv: "install local:/tmp/x" })).rejects.toThrow(
      /禁用/,
    );
  });

  it("install 不在白名单 → 抛来源被拒", async () => {
    const cmd = createPluginHostCommand({
      piCli: fakePiCli(),
      allowlist: DEFAULT_ALLOWLIST, // 不允许 local
      allowMutate: true,
      reload: async () => undefined,
    });
    await expect(cmd.execute({ session, argv: "install local:/tmp/x" })).rejects.toThrow(
      /来源被拒/,
    );
  });

  it("uninstall → 调 pi remove + reload", async () => {
    const piCli = fakePiCli();
    const cmd = createPluginHostCommand({
      piCli,
      allowlist: allowlistLocal,
      allowMutate: true,
      reload: async () => undefined,
    });
    await cmd.execute({ session, argv: "uninstall npm:pi-x" });
    expect(piCli.runCalls[0]?.[0]).toBe("remove");
  });

  it("pi install 失败(ok:false) → 抛错(由注册表转 notify)", async () => {
    const piCli = fakePiCli({
      runPiCommand: async () => ({ ok: false, stdout: "", exitCode: 1, errorSummary: "boom" }),
    });
    const cmd = createPluginHostCommand({
      piCli,
      allowlist: allowlistLocal,
      allowMutate: true,
      reload: async () => undefined,
    });
    await expect(cmd.execute({ session, argv: "install local:/tmp/x" })).rejects.toThrow(/boom/);
  });
});
