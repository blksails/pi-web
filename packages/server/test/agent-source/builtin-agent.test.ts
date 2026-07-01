/**
 * 内置 default-agent 解析(`builtin:default-agent`):随包发布的入口 → custom 模式,
 * cwd 用**用户工作目录**(非入口所在的包内目录),故 auto-title 等 runner 期特性生效。
 */
import { describe, it, expect } from "vitest";
import { existsSync } from "node:fs";
import { resolve } from "../../src/agent-source/resolver.js";
import { identify } from "../../src/agent-source/source-type.js";
import {
  BUILTIN_DEFAULT_AGENT_SOURCE,
  defaultAgentEntryPath,
} from "../../src/builtin-agents/entry-path.js";

const RUNNER = "/opt/pi-web/runner.js";
const PI_CLI = "/opt/pi/dist/cli.js";

describe("identify — builtin: scheme", () => {
  it("recognizes builtin:default-agent", () => {
    expect(identify("builtin:default-agent")).toEqual({
      kind: "builtin",
      name: "default-agent",
    });
  });

  it("defaults bare builtin: to default-agent", () => {
    expect(identify("builtin:")).toEqual({ kind: "builtin", name: "default-agent" });
  });
});

describe("defaultAgentEntryPath", () => {
  it("resolves to an existing packaged entry file", () => {
    const p = defaultAgentEntryPath();
    expect(p).toBeDefined();
    expect(existsSync(p!)).toBe(true);
    expect(p!.endsWith("default-agent/index.ts")).toBe(true);
  });
});

describe("resolve — builtin:default-agent → custom mode", () => {
  it("uses the packaged entry but the user's cwd", async () => {
    const userCwd = "/some/user/project";
    const r = await resolve(BUILTIN_DEFAULT_AGENT_SOURCE, {
      cwd: userCwd,
      runnerEntry: RUNNER,
      piCliEntry: PI_CLI,
    });
    expect(r.mode).toBe("custom");
    expect(r.cwd).toBe(userCwd); // 关键:agent 操作用户目录,而非包内目录
    expect(r.spawnSpec.cwd).toBe(userCwd);
    expect(r.spawnSpec.args).toContain(RUNNER);

    const agentIdx = r.spawnSpec.args.indexOf("--agent");
    expect(agentIdx).toBeGreaterThanOrEqual(0);
    const entry = r.spawnSpec.args[agentIdx + 1]!;
    expect(entry.endsWith("default-agent/index.ts")).toBe(true);
    expect(existsSync(entry)).toBe(true);

    const cwdIdx = r.spawnSpec.args.indexOf("--cwd");
    expect(r.spawnSpec.args[cwdIdx + 1]).toBe(userCwd);
  });

  it("throws for an unknown built-in name", async () => {
    await expect(
      resolve("builtin:nope", { runnerEntry: RUNNER, piCliEntry: PI_CLI }),
    ).rejects.toThrow();
  });
});
