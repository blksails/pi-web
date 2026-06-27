import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import extensionManager, { parseListLines, parseInstallArgs } from "../../src/extension-tools/extension-manager.js";
import { gateInstall, gateMutate, checkAllowlist, DEFAULT_ALLOWLIST } from "../../src/extension-tools/gate.js";

/** 捕获 registerTool/registerCommand 的假 pi（ExtensionAPI 子集）。 */
function makeFakePi() {
  const tools = new Map<string, any>();
  const commands = new Map<string, any>();
  const exec = vi.fn(async () => ({ stdout: "", stderr: "", code: 0, killed: false }));
  const sendUserMessage = vi.fn();
  const pi = {
    registerTool: (t: any) => tools.set(t.name, t),
    registerCommand: (name: string, opts: any) => commands.set(name, opts),
    exec,
    sendUserMessage,
  };
  extensionManager(pi as never);
  return { pi, tools, commands, exec, sendUserMessage };
}

/** 假 ctx：ui spy + reload spy（命令 ctx 为 ExtensionCommandContext，可 reload）。 */
function makeCtx() {
  const setStatus = vi.fn();
  const notify = vi.fn();
  const setWidget = vi.fn();
  const reload = vi.fn(async () => {});
  return { ctx: { ui: { setStatus, notify, setWidget }, reload } as never, setStatus, notify, setWidget, reload };
}

const ORIG = { ...process.env };
afterEach(() => {
  process.env = { ...ORIG };
  vi.restoreAllMocks();
});

describe("extension-manager 注册", () => {
  it("注册三个工具 + reload-runtime + /plugin 用户向命令", () => {
    const { tools, commands } = makeFakePi();
    expect([...tools.keys()].sort()).toEqual(["install_extension", "list_extensions", "uninstall_extension"]);
    expect([...commands.keys()].sort()).toEqual(["plugin", "reload-runtime"]);
    // /plugin 带子命令描述（斜杠补全面板展示）。
    expect(commands.get("plugin").description).toContain("/plugin install");
  });

  it("reload-runtime 命令 handler 调 ctx.reload()", async () => {
    const { commands } = makeFakePi();
    const reload = vi.fn(async () => {});
    await commands.get("reload-runtime").handler({}, { reload } as never);
    expect(reload).toHaveBeenCalledOnce();
  });
});

describe("/plugin 用户向命令（斜杠补全面板，无面板，子命令式）", () => {
  it("/plugin install：放行 → exec install + ctx.reload() 直接重载（不排队 followUp）", async () => {
    process.env.PI_WEB_EXT_ADMIN_ALLOW_ANY = "1";
    process.env.PI_WEB_EXT_ALLOW_LOCAL = "1";
    const { commands, exec, sendUserMessage } = makeFakePi();
    const { ctx, setStatus, notify, reload } = makeCtx();

    await commands.get("plugin").handler("install local:/tmp/x", ctx);

    expect(setStatus).toHaveBeenNthCalledWith(1, "ext-install", "安装中: local:/tmp/x…");
    expect(exec).toHaveBeenCalledWith("pi", ["install", "/tmp/x", "--no-approve"], expect.anything());
    expect(notify).toHaveBeenCalledWith(expect.stringContaining("已安装"), "info");
    // 命令直接 reload,不走工具的 followUp 排队。
    expect(reload).toHaveBeenCalledOnce();
    expect(sendUserMessage).not.toHaveBeenCalled();
  });

  it("/plugin install … -l：解析 local 标志 → install … -l", async () => {
    process.env.PI_WEB_EXT_ADMIN_ALLOW_ANY = "1";
    process.env.PI_WEB_EXT_ALLOW_LOCAL = "1";
    const { commands, exec } = makeFakePi();
    const { ctx } = makeCtx();
    await commands.get("plugin").handler("install local:/tmp/x -l", ctx);
    expect(exec).toHaveBeenCalledWith("pi", ["install", "/tmp/x", "--no-approve", "-l"], expect.anything());
  });

  it("/plugin install（缺来源）→ notify 提示来源，不 exec、不 reload", async () => {
    process.env.PI_WEB_EXT_ADMIN_ALLOW_ANY = "1";
    const { commands, exec } = makeFakePi();
    const { ctx, notify, reload } = makeCtx();
    await commands.get("plugin").handler("install", ctx);
    expect(exec).not.toHaveBeenCalled();
    expect(reload).not.toHaveBeenCalled();
    expect(notify).toHaveBeenCalledWith(expect.stringContaining("来源"), "error");
  });

  it("/plugin install：来源被拒 → 不 reload", async () => {
    process.env.PI_WEB_EXT_ADMIN_ALLOW_ANY = "1"; // local 未放行
    const { commands, exec } = makeFakePi();
    const { ctx, notify, reload } = makeCtx();
    await commands.get("plugin").handler("install local:/tmp/x", ctx);
    expect(exec).not.toHaveBeenCalled();
    expect(reload).not.toHaveBeenCalled();
    expect(notify).toHaveBeenCalledWith(expect.stringContaining("来源被拒"), "error");
  });

  it("/plugin uninstall：放行 → exec remove + ctx.reload()", async () => {
    process.env.PI_WEB_EXT_ADMIN_ALLOW_ANY = "1";
    const { commands, exec } = makeFakePi();
    const { ctx, reload } = makeCtx();
    await commands.get("plugin").handler("uninstall npm:pi-x", ctx);
    expect(exec).toHaveBeenCalledWith("pi", ["remove", "npm:pi-x"], expect.anything());
    expect(reload).toHaveBeenCalledOnce();
  });

  it("/plugin list（及裸 /plugin）→ exec list → setWidget，不 reload", async () => {
    const { commands, exec } = makeFakePi();
    exec.mockResolvedValue({ stdout: "User packages:\n  ../pi-x", stderr: "", code: 0, killed: false });
    const { ctx, setWidget, reload } = makeCtx();
    await commands.get("plugin").handler("list", ctx);
    expect(setWidget).toHaveBeenCalledWith("ext-list", expect.arrayContaining(["User packages:"]), expect.anything());
    expect(reload).not.toHaveBeenCalled();
    // 裸 /plugin 默认 list。
    await commands.get("plugin").handler("", ctx);
    expect(setWidget).toHaveBeenCalledTimes(2);
  });

  it("/plugin <未知子命令> → notify 提示用法，不 exec", async () => {
    const { commands, exec } = makeFakePi();
    const { ctx, notify } = makeCtx();
    await commands.get("plugin").handler("frobnicate x", ctx);
    expect(exec).not.toHaveBeenCalled();
    expect(notify).toHaveBeenCalledWith(expect.stringContaining("未知子命令"), "error");
  });

  it("parseInstallArgs：拆来源与 -l/--local 标志", () => {
    expect(parseInstallArgs("local:/tmp/x")).toEqual({ source: "local:/tmp/x", local: false });
    expect(parseInstallArgs("local:/tmp/x -l")).toEqual({ source: "local:/tmp/x", local: true });
    expect(parseInstallArgs("--local npm:@a/b@1.0.0")).toEqual({ source: "npm:@a/b@1.0.0", local: true });
    expect(parseInstallArgs("  ")).toEqual({ source: "", local: false });
  });
});

describe("install_extension", () => {
  it("happy path：setStatus(安装中) 先于 exec → 成功 notify + 清状态 + 排队 reload(followUp)", async () => {
    process.env.PI_WEB_EXT_ADMIN_ALLOW_ANY = "1";
    process.env.PI_WEB_EXT_ALLOW_LOCAL = "1";
    const { tools, exec, sendUserMessage } = makeFakePi();
    const { ctx, setStatus, notify } = makeCtx();

    await tools.get("install_extension").execute("id", { source: "local:/tmp/x" }, undefined, undefined, ctx);

    // 进度状态先于 exec。
    expect(setStatus).toHaveBeenNthCalledWith(1, "ext-install", "安装中: local:/tmp/x…");
    expect(exec).toHaveBeenCalledWith("pi", ["install", "/tmp/x", "--no-approve"], expect.objectContaining({ timeout: 120000 }));
    // 终态：清状态 + 成功通知 + 排队 reload。
    expect(setStatus).toHaveBeenLastCalledWith("ext-install", undefined);
    expect(notify).toHaveBeenCalledWith(expect.stringContaining("已安装"), "info");
    expect(sendUserMessage).toHaveBeenCalledWith("/reload-runtime", { deliverAs: "followUp" });
  });

  it("门控关（无 ADMIN_ALLOW_ANY）→ 不 exec，notify 禁用", async () => {
    process.env.PI_WEB_EXT_ALLOW_LOCAL = "1"; // allowMutate 仍关
    const { tools, exec, sendUserMessage } = makeFakePi();
    const { ctx, notify } = makeCtx();
    await tools.get("install_extension").execute("id", { source: "local:/tmp/x" }, undefined, undefined, ctx);
    expect(exec).not.toHaveBeenCalled();
    expect(sendUserMessage).not.toHaveBeenCalled();
    expect(notify).toHaveBeenCalledWith(expect.stringContaining("安装被禁用"), "error");
  });

  it("来源不在白名单 → 不 exec，notify 来源被拒", async () => {
    process.env.PI_WEB_EXT_ADMIN_ALLOW_ANY = "1"; // 放行 mutate 但 local 未放行
    const { tools, exec } = makeFakePi();
    const { ctx, notify } = makeCtx();
    await tools.get("install_extension").execute("id", { source: "local:/tmp/x" }, undefined, undefined, ctx);
    expect(exec).not.toHaveBeenCalled();
    expect(notify).toHaveBeenCalledWith(expect.stringContaining("来源被拒"), "error");
  });

  it("pi install 非零退出 → notify 失败 + 清状态，不排队 reload", async () => {
    process.env.PI_WEB_EXT_ADMIN_ALLOW_ANY = "1";
    process.env.PI_WEB_EXT_ALLOW_LOCAL = "1";
    const { tools, exec, sendUserMessage } = makeFakePi();
    exec.mockResolvedValueOnce({ stdout: "", stderr: "boom", code: 1, killed: false });
    const { ctx, notify, setStatus } = makeCtx();
    await tools.get("install_extension").execute("id", { source: "local:/tmp/x" }, undefined, undefined, ctx);
    expect(notify).toHaveBeenCalledWith(expect.stringContaining("boom"), "error");
    expect(setStatus).toHaveBeenLastCalledWith("ext-install", undefined);
    expect(sendUserMessage).not.toHaveBeenCalled();
  });
});

describe("uninstall_extension / list_extensions", () => {
  it("uninstall：放行 → exec remove + 排队 reload", async () => {
    process.env.PI_WEB_EXT_ADMIN_ALLOW_ANY = "1";
    const { tools, exec, sendUserMessage } = makeFakePi();
    const { ctx } = makeCtx();
    await tools.get("uninstall_extension").execute("id", { name: "npm:pi-x" }, undefined, undefined, ctx);
    expect(exec).toHaveBeenCalledWith("pi", ["remove", "npm:pi-x"], expect.anything());
    expect(sendUserMessage).toHaveBeenCalledWith("/reload-runtime", { deliverAs: "followUp" });
  });

  it("uninstall：门控关 → 不 exec", async () => {
    const { tools, exec } = makeFakePi();
    const { ctx, notify } = makeCtx();
    await tools.get("uninstall_extension").execute("id", { name: "x" }, undefined, undefined, ctx);
    expect(exec).not.toHaveBeenCalled();
    expect(notify).toHaveBeenCalledWith(expect.stringContaining("卸载被禁用"), "error");
  });

  it("list：exec list → setWidget(解析行)", async () => {
    const { tools, exec } = makeFakePi();
    exec.mockResolvedValueOnce({ stdout: "User packages:\n  ../pi-x\n    /tmp/pi-x", stderr: "", code: 0, killed: false });
    const { ctx, setWidget } = makeCtx();
    await tools.get("list_extensions").execute("id", {}, undefined, undefined, ctx);
    expect(setWidget).toHaveBeenCalledWith("ext-list", expect.arrayContaining(["User packages:"]), expect.objectContaining({ placement: "aboveEditor" }));
  });
});

describe("gate", () => {
  it("gateInstall：门控全关 → allowMutate false", () => {
    const r = gateInstall("local:/x", {});
    expect(r.allowMutate).toBe(false);
  });
  it("gateInstall：ALLOW_LOCAL 放行 local", () => {
    const r = gateInstall("local:/x", { PI_WEB_EXT_ADMIN_ALLOW_ANY: "1", PI_WEB_EXT_ALLOW_LOCAL: "1" });
    expect(r.allowMutate).toBe(true);
    expect(r.decision.allowed).toBe(true);
  });
  it("gateInstall：ALLOW_NPM 放行任意 npm（仍要精确版本）", () => {
    const r = gateInstall("npm:foo@1.2.3", { PI_WEB_EXT_ADMIN_ALLOW_ANY: "1", PI_WEB_EXT_ALLOW_NPM: "1" });
    expect(r.decision.allowed).toBe(true);
    const bad = gateInstall("npm:foo@^1", { PI_WEB_EXT_ADMIN_ALLOW_ANY: "1", PI_WEB_EXT_ALLOW_NPM: "1" });
    expect(bad.decision.allowed).toBe(false);
  });
  it("checkAllowlist：默认白名单放行 @pi-web scope、拒裸 http", () => {
    expect(checkAllowlist("npm:@pi-web/x@1.0.0", DEFAULT_ALLOWLIST).allowed).toBe(true);
    expect(checkAllowlist("local:/x", DEFAULT_ALLOWLIST).allowed).toBe(false);
    expect(checkAllowlist("https://evil.com/u/r@deadbeef0000000000000000000000000000beef", DEFAULT_ALLOWLIST).allowed).toBe(false);
  });
  it("gateMutate：仅 ADMIN_ALLOW_ANY 决定", () => {
    expect(gateMutate({})).toBe(false);
    expect(gateMutate({ PI_WEB_EXT_ADMIN_ALLOW_ANY: "1" })).toBe(true);
  });
  it("parseListLines：空输出降级", () => {
    expect(parseListLines("")).toEqual(["(无已安装扩展)"]);
  });
});
