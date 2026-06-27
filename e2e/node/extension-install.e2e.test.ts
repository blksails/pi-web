/**
 * Node e2e — install_extension 工具用**真实 pi.exec** 真装（spec extension-install-agent-tools）。
 *
 * 不依赖 LLM/浏览器:直接以真实 `pi.exec`(spawn 真实 pi CLI)驱动扩展工具的 execute,验证端到端
 * 真链路 —— gate 放行 → ctx.ui.setStatus(安装中) → 真实 pi install 写入**隔离 HOME** 的
 * settings.json → ctx.ui.notify(已安装) → 排队 /reload-runtime。全程不污染真实 ~/.pi。
 *
 * (LLM 真正调用 install_extension 那段属 LLM 行为,由 design 的 piece-wise 验证覆盖:扩展加载
 * 经真实 runner probe 证、ctx.ui→StatusBar 经 chrome 证;此测试补「工具→真实安装」最后一环。)
 */
import { afterAll, describe, expect, it, vi } from "vitest";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { execSync } from "node:child_process";
import extensionManager from "../../packages/tool-kit/src/extension-tools/extension-manager.js";

const PI_CLI = execSync(
  'find node_modules/.pnpm -path "*pi-coding-agent*/dist/cli.js" 2>/dev/null | head -1',
)
  .toString()
  .trim();

const tempDirs: string[] = [];
function tmp(prefix: string): string {
  const d = mkdtempSync(path.join(tmpdir(), prefix));
  tempDirs.push(d);
  return d;
}
afterAll(() => {
  for (const d of tempDirs) rmSync(d, { recursive: true, force: true });
  process.env = { ...ORIG };
});
const ORIG = { ...process.env };

/** 真实 pi.exec:把 ("pi", args) 映射为 `node <cli.js> args`,以隔离 HOME 运行。 */
function realExec(home: string) {
  return (command: string, args: string[]) =>
    new Promise<{ stdout: string; stderr: string; code: number; killed: boolean }>((resolve) => {
      const child = spawn(process.execPath, [PI_CLI, ...args], {
        env: { PATH: process.env.PATH, HOME: home, GIT_TERMINAL_PROMPT: "0", CI: "1" },
        stdio: ["ignore", "pipe", "pipe"],
      });
      let stdout = "";
      let stderr = "";
      child.stdout.on("data", (d) => (stdout += d.toString()));
      child.stderr.on("data", (d) => (stderr += d.toString()));
      child.on("close", (code) => resolve({ stdout, stderr, code: code ?? 1, killed: false }));
    });
}

function registerAndGet() {
  const tools = new Map<string, any>();
  const sendUserMessage = vi.fn();
  let execImpl: (c: string, a: string[]) => Promise<any> = async () => ({ code: 1, stdout: "", stderr: "", killed: false });
  const pi = {
    registerTool: (t: any) => tools.set(t.name, t),
    registerCommand: () => {},
    exec: (c: string, a: string[]) => execImpl(c, a),
    sendUserMessage,
  };
  extensionManager(pi as never);
  return { tools, sendUserMessage, setExec: (f: typeof execImpl) => (execImpl = f) };
}

describe("install_extension 真实 pi 安装(隔离 HOME)", () => {
  it("放行 → 真装到隔离 HOME settings.json + ctx.ui 进度/结果 + 排队 reload;真实 ~/.pi 零污染", async () => {
    if (PI_CLI.length === 0) throw new Error("pi CLI not resolved");

    // 1) 隔离 HOME + 最小本地扩展包。
    const home = tmp("pi-ext-e2e-home-");
    mkdirSync(path.join(home, ".pi", "agent"), { recursive: true });
    const ext = tmp("pi-ext-e2e-pkg-");
    mkdirSync(path.join(ext, "extensions"), { recursive: true });
    writeFileSync(path.join(ext, "package.json"), '{ "name": "pi-web-e2e-ext", "version": "0.0.1", "type": "module", "keywords": ["pi-package"] }');
    writeFileSync(path.join(ext, "extensions", "hello.js"), 'export default (ctx) => ({ name: "pi-web-e2e-ext", async activate() { return {}; } });');

    // 2) 门控放行 local。
    process.env.PI_WEB_EXT_ADMIN_ALLOW_ANY = "1";
    process.env.PI_WEB_EXT_ALLOW_LOCAL = "1";

    const { tools, sendUserMessage, setExec } = registerAndGet();
    setExec(realExec(home));

    const setStatus = vi.fn();
    const notify = vi.fn();
    const ctx = { ui: { setStatus, notify, setWidget: vi.fn() } };

    // 3) 真实执行。
    await tools.get("install_extension").execute("id", { source: `local:${ext}` }, undefined, undefined, ctx as never);

    // 4) ctx.ui 进度先于结果;成功通知;排队 reload。
    expect(setStatus).toHaveBeenNthCalledWith(1, "ext-install", expect.stringContaining("安装中"));
    expect(setStatus).toHaveBeenLastCalledWith("ext-install", undefined);
    expect(notify).toHaveBeenCalledWith(expect.stringContaining("已安装"), "info");
    expect(sendUserMessage).toHaveBeenCalledWith("/reload-runtime", { deliverAs: "followUp" });

    // 5) 真实 pi install 写入隔离 HOME 的 settings.json(含该包)。
    const settingsPath = path.join(home, ".pi", "agent", "settings.json");
    expect(existsSync(settingsPath)).toBe(true);
    const settings = JSON.parse(readFileSync(settingsPath, "utf8")) as { packages?: string[] };
    // pi 把 local 源以路径写入 settings.packages(非包名);断言含临时包目录名。
    const pkgDirName = path.basename(ext);
    expect((settings.packages ?? []).join(" ")).toContain(pkgDirName);

    // 6) 真实 ~/.pi 零污染。
    const realSettings = path.join(ORIG.HOME ?? "/nonexistent", ".pi", "agent", "settings.json");
    if (existsSync(realSettings)) {
      expect(readFileSync(realSettings, "utf8")).not.toContain(pkgDirName);
    }
  }, 30000);

  it("门控拒绝(白名单外 npm)→ 不调 pi,notify 来源被拒", async () => {
    process.env.PI_WEB_EXT_ADMIN_ALLOW_ANY = "1"; // mutate 放行但 scope 不在白名单
    const { tools, sendUserMessage, setExec } = registerAndGet();
    const exec = vi.fn(async () => ({ code: 0, stdout: "", stderr: "", killed: false }));
    setExec(exec as never);
    const notify = vi.fn();
    await tools.get("install_extension").execute("id", { source: "npm:@evil/pkg@1.0.0" }, undefined, undefined, { ui: { setStatus: vi.fn(), notify, setWidget: vi.fn() } } as never);
    expect(exec).not.toHaveBeenCalled();
    expect(sendUserMessage).not.toHaveBeenCalled();
    expect(notify).toHaveBeenCalledWith(expect.stringContaining("来源被拒"), "error");
  });
});
