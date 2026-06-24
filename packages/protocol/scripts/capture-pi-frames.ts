/**
 * capture-pi-frames — 开发夹具采集脚本(不进入包运行时依赖)。
 *
 * 目的:驱动真实 `pi --mode rpc` 子进程,发送一条 prompt,录制其 stdout 上的 JSONL
 * RPC 帧序列(覆盖 prompt → text_delta → tool_execution start/update/end → agent_end),
 * 写入 test/fixtures/rpc-sample-frames.jsonl;并由这些 RPC 帧合成一份代表性的 SSE
 * 样本帧写入 test/fixtures/sse-sample-frames.json。
 *
 * 用法(需要真实 pi 环境 + provider key):
 *   ANTHROPIC_API_KEY=sk-... pnpm --filter @blksails/protocol exec \
 *     tsx scripts/capture-pi-frames.ts            # 或 node --loader 等
 *
 * 若未设置 API key,脚本会拒绝运行(不静默生成伪造帧)——已落仓的 fixtures 此时为
 * "representative, not captured live"(见 fixtures 文件头注释)。设置 key 并运行本脚本
 * 即可用真实帧覆盖刷新它们。
 *
 * 注意:本脚本依赖 `@earendil-works/pi-coding-agent`(devDependency)与 node:child_process,
 * 这些仅供采集,绝不被 src/ 运行时导入。
 */
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURES = resolve(__dirname, "..", "test", "fixtures");

const apiKey =
  process.env.ANTHROPIC_API_KEY ??
  process.env.OPENAI_API_KEY ??
  process.env.PI_API_KEY;

if (!apiKey) {
  console.error(
    "[capture-pi-frames] No provider API key in env (ANTHROPIC_API_KEY/OPENAI_API_KEY/PI_API_KEY).\n" +
      "Refusing to fabricate frames. Set a key and re-run to capture live frames.\n" +
      "Committed fixtures are representative until then.",
  );
  process.exit(2);
}

/** Resolve the local pi CLI entry (dist/cli.js) from the dev dependency. */
function resolvePiCli(): string {
  const require = createRequire(import.meta.url);
  const pkgJson = require.resolve("@earendil-works/pi-coding-agent/package.json");
  return join(dirname(pkgJson), "dist", "cli.js");
}

async function main(): Promise<void> {
  const cli = resolvePiCli();
  const prompt =
    "List the files in the current directory using a tool, then summarize.";

  const child = spawn(process.execPath, [cli, "--mode", "rpc"], {
    cwd: process.cwd(),
    env: { ...process.env },
    stdio: ["pipe", "pipe", "inherit"],
  });

  const frames: unknown[] = [];
  let buf = "";

  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (chunk: string) => {
    // JSONL framing: split on \n, strip \r. (Do not use readline — it mis-splits U+2028/2029.)
    buf += chunk;
    let idx: number;
    while ((idx = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, idx).replace(/\r$/, "");
      buf = buf.slice(idx + 1);
      if (!line.trim()) continue;
      try {
        frames.push(JSON.parse(line));
      } catch {
        // ignore non-JSON diagnostic lines
      }
    }
  });

  // Send a prompt command, then wait for agent_end.
  const done = new Promise<void>((resolveDone) => {
    const timer = setInterval(() => {
      if (frames.some((f) => (f as { type?: string }).type === "agent_end")) {
        clearInterval(timer);
        resolveDone();
      }
    }, 200);
    setTimeout(() => {
      clearInterval(timer);
      resolveDone();
    }, 120_000);
  });

  child.stdin.write(JSON.stringify({ id: "1", type: "prompt", message: prompt }) + "\n");

  await done;
  child.kill();

  mkdirSync(FIXTURES, { recursive: true });
  const jsonl = frames.map((f) => JSON.stringify(f)).join("\n") + "\n";
  writeFileSync(join(FIXTURES, "rpc-sample-frames.jsonl"), jsonl, "utf8");
  console.error(
    `[capture-pi-frames] Wrote ${frames.length} RPC frames to fixtures/rpc-sample-frames.jsonl`,
  );
}

main().catch((err) => {
  console.error("[capture-pi-frames] failed:", err);
  process.exit(1);
});
