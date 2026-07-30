import { describe, expect, it } from "vitest";
import { parseRunnerArgs, RunnerArgsError } from "../../src/runner/runner.js";

describe("parseRunnerArgs (Req 4.1/4.2)", () => {
  it("parses --agent, --cwd and --agent-dir (space form)", () => {
    const args = parseRunnerArgs([
      "--agent",
      "/path/to/agent",
      "--cwd",
      "/work",
      "--agent-dir",
      "/agent",
    ]);
    expect(args).toEqual({
      agent: "/path/to/agent",
      cwd: "/work",
      agentDir: "/agent",
      trusted: false,
    });
  });

  it("parses --key=value form", () => {
    const args = parseRunnerArgs(["--agent=/a", "--cwd=/w", "--trusted=true"]);
    expect(args.agent).toBe("/a");
    expect(args.cwd).toBe("/w");
    expect(args.trusted).toBe(true);
  });

  it("treats bare --trusted as true", () => {
    const args = parseRunnerArgs(["--agent", "/a", "--trusted"]);
    expect(args.trusted).toBe(true);
  });

  it("defaults cwd to process.cwd() and omits agentDir when absent", () => {
    const args = parseRunnerArgs(["--agent", "/a"]);
    expect(args.cwd).toBe(process.cwd());
    expect(args.agentDir).toBeUndefined();
    expect(args.trusted).toBe(false);
  });

  it("throws RunnerArgsError when --agent is missing (Req 4.2)", () => {
    expect(() => parseRunnerArgs(["--cwd", "/w"])).toThrowError(RunnerArgsError);
  });

  it("throws RunnerArgsError when --agent has no value", () => {
    expect(() => parseRunnerArgs(["--agent"])).toThrowError(RunnerArgsError);
  });

  describe("未识别参数(不静默吞)", () => {
    it("登记未识别的 -- 开关而不抛错(调用方可能比 runner 新)", () => {
      const args = parseRunnerArgs(["--agent", "/a", "--no-skill", "--future-flag"]);
      expect(args.agent).toBe("/a");
      expect(args.unknownArgs).toEqual(["--no-skill", "--future-flag"]);
    });

    it("=value 形式只登记名字,不把值带进诊断(值可能含路径/凭据)", () => {
      const args = parseRunnerArgs(["--agent", "/a", "--secret-thing=hunter2"]);
      expect(args.unknownArgs).toEqual(["--secret-thing"]);
    });

    it("全部识别时不出现该字段(既有全字段断言零感知)", () => {
      const args = parseRunnerArgs(["--agent", "/a", "--trusted"]);
      expect(args.unknownArgs).toBeUndefined();
    });

    it("被 takeValue 消费的值不算未识别项", () => {
      const args = parseRunnerArgs(["--agent", "/a", "--cwd", "--weird-looking-path"]);
      expect(args.cwd).toBe("--weird-looking-path");
      expect(args.unknownArgs).toBeUndefined();
    });
  });
});
