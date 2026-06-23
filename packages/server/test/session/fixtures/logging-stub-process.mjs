#!/usr/bin/env node
/**
 * logging-stub-process — 用于真实子进程日志通道集成测试的 stub。
 *
 * 行为：
 *  - 在启动时向 stderr 写多个 sentinel 格式的结构化日志行（模拟 @pi-web/logger nodeSink）。
 *  - stdout 按 pi RPC JSONL 协议回应命令（同 session-stub-process.mjs）。
 *  - prompt 命令：吐 agent_start → agent_end → response；期间向 stderr 写一条 warn 日志。
 *  - 还向 stderr 写一条纯文本行（非 sentinel），验证 proc:stderr 包装路径。
 *
 * sentinel 格式（来自 @pi-web/logger node-sink.ts）：
 *   "\x02PILOG\x03 " + JSON.stringify(entry) + "\n"
 */
import process from "node:process";

/** 与 @pi-web/logger nodeSink 相同的前缀。 */
const LOG_SENTINEL = "\x02PILOG\x03 ";

function writeStdout(obj) {
  process.stdout.write(JSON.stringify(obj) + "\n");
}

function writeLog(level, ns, msg) {
  const entry = { level, ns, msg, ts: Date.now() };
  process.stderr.write(LOG_SENTINEL + JSON.stringify(entry) + "\n");
}

function writePlainStderr(msg) {
  process.stderr.write(msg + "\n");
}

// Emit startup logs via stderr (simulates createLogger(nodeSink) on agent init).
writeLog("info", "agent:init", "stub agent starting");
writeLog("debug", "agent:config", "loading configuration");

// Emit a plain (non-sentinel) stderr line to exercise proc:stderr wrapping.
writePlainStderr("raw stderr noise from agent boot");

const PARTIAL = {
  role: "assistant",
  content: [],
  api: "x",
  provider: "x",
  model: "stub",
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

function handlePrompt(cmd) {
  // Emit a warn-level log during prompt handling.
  writeLog("warn", "agent:prompt", "handling prompt");

  writeStdout({ type: "agent_start" });
  writeStdout({
    type: "message_update",
    message: PARTIAL,
    assistantMessageEvent: {
      type: "text_delta",
      contentIndex: 0,
      delta: "hi",
      partial: PARTIAL,
    },
  });
  writeStdout({ type: "agent_end", messages: [], willRetry: false });
  writeStdout({ type: "response", id: cmd.id, command: "prompt", success: true });
}

function handle(cmd) {
  switch (cmd.type) {
    case "prompt":
      handlePrompt(cmd);
      break;
    default:
      writeStdout({ type: "response", id: cmd.id, command: cmd.type, success: true });
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
