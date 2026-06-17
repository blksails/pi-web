#!/usr/bin/env node
/**
 * rpc-stub-process — 等价 stub 子进程,在真实 pi 不可用(无 provider API key)时的退路。
 *
 * 按 pi RPC JSONL 协议:从 stdin 逐行读命令(JSONL),按命令类型吐协议正确的
 * stdout JSONL 帧(event + response,均含命令同一 `id`)。仅用于集成/e2e 测试,
 * 不进入运行时依赖。
 *
 * 行为约定:
 *  - prompt:吐 agent_start → message_update(text_delta) → agent_end 事件,
 *    再吐 prompt 的 response(success:true,带同 id)。
 *  - abort:立即吐 abort 的 response。
 *  - 其余命令:吐对应 command 的 response(success:true)。
 *
 * 故意以严格 JSONL 输出(每帧一行、`\n` 结尾);并夹带一个含 U+2028 的 text_delta
 * 以验证下游 reader 不误切。SIGTERM/stdin 关闭时干净退出。
 */
import process from "node:process";

const LS = " "; // 行内 U+2028,验证 reader 不误切

function write(obj) {
  process.stdout.write(JSON.stringify(obj) + "\n");
}

function handlePrompt(cmd) {
  const id = cmd.id;
  write({ type: "agent_start" });
  write({
    type: "message_update",
    message: { role: "assistant", content: [] },
    assistantMessageEvent: {
      type: "text_delta",
      contentIndex: 0,
      delta: `hello${LS}world`,
      partial: { role: "assistant", content: [] },
    },
  });
  write({ type: "agent_end", messages: [], willRetry: false });
  write({ type: "response", id, command: "prompt", success: true });
}

function handle(cmd) {
  switch (cmd.type) {
    case "prompt":
      handlePrompt(cmd);
      break;
    case "abort":
      write({ type: "response", id: cmd.id, command: "abort", success: true });
      break;
    case "get_state":
      write({
        type: "response",
        id: cmd.id,
        command: "get_state",
        success: true,
        data: {
          model: null,
          thinkingLevel: "off",
          isProcessing: false,
          messageCount: 0,
        },
      });
      break;
    default:
      // 通用成功响应(无 data 分支)。
      write({
        type: "response",
        id: cmd.id,
        command: cmd.type,
        success: true,
      });
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
