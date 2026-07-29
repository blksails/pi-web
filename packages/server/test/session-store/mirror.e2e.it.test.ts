/**
 * runner → mirror → sqlite 端到端:真启 runner 子进程并设 SESSION_STORE=sqlite,
 * 镜像在启动时即把会话头部写入 sqlite —— 无需 LLM 即可验证"运行时按配置落库"。
 */
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { SqliteSessionEntryStore } from "../../src/session-store/index.js";

const here = dirname(fileURLToPath(import.meta.url));
const serverPkgDir = join(here, "..", "..");
const runnerEntry = join(serverPkgDir, "src", "runner", "runner.ts");
const exampleAgent = join(serverPkgDir, "..", "..", "examples", "hello-agent");

describe("runner → mirror → sqlite e2e", () => {
  let proc: ChildProcessWithoutNullStreams | undefined;
  afterEach(() => {
    proc?.kill("SIGKILL");
    proc = undefined;
  });

  it(
    "SESSION_STORE=sqlite 时,真启 runner 后会话头部被镜像进 sqlite(无需 LLM)",
    async () => {
      const cwd = mkdtempSync(join(tmpdir(), "mir-cwd-"));
      const agentDir = mkdtempSync(join(tmpdir(), "mir-adir-"));
      const dbPath = join(mkdtempSync(join(tmpdir(), "mir-db-")), "sessions.db");

      await new Promise<void>((resolve, reject) => {
        const child = spawn(
          process.execPath,
          ["--import", "jiti/register", runnerEntry, "--agent", exampleAgent, "--cwd", cwd, "--agent-dir", agentDir],
          {
            cwd: serverPkgDir,
            stdio: ["pipe", "pipe", "pipe"],
            env: { ...process.env, SESSION_STORE: "sqlite", SESSION_STORE_PATH: dbPath },
          },
        );
        proc = child;
        let buf = "";
        let err = "";
        const timer = setTimeout(() => reject(new Error(`timeout\nstderr=${err}`)), 25000);
        child.stdout.setEncoding("utf8");
        child.stdout.on("data", (c: string) => {
          buf += c;
          for (const line of buf.split("\n")) {
            try {
              const f = JSON.parse(line) as { id?: string; success?: boolean };
              if (f.id === "s1" && f.success) {
                clearTimeout(timer);
                resolve();
              }
            } catch {
              /* 非完整 JSON 行,忽略 */
            }
          }
        });
        child.stderr.setEncoding("utf8");
        child.stderr.on("data", (c: string) => {
          err += c;
        });
        child.stdin.write(`${JSON.stringify({ id: "s1", type: "get_state" })}\n`);
      });

      // 释放子进程对 sqlite 文件的句柄后再读
      proc?.kill("SIGKILL");
      proc = undefined;
      await new Promise((r) => setTimeout(r, 150));

      expect(existsSync(dbPath)).toBe(true);
      const store = new SqliteSessionEntryStore(dbPath);
      const sessions = await store.listAll();
      expect(sessions.length).toBeGreaterThan(0);
      expect(typeof sessions[0]?.sessionId).toBe("string");
      store.close();
    },
    30000,
  );
});
