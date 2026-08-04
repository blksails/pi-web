/**
 * 会话测试共享 fixtures。
 */
import type { ResolvedSource } from "../../src/agent-source/index.js";

export function makeResolved(
  over: Partial<ResolvedSource> = {},
): ResolvedSource {
  return {
    mode: "cli",
    trust: "ask",
    cwd: "/tmp/agent",
    spawnSpec: {
      cmd: "node",
      args: ["stub.mjs"],
      cwd: "/tmp/agent",
      env: {},
    },
    ...over,
  };
}
