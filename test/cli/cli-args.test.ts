/**
 * CLI 参数解析与 env 映射单测(spec pi-web-cli, Task 3.1)。
 * 覆盖 parseCliArgs / buildEnv 纯函数:Req 1.3, 2.1-2.7, 5.1-5.3。
 */
import { describe, it, expect, vi } from "vitest";
import { resolve, isAbsolute } from "node:path";
import { createServer } from "node:http";
import {
  parseCliArgs,
  buildEnv,
  CliUsageError,
  findFreePort,
  waitForReady,
  distServerJs,
  buildCandidatePathDeps,
  resolveFirstExistingCandidate,
  main,
} from "@/bin/pi-web.mjs";
import { isHotReloadEnabled } from "@/packages/core/src/rpc-channel/hot-reload";

const BASE = "/home/user/proj";
const ENV = { PATH: "/usr/bin", ANTHROPIC_API_KEY: "sk-secret" };

describe("parseCliArgs", () => {
  it("解析端口(短选项)、主机、布尔开关", () => {
    const o = parseCliArgs(["./agent", "-p", "8080", "--host", "0.0.0.0", "--stub", "--open"]);
    expect(o.intent).toBe("run");
    expect(o.source).toBe("./agent");
    expect(o.port).toBe(8080);
    expect(o.host).toBe("0.0.0.0");
    expect(o.stub).toBe(true);
    expect(o.open).toBe(true);
  });

  it("--help / --version 短路为对应 intent (Req 5.1, 5.2)", () => {
    expect(parseCliArgs(["--help"]).intent).toBe("help");
    expect(parseCliArgs(["-h"]).intent).toBe("help");
    expect(parseCliArgs(["--version"]).intent).toBe("version");
    expect(parseCliArgs(["-v"]).intent).toBe("version");
  });

  it("未知选项抛 CliUsageError (Req 5.3)", () => {
    expect(() => parseCliArgs(["--bogus"])).toThrow(CliUsageError);
  });

  it("非法端口抛 CliUsageError (Req 5.3)", () => {
    expect(() => parseCliArgs(["-p", "abc"])).toThrow(CliUsageError);
    expect(() => parseCliArgs(["-p", "0"])).toThrow(CliUsageError);
    expect(() => parseCliArgs(["-p", "70000"])).toThrow(CliUsageError);
  });

  it("多个位置参数抛 CliUsageError", () => {
    expect(() => parseCliArgs(["a", "b"])).toThrow(CliUsageError);
  });

  it("--watch 布尔(Req 8.1)", () => {
    expect(parseCliArgs(["./a", "--watch"]).watch).toBe(true);
    expect(parseCliArgs(["./a"]).watch).toBe(false);
  });
});

describe("buildEnv", () => {
  it("省略 source → 默认 source 为绝对化的当前目录 (Req 1.3)", () => {
    const env = buildEnv(parseCliArgs([]), BASE, ENV);
    expect(env.PI_WEB_DEFAULT_SOURCE).toBe(BASE);
    expect(isAbsolute(env.PI_WEB_DEFAULT_SOURCE!)).toBe(true);
  });

  it("相对 source 以调用目录绝对化 (research §2.2)", () => {
    const env = buildEnv(parseCliArgs(["./examples/hello-agent"]), BASE, ENV);
    expect(env.PI_WEB_DEFAULT_SOURCE).toBe(resolve(BASE, "./examples/hello-agent"));
  });

  it("git 来源不被当本地路径绝对化", () => {
    const env = buildEnv(parseCliArgs(["https://github.com/x/y@main"]), BASE, ENV);
    expect(env.PI_WEB_DEFAULT_SOURCE).toBe("https://github.com/x/y@main");
  });

  it("相对 --cwd 与 --agent-dir 绝对化 (Req 2.4, 2.5)", () => {
    const env = buildEnv(parseCliArgs([".", "--cwd", "work", "--agent-dir", ".pi"]), BASE, ENV);
    expect(env.PI_WEB_DEFAULT_CWD).toBe(resolve(BASE, "work"));
    expect(env.PI_WEB_AGENT_DIR).toBe(resolve(BASE, ".pi"));
  });

  it("端口/主机缺省值 3000 / 127.0.0.1 (Req 2.2, 2.3)", () => {
    const env = buildEnv(parseCliArgs([]), BASE, ENV);
    expect(env.PORT).toBe("3000");
    expect(env.HOSTNAME).toBe("127.0.0.1");
  });

  it("端口/主机被选项覆盖", () => {
    const env = buildEnv(parseCliArgs([".", "-p", "8080", "--host", "0.0.0.0"]), BASE, ENV);
    expect(env.PORT).toBe("8080");
    expect(env.HOSTNAME).toBe("0.0.0.0");
  });

  it("--stub → PI_WEB_STUB_AGENT=1 (Req 2.6)", () => {
    expect(buildEnv(parseCliArgs([".", "--stub"]), BASE, ENV).PI_WEB_STUB_AGENT).toBe("1");
    expect(buildEnv(parseCliArgs(["."]), BASE, ENV).PI_WEB_STUB_AGENT).toBeUndefined();
  });

  it("凭据类 env 原样透传(不丢失、不改写)(Req 2.7)", () => {
    const env = buildEnv(parseCliArgs([]), BASE, ENV);
    expect(env.ANTHROPIC_API_KEY).toBe("sk-secret");
    expect(env.PATH).toBe("/usr/bin");
  });

  it("CLI 总注入 PI_WEB_AUTOSTART=1(直接进会话,跳过选源页)(Req 9.1)", () => {
    expect(buildEnv(parseCliArgs(["./agent"]), BASE, ENV).PI_WEB_AUTOSTART).toBe("1");
    expect(buildEnv(parseCliArgs([]), BASE, ENV).PI_WEB_AUTOSTART).toBe("1");
  });

  it("--watch 本地 source → PI_WEB_WATCH=1 + 监视路径(Req 8.1)", () => {
    const env = buildEnv(parseCliArgs(["./agent", "--watch"]), BASE, ENV);
    expect(env.PI_WEB_WATCH).toBe("1");
    expect(env.PI_RUNNER_HOT_RELOAD_PATHS).toBe(resolve(BASE, "./agent"));
  });

  it("--watch + git source → 不注入监视(Req 8.4)", () => {
    const env = buildEnv(parseCliArgs(["https://github.com/x/y@main", "--watch"]), BASE, ENV);
    expect(env.PI_WEB_WATCH).toBeUndefined();
    expect(env.PI_RUNNER_HOT_RELOAD_PATHS).toBeUndefined();
  });

  it("无 --watch → 不注入监视(Req 8.3)", () => {
    expect(buildEnv(parseCliArgs(["./agent"]), BASE, ENV).PI_WEB_WATCH).toBeUndefined();
  });
});

describe("isHotReloadEnabled 门控(Req 8.2)", () => {
  it("PI_WEB_WATCH=1 在 production 下也启用", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("PI_WEB_WATCH", "1");
    expect(isHotReloadEnabled()).toBe(true);
    vi.unstubAllEnvs();
  });

  it("无显式信号且 production → 不启用(既有 dev 路径不回归)", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("PI_WEB_WATCH", "");
    vi.stubEnv("PI_RUNNER_HOT_RELOAD", "");
    expect(isHotReloadEnabled()).toBe(false);
    vi.unstubAllEnvs();
  });
});

describe("findFreePort 端口自动切换(Req 2.8)", () => {
  it("起始端口被占用 → 跳过,返回更高的空闲端口", async () => {
    const srv = createServer();
    await new Promise<void>((r) => srv.listen(0, "127.0.0.1", r));
    const occupied = (srv.address() as { port: number }).port;
    try {
      const free = await findFreePort("127.0.0.1", occupied, 20);
      expect(free).toBeDefined();
      expect(free).not.toBe(occupied);
      expect(free!).toBeGreaterThan(occupied);
    } finally {
      srv.close();
    }
  });

  it("一段范围全被占用 → 返回 undefined", async () => {
    const srv = createServer();
    await new Promise<void>((r) => srv.listen(0, "127.0.0.1", r));
    const occupied = (srv.address() as { port: number }).port;
    try {
      // maxTries=1 且唯一候选被占 → 无空闲
      const free = await findFreePort("127.0.0.1", occupied, 1);
      expect(free).toBeUndefined();
    } finally {
      srv.close();
    }
  });
});

// spec pi-web-desktop task 1.2:桌面壳复用 CLI 就绪探针与产物定位,故二者须为导出且行为不变。
describe("桌面壳复用的导出原语(pi-web-desktop 1.2)", () => {
  // ★ 入口必须位于**产物根**:CLI 以 dirname(serverJs) 作 cwd,而 packages/server 的
  // runnerBootstrapPath()/resolvePiCliEntry() 在 import.meta.url 被内联后回退到 cwd。
  it("distServerJs 返回 dist/server.mjs 绝对路径(入口在产物根)", () => {
    const p = distServerJs();
    expect(isAbsolute(p)).toBe(true);
    expect(p.replaceAll("\\", "/")).toMatch(/\/dist\/server\.mjs$/);
    // 产物根 = 入口所在目录,不得有额外层级。
    expect(p.replaceAll("\\", "/")).not.toMatch(/\/dist\/[^/]+\/server\.mjs$/);
  });

  it("distServerJs 尊重 PI_WEB_DIST_DIR 覆盖(与隔离构建一致)", () => {
    const prev = process.env.PI_WEB_DIST_DIR;
    process.env.PI_WEB_DIST_DIR = "dist-desktop-test";
    try {
      expect(distServerJs().replaceAll("\\", "/")).toMatch(
        /dist-desktop-test\/server\.mjs$/,
      );
    } finally {
      if (prev === undefined) delete process.env.PI_WEB_DIST_DIR;
      else process.env.PI_WEB_DIST_DIR = prev;
    }
  });

  it("waitForReady 对活着的 HTTP 服务 resolve(任何响应即就绪)", async () => {
    const srv = createServer((_req, res) => {
      res.statusCode = 200;
      res.end("ok");
    });
    await new Promise<void>((r) => srv.listen(0, "127.0.0.1", r));
    const port = (srv.address() as { port: number }).port;
    try {
      await expect(waitForReady("127.0.0.1", port)).resolves.toBeUndefined();
    } finally {
      srv.close();
    }
  });

  it("waitForReady 在信号 aborted 时 reject(server 早退路径)", async () => {
    // 未监听的端口 + 立即 aborted 信号 → 不等待,直接 reject。
    await expect(
      waitForReady("127.0.0.1", 1, { aborted: true }),
    ).rejects.toThrow();
  });
});

// spec cli-agent-build 任务 1.5:壳层构造并注入的工具链/样式预设候选路径(Req 4.2, 4.5, 1.7)。
describe("buildCandidatePathDeps 候选路径构造(cli-agent-build 1.5)", () => {
  const DIST_ROOT = "/dist-root";
  const PKG_ROOT_FIXTURE = "/pkg-root";

  it("产出 examples/toolchain/style-preset 三组两级候选,产物根优先、包根兜底", () => {
    const deps = buildCandidatePathDeps(DIST_ROOT, PKG_ROOT_FIXTURE);
    expect(deps.examplesRootCandidates).toEqual([
      "/dist-root/examples",
      "/pkg-root/examples",
    ]);
    expect(deps.toolchainRootCandidates).toEqual([
      "/dist-root/node_modules",
      "/pkg-root/node_modules",
    ]);
    expect(deps.stylePresetCandidates).toEqual([
      "/dist-root/packages/ui/tailwind-preset.ts",
      "/pkg-root/packages/ui/tailwind-preset.ts",
    ]);
  });

  it("不触碰文件系统(纯字符串拼接,同一输入恒产出同一结果)", () => {
    const a = buildCandidatePathDeps(DIST_ROOT, PKG_ROOT_FIXTURE);
    const b = buildCandidatePathDeps(DIST_ROOT, PKG_ROOT_FIXTURE);
    expect(a).toEqual(b);
  });
});

describe("resolveFirstExistingCandidate 首个存在者解析(cli-agent-build 1.5)", () => {
  it("首个存在 → 返回该候选路径(命中非首位时仍正确跳过前面不存在的)", () => {
    const exists = (p: string) => p === "/b/tailwind-preset.ts";
    const resolved = resolveFirstExistingCandidate(
      ["/a/tailwind-preset.ts", "/b/tailwind-preset.ts", "/c/tailwind-preset.ts"],
      exists,
    );
    expect(resolved).toBe("/b/tailwind-preset.ts");
  });

  it("全部缺失 → 返回 undefined,不抛异常", () => {
    const neverExists = () => false;
    const resolved = resolveFirstExistingCandidate(
      ["/a/node_modules", "/b/node_modules"],
      neverExists,
    );
    expect(resolved).toBeUndefined();
  });
});

// spec cli-agent-build 任务 4.1:build 子命令接入主 CLI 的壳层选项面(Req 1.1, 1.2, 1.4)。
describe("parseCliArgs — build 子命令词条(cli-agent-build 4.1)", () => {
  it("`build [source]` 判别为 subcommand 意图,argv 正确切片,接受 --panes/--sign/--out", () => {
    const o = parseCliArgs(["build", "./my-agent", "--panes", "panes/modules.ts", "--sign", "key-b64", "--out", "dist"]);
    expect(o.intent).toBe("subcommand");
    if (o.intent !== "subcommand") throw new Error("unreachable");
    expect(o.name).toBe("build");
    expect(o.argv).toEqual(["./my-agent", "--panes", "panes/modules.ts", "--sign", "key-b64", "--out", "dist"]);
  });

  it("省略位置参数也判别为 subcommand 意图(缺省当前目录留给实现层处理,Req 1.3)", () => {
    const o = parseCliArgs(["build"]);
    expect(o.intent).toBe("subcommand");
    if (o.intent !== "subcommand") throw new Error("unreachable");
    expect(o.name).toBe("build");
    expect(o.argv).toEqual([]);
  });

  it("`build --help` → help 意图且带 subcommand=build", () => {
    const o = parseCliArgs(["build", "--help"]);
    expect(o).toEqual({ intent: "help", subcommand: "build" });
  });

  it("build 下非法选项抛 CliUsageError,含选项名与查看帮助的提示;解析本身不触碰 fs/网络(同步抛出)(Req 1.4)", () => {
    try {
      parseCliArgs(["build", "--bogus"]);
      throw new Error("应当抛出");
    } catch (err) {
      expect(err).toBeInstanceOf(CliUsageError);
      expect((err as Error).message).toContain("--bogus");
      expect((err as Error).message).toContain("pi-web build --help");
    }
  });

  it("build 的选项不串味:create 不接受 --panes;list 不接受 --sign", () => {
    expect(() => parseCliArgs(["create", "x", "--panes", "p.ts"])).toThrow(CliUsageError);
    expect(() => parseCliArgs(["list", "--sign", "k"])).toThrow(CliUsageError);
  });
});

describe("main() — 顶层与子命令帮助含 build(cli-agent-build 4.1,Req 1.1, 1.2)", () => {
  it("main(['--help']) 输出的子命令列表含 build 及一句话说明,退出码 0", async () => {
    const chunks: string[] = [];
    const spy = vi.spyOn(process.stdout, "write").mockImplementation((c: unknown) => {
      chunks.push(String(c));
      return true;
    });
    try {
      const code = await main(["--help"]);
      expect(code).toBe(0);
      const out = chunks.join("");
      expect(out).toContain("build");
    } finally {
      spy.mockRestore();
    }
  });

  it("main(['build', '--help']) 输出子命令专属用法,退出码 0", async () => {
    const chunks: string[] = [];
    const spy = vi.spyOn(process.stdout, "write").mockImplementation((c: unknown) => {
      chunks.push(String(c));
      return true;
    });
    try {
      const code = await main(["build", "--help"]);
      expect(code).toBe(0);
      const out = chunks.join("");
      expect(out).toContain("pi-web build");
      expect(out).toContain("--panes");
    } finally {
      spy.mockRestore();
    }
  });
});
