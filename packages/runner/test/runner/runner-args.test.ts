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
});
