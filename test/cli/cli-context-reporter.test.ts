// @vitest-environment node
/**
 * 共享运行上下文与进度报告器单测(spec cli-package-commands,任务 1.2,
 * Req 3.10, 3.11, 10.2, 10.3)。
 */
import { describe, it, expect } from "vitest";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import {
  createCliContext,
  resolveAgentDir,
  resolveSourcesRoot,
  defaultSourcesRoot,
  buildChildEnv,
} from "@/server/cli/context";
import { createProgressReporter, redactSecrets } from "@/server/cli/reporter";

const FAKE_CREDENTIAL = "sk-fake-SHOULD-NOT-APPEAR";

describe("CliContext: agentDir 解析", () => {
  it("未配 PI_WEB_AGENT_DIR 时回落 ~/.pi/agent", () => {
    expect(resolveAgentDir({})).toBe(join(homedir(), ".pi", "agent"));
  });

  it("尊重 PI_WEB_AGENT_DIR 覆盖", () => {
    expect(resolveAgentDir({ PI_WEB_AGENT_DIR: "/custom/agent-dir" })).toBe("/custom/agent-dir");
  });

  it("空字符串视为未配置,回落默认值", () => {
    expect(resolveAgentDir({ PI_WEB_AGENT_DIR: "" })).toBe(join(homedir(), ".pi", "agent"));
  });
});

describe("CliContext: sourcesRoot 解析", () => {
  it("未配 PI_WEB_SOURCES_ROOT 时回落 ~/.pi-web/agents(与既有默认一致)", () => {
    expect(resolveSourcesRoot({}, "/work")).toBe(defaultSourcesRoot());
    expect(defaultSourcesRoot()).toBe(join(homedir(), ".pi-web", "agents"));
  });

  it("尊重 PI_WEB_SOURCES_ROOT 的绝对路径", () => {
    expect(resolveSourcesRoot({ PI_WEB_SOURCES_ROOT: "/abs/sources" }, "/work")).toBe("/abs/sources");
  });

  it("相对路径以 cwd 绝对化", () => {
    expect(resolveSourcesRoot({ PI_WEB_SOURCES_ROOT: "rel/sources" }, "/work")).toBe(
      resolve("/work", "rel/sources"),
    );
  });

  it("多段(path.delimiter 分隔)取首个非空段作为写入目标", () => {
    const delim = process.platform === "win32" ? ";" : ":";
    expect(
      resolveSourcesRoot({ PI_WEB_SOURCES_ROOT: `/first${delim}/second` }, "/work"),
    ).toBe("/first");
  });
});

describe("CliContext: createCliContext 装配", () => {
  it("集中解析 cwd/agentDir/sourcesRoot,并持有 reporter", () => {
    const ctx = createCliContext({
      cwd: "/work/project",
      env: { PI_WEB_AGENT_DIR: "/opt/agent-dir", PI_WEB_SOURCES_ROOT: "/opt/sources" },
    });
    expect(ctx.cwd).toBe("/work/project");
    expect(ctx.agentDir).toBe("/opt/agent-dir");
    expect(ctx.sourcesRoot).toBe("/opt/sources");
    expect(typeof ctx.reporter.start).toBe("function");
    expect(typeof ctx.reporter.complete).toBe("function");
    expect(typeof ctx.reporter.fail).toBe("function");
  });
});

describe("buildChildEnv: 最小环境透传(Req 10.2)", () => {
  it("只透传白名单变量,不透传调用者完整环境", () => {
    const callerEnv = {
      PATH: "/usr/bin",
      HOME: "/home/user",
      OPENAI_API_KEY: FAKE_CREDENTIAL,
      SOME_OTHER_SECRET: "should-not-leak",
    };
    const env = buildChildEnv({}, callerEnv);
    expect(env.PATH).toBe("/usr/bin");
    expect(env.HOME).toBe("/home/user");
    expect(env.OPENAI_API_KEY).toBeUndefined();
    expect(env.SOME_OTHER_SECRET).toBeUndefined();
    expect(Object.keys(env)).not.toContain("OPENAI_API_KEY");
  });

  it("注入非交互兜底 GIT_TERMINAL_PROMPT=0 与 CI=1", () => {
    const env = buildChildEnv({}, {});
    expect(env.GIT_TERMINAL_PROMPT).toBe("0");
    expect(env.CI).toBe("1");
  });

  it("显式 extra 叠加在白名单与兜底之上", () => {
    const env = buildChildEnv({ FOO: "bar" }, { PATH: "/bin" });
    expect(env.FOO).toBe("bar");
    expect(env.PATH).toBe("/bin");
  });
});

describe("redactSecrets: 错误渲染脱敏(Req 3.11, 10.3)", () => {
  it("剥离 KEY=value 形态的凭据赋值,只保留变量名", () => {
    const text = `child process failed, env dump: OPENAI_API_KEY=${FAKE_CREDENTIAL} PATH=/usr/bin`;
    const redacted = redactSecrets(text);
    expect(redacted).not.toContain(FAKE_CREDENTIAL);
    expect(redacted).toContain("OPENAI_API_KEY=[redacted]");
    expect(redacted).toContain("PATH=/usr/bin");
  });

  it("剥离内联 URL 凭据", () => {
    const redacted = redactSecrets("fetch failed: https://user:sk-fake-token@example.com/repo.git");
    expect(redacted).not.toContain("sk-fake-token");
    expect(redacted).toContain("https://[redacted]@example.com/repo.git");
  });

  // 以下三种形态在初版实现中漏网(见任务 1.2 的复核 finding):基线 pi-cli.ts 的 redact()
  // 只处理 KEY=value,而它们恰是子进程与 HTTP 客户端错误信息里最常见的泄漏形态。
  it("剥离 Authorization: Bearer 令牌", () => {
    const redacted = redactSecrets("request failed: Authorization: Bearer sk-fake-bearer-abcdef123456");
    expect(redacted).not.toContain("sk-fake-bearer-abcdef123456");
    expect(redacted).toContain("Bearer [redacted]");
  });

  it("剥离 JSON 键值中的凭据(键名与值均带引号)", () => {
    const redacted = redactSecrets('registry rejected: {"apiKey":"sk-live-abcdef123456","id":"pkg"}');
    expect(redacted).not.toContain("sk-live-abcdef123456");
    expect(redacted).toContain("[redacted]");
    // 非敏感字段必须完好,否则错误信息失去定位价值
    expect(redacted).toContain('"id":"pkg"');
  });

  it("兜底:抹除脱离键值上下文的已知前缀令牌", () => {
    const redacted = redactSecrets("unexpected token sk-fake-bare-token-999 in response body");
    expect(redacted).not.toContain("sk-fake-bare-token-999");
    expect(redacted).toContain("[redacted]");
    expect(redacted).toContain("in response body");
  });
});

describe("ProgressReporter: 阶段性进度事件(Req 3.10)", () => {
  it("start/complete/fail 均产出可读的一行输出", () => {
    const lines: string[] = [];
    const reporter = createProgressReporter({ write: (line) => lines.push(line) });

    reporter.start("install", "resolving source");
    reporter.complete("install", "done");
    reporter.fail("install", { code: "SOURCE_REJECTED", message: "source rejected" });

    expect(lines).toHaveLength(3);
    expect(lines[0]).toContain("install");
    expect(lines[1]).toContain("install");
    expect(lines[2]).toContain("install");
    expect(lines[2]).toContain("SOURCE_REJECTED");
  });

  it("★ 观察态:注入含伪造凭据的环境后触发失败路径,捕获输出中不含该凭据", () => {
    const lines: string[] = [];
    const reporter = createProgressReporter({ write: (line) => lines.push(line) });

    // 模拟一个失败路径:子进程失败摘要里带上了完整环境变量内容(常见 bug 场景),
    // reporter.fail() 必须在渲染前脱敏,不让凭据流入捕获的输出。
    const fakeEnv = { OPENAI_API_KEY: FAKE_CREDENTIAL, PATH: "/usr/bin" };
    const rawFailureMessage = `external tool failed with env: ${Object.entries(fakeEnv)
      .map(([k, v]) => `${k}=${v}`)
      .join(" ")}`;

    reporter.fail("install:plugin", { code: "CHILD_PROCESS_FAILED", message: rawFailureMessage });

    const output = lines.join("\n");
    expect(output).not.toContain(FAKE_CREDENTIAL);
    expect(output).toContain("CHILD_PROCESS_FAILED");
  });
});
