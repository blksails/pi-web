import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { cpSync, mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

/**
 * e2e:项目级 `.pi/` 资源加载受 project trust 门控,且 pi-web 经
 * `PI_WEB_TRUST_PROJECT=1`(custom 模式 trust 信号,由 startRunner 读取)放行。
 *
 * 真启 bootstrap runner 子进程,工作目录(cwd)下放一个零依赖的项目级扩展
 * `<cwd>/.pi/extensions/pi-probe-e2e.ts`,注册斜杠命令 `pi-probe-e2e`:
 *   - 带 PI_WEB_TRUST_PROJECT=1(信任)→ get_commands 含该 extension 命令;
 *   - 不带(默认不信任)→ 不含。
 * 这同时证明:① SDK 按 trust 门控 `.pi/`;② runner 读取 PI_WEB_TRUST_PROJECT(C-P2)。
 *
 * 用 hello-agent 作为已知可启动的 agent,仅改变 cwd 的 `.pi/` 与该 env,隔离变量。
 */

const here = dirname(fileURLToPath(import.meta.url));
const serverPkgDir = join(here, "..", "..");
const bootstrapEntry = join(serverPkgDir, "runner-bootstrap.mjs");
const exampleAgent = join(serverPkgDir, "..", "..", "examples", "hello-agent");
// 完整自包含示例:examples/pi-probe-agent(自带 .pi/extensions|agents|skills)。
const probeExampleDir = join(serverPkgDir, "..", "..", "examples", "pi-probe-agent");

// 零依赖的项目级扩展:不 import 任何包(避免临时 cwd 下的模块解析问题),
// 仅注册一个斜杠命令,供 get_commands 断言其加载。
const PROBE_EXTENSION = `export default function (pi) {
  pi.registerCommand("pi-probe-e2e", {
    description: "e2e probe: proves .pi/extensions loaded under project trust",
    handler: async () => {},
  });
}
`;

interface ProbeResult {
  commands: Array<{ name: string; source?: string }>;
  stderr: string;
}

interface LaunchOpts {
  trusted: boolean;
  /** agent 源(默认 hello-agent)。 */
  agent?: string;
  /** 准备 cwd 的 `.pi/`(默认写入零依赖合成扩展)。 */
  setupCwd?: (cwd: string) => void;
}

function launchAndGetCommands(opts: LaunchOpts): Promise<ProbeResult> {
  const { trusted } = opts;
  const agent = opts.agent ?? exampleAgent;
  const cwd = mkdtempSync(join(tmpdir(), "pi-trust-cwd-"));
  const agentDir = mkdtempSync(join(tmpdir(), "pi-trust-agentdir-"));
  if (opts.setupCwd !== undefined) {
    opts.setupCwd(cwd);
  } else {
    mkdirSync(join(cwd, ".pi", "extensions"), { recursive: true });
    writeFileSync(join(cwd, ".pi", "extensions", "pi-probe-e2e.ts"), PROBE_EXTENSION);
  }

  // 显式构造 env:仅信任分支设 PI_WEB_TRUST_PROJECT=1,否则确保未设(不继承 dev 环境)。
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (v !== undefined && k !== "PI_WEB_TRUST_PROJECT") env[k] = v;
  }
  if (trusted) env["PI_WEB_TRUST_PROJECT"] = "1";

  const proc: ChildProcessWithoutNullStreams = spawn(
    process.execPath,
    [bootstrapEntry, "--agent", agent, "--cwd", cwd, "--agent-dir", agentDir],
    { cwd, env, stdio: ["pipe", "pipe", "pipe"] },
  );

  const frames: unknown[] = [];
  let stdoutBuf = "";
  let stderrBuf = "";
  proc.stdout.setEncoding("utf8");
  proc.stdout.on("data", (chunk: string) => {
    stdoutBuf += chunk;
    let nl: number;
    while ((nl = stdoutBuf.indexOf("\n")) !== -1) {
      const line = stdoutBuf.slice(0, nl).trim();
      stdoutBuf = stdoutBuf.slice(nl + 1);
      if (line.length > 0) frames.push(JSON.parse(line));
    }
  });
  proc.stderr.setEncoding("utf8");
  proc.stderr.on("data", (chunk: string) => {
    stderrBuf += chunk;
  });

  return new Promise<ProbeResult>((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      reject(
        new Error(
          `Timed out waiting for get_commands.\nframes=${JSON.stringify(frames)}\nstderr=${stderrBuf}`,
        ),
      );
    }, 30000);
    const cleanup = (): void => {
      clearTimeout(timer);
      proc.stdout.off("data", onData);
      proc.stdin.end();
      proc.kill("SIGKILL");
    };
    const findResp = (): Record<string, unknown> | undefined =>
      frames.find(
        (f): f is Record<string, unknown> =>
          typeof f === "object" &&
          f !== null &&
          (f as { id?: string }).id === "gc1",
      );
    const onData = (): void => {
      const resp = findResp();
      if (resp !== undefined) {
        cleanup();
        // RpcResponse 形状:{ id, type:"response", command, success, data:{ commands } }。
        const data = resp["data"] as
          | { commands?: Array<{ name: string; source?: string }> }
          | undefined;
        resolve({ commands: data?.commands ?? [], stderr: stderrBuf });
      }
    };
    proc.stdout.on("data", onData);
    // boot 后发送 get_commands。子进程入口即进 runRpcMode,stdin 缓冲安全。
    proc.stdin.write(`${JSON.stringify({ id: "gc1", type: "get_commands" })}\n`);
    // 万一已就绪,主动检查一次。
    onData();
  });
}

describe("e2e — 项目级 .pi/extensions 受 trust 门控(PI_WEB_TRUST_PROJECT)", () => {
  const handles: Array<() => void> = [];
  afterEach(() => {
    for (const dispose of handles.splice(0)) dispose();
  });

  it("信任(PI_WEB_TRUST_PROJECT=1)→ get_commands 含 extension 命令 pi-probe-e2e", async () => {
    const { commands, stderr } = await launchAndGetCommands({ trusted: true });
    const probe = commands.find((c) => c.name === "pi-probe-e2e");
    expect(
      probe,
      `expected pi-probe-e2e command loaded from .pi/extensions; got ${JSON.stringify(commands)}; stderr=${stderr}`,
    ).toBeDefined();
    expect(probe?.source).toBe("extension");
  });

  it("不信任(无 PI_WEB_TRUST_PROJECT)→ get_commands 不含 pi-probe-e2e", async () => {
    const { commands } = await launchAndGetCommands({ trusted: false });
    expect(commands.some((c) => c.name === "pi-probe-e2e")).toBe(false);
  });

  it("完整示例 examples/pi-probe-agent:信任 → 其自带 .pi/extensions 的 /pi-probe + .pi/skills 加载", async () => {
    // 用真实示例 agent;把示例自带的 .pi/ 复制进临时 cwd(零污染示例目录)。
    const { commands, stderr } = await launchAndGetCommands({
      trusted: true,
      agent: probeExampleDir,
      setupCwd: (cwd) => cpSync(join(probeExampleDir, ".pi"), join(cwd, ".pi"), { recursive: true }),
    });
    const ext = commands.find((c) => c.name === "pi-probe");
    expect(
      ext,
      `expected example .pi/extensions command /pi-probe; got ${JSON.stringify(commands)}; stderr=${stderr}`,
    ).toBeDefined();
    expect(ext?.source).toBe("extension");
    // .pi/skills/pi-probe → 以斜杠命令 skill:pi-probe-skill 暴露,source:"skill"。
    expect(commands.some((c) => c.name === "skill:pi-probe-skill" && c.source === "skill")).toBe(true);
  });
});
