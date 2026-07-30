#!/usr/bin/env node
/**
 * commands-stub-process — e2e/集成用 stub agent(pi RPC JSONL 协议)。
 *
 * 为 `get_commands` 返回一份命令清单,其内容由环境变量 `STUB_EXTENSION_COMMAND` 驱动:
 * 当置位时,清单中额外包含该扩展注册的 `/command`(模拟"扩展安装并经 reload/新会话生效后
 * 命令出现")。这是一个明确标注的注入式替身(不执行真实 pi 安装、无网络)。
 *
 * prompt:吐一个最小 agent 回合 + response(success),使经命令调用后会话仍可命令转发。
 */
import process from "node:process";

function write(obj) {
  process.stdout.write(JSON.stringify(obj) + "\n");
}

const PARTIAL = {
  role: "assistant",
  content: [],
  api: "x",
  provider: "x",
  model: "m",
  usage: {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: 0,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
  },
  stopReason: "stop",
  timestamp: 0,
};

function commands() {
  const base = [
    {
      name: "help",
      description: "Show help",
      source: "prompt",
      sourceInfo: {
        path: "/builtin/help",
        source: "builtin",
        scope: "user",
        origin: "top-level",
      },
    },
  ];
  const extCmd = process.env["STUB_EXTENSION_COMMAND"];
  if (extCmd !== undefined && extCmd.length > 0) {
    base.push({
      name: extCmd,
      description: "Command from installed extension",
      source: "extension",
      sourceInfo: {
        path: `/ext/${extCmd}`,
        source: "@pi-web/sample",
        scope: "project",
        origin: "package",
      },
    });
  }
  return base;
}

function handle(cmd) {
  switch (cmd.type) {
    case "get_commands":
      write({
        type: "response",
        id: cmd.id,
        command: "get_commands",
        success: true,
        data: { commands: commands() },
      });
      break;
    case "prompt":
      write({ type: "agent_start" });
      write({ type: "turn_end", message: PARTIAL, toolResults: [] });
      write({ type: "agent_end", messages: [], willRetry: false });
      write({ type: "response", id: cmd.id, command: "prompt", success: true });
      break;
    default:
      write({ type: "response", id: cmd.id, command: cmd.type, success: true });
  }
}

let buffer = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  buffer += chunk;
  let idx;
  while ((idx = buffer.indexOf("\n")) !== -1) {
    const raw = buffer.slice(0, idx).replace(/\r$/, "");
    buffer = buffer.slice(idx + 1);
    if (raw.length === 0) continue;
    let cmd;
    try {
      cmd = JSON.parse(raw);
    } catch {
      continue;
    }
    handle(cmd);
  }
});

process.stdin.on("end", () => process.exit(0));
process.on("SIGTERM", () => process.exit(0));
process.on("SIGINT", () => process.exit(0));
