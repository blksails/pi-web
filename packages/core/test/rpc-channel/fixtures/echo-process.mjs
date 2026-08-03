#!/usr/bin/env node
/**
 * echo-process — 单元测试用的可控子进程。
 *
 * 它把 stdin 收到的每一行原样写回 stdout(行级 passthrough)。这让单元测试可以
 * 用 `proc.send(JSON.stringify(frame))` 精确地把任意 stdout 行注入到 PiRpcProcess
 * 的 stdout 解析路径(response / event / extension_ui_request / 坏行 / 孤儿响应),
 * 从而无需真实 pi 即可断言三类分发、id 关联与诊断行为。
 *
 * 同时支持注入裸字符串到 stdout:若收到的行以 `__raw__:` 前缀,则把其后内容
 * (不再附加换行外的内容)原样写出——用于注入坏行/CRLF/分片测试。
 */
import process from "node:process";

let buffer = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  buffer += chunk;
  let idx;
  while ((idx = buffer.indexOf("\n")) !== -1) {
    const raw = buffer.slice(0, idx).replace(/\r$/, "");
    buffer = buffer.slice(idx + 1);
    if (raw.startsWith("__raw__:")) {
      process.stdout.write(raw.slice("__raw__:".length) + "\n");
    } else {
      process.stdout.write(raw + "\n");
    }
  }
});

process.stdin.on("end", () => process.exit(0));
process.on("SIGTERM", () => process.exit(0));
process.on("SIGINT", () => process.exit(0));
