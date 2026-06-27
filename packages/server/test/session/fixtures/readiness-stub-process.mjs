#!/usr/bin/env node
/**
 * readiness-stub-process — 会话就绪握手集成测试的最小 stub(spec session-readiness-handshake)。
 *
 * 行为(由 env 控制):
 *  - 默认:按 pi RPC JSONL 协议应答任意命令(含探针 get_commands)→ 驱动 PiSession 就绪。
 *  - READINESS_STUB_MODE=silent-exit:**不应答** get_commands,延迟后退出 → 模拟就绪前早退。
 *
 * 不依赖真实 agent / LLM;仅验证 server 侧探针→就绪→粘性帧的跨进程链路。
 */
import process from "node:process";

const MODE = process.env.READINESS_STUB_MODE ?? "respond";

function writeStdout(obj) {
  process.stdout.write(JSON.stringify(obj) + "\n");
}

if (MODE === "silent-exit") {
  // 就绪前早退:不读 stdin、不应答探针,短延迟后退出(退出码非 0)。
  setTimeout(() => process.exit(3), 150);
} else {
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
      // 应答任意命令(探针 get_commands 据此 resolve → 就绪)。
      writeStdout({
        type: "response",
        id: cmd.id,
        command: cmd.type,
        success: true,
      });
    }
  });
  process.stdin.on("end", () => process.exit(0));
}

process.on("SIGTERM", () => process.exit(0));
process.on("SIGINT", () => process.exit(0));
