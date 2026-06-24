/**
 * CLI 参数解析与 env 映射单测(spec pi-web-cli, Task 3.1)。
 * 覆盖 parseCliArgs / buildEnv 纯函数:Req 1.3, 2.1-2.7, 5.1-5.3。
 */
import { describe, it, expect, vi } from "vitest";
import { resolve, isAbsolute } from "node:path";
import { createServer } from "node:http";
import { parseCliArgs, buildEnv, CliUsageError, findFreePort } from "@/bin/pi-web.mjs";
import { isHotReloadEnabled } from "@/packages/server/src/rpc-channel/hot-reload";

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
