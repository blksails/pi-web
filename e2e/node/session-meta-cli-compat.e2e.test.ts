/**
 * Node e2e(session-meta-index, 任务 5.3 / Req 9.1, 9.2):**真实 pi CLI** 对同一批会话的
 * 行为不因元数据索引存在而改变。
 *
 * 为何这条必须真机跑:jsonl 与其所在目录是 pi CLI 的**外部字节契约**,我们只是共写者。
 * 「索引落在 sessions 目录之外」这个决定的正当性,不能靠推理,只能靠 CLI 实测。
 *
 * 判据设计(实测确定,非推测):`pi --print --session <id> --session-dir <dir>` 在**不带 prompt**
 * 时会解析目标会话、认出其所属项目目录并输出 `Session found in different project: <cwd>` 后
 * 立即退出 —— 全程不发模型请求、亚秒返回。这恰好是「CLI 成功读懂了这份 jsonl」的直接证据。
 *
 * 于是判据取**等价性**(比"不含错误"更强):三种布局的 CLI 输出必须逐字相同 ——
 * ①无索引 ②索引在 sessions 目录**外**(本特性的选择) ③索引在目录**内**(反例)。
 *
 * 同时静态断言:sessions 目录内容(文件名集合与字节)不因本特性改动(Req 9.1)。
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import * as os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const exec = promisify(execFile);

let root: string;
let sessionsDir: string;
/** 布局①(无索引)下的 CLI 输出,作为后两种布局的等价性基准。 */
let baseline = "";
const SESSION_ID = "0197c3a1-0000-7000-8000-000000000001";

/** 一份最小但格式合法的会话 jsonl(header + 一条 session_info + 一条用户消息)。 */
function sessionJsonl(id: string, cwd: string): string {
  const header = {
    type: "session",
    id,
    version: 3,
    cwd,
    timestamp: "2026-07-01T00:00:00.000Z",
  };
  const info = {
    id: "a1b2c3d4",
    parentId: null,
    timestamp: "2026-07-01T00:01:00.000Z",
    type: "session_info",
    name: "CLI 兼容性实测会话",
  };
  const msg = {
    id: "b2c3d4e5",
    parentId: "a1b2c3d4",
    timestamp: "2026-07-01T00:02:00.000Z",
    type: "message",
    message: { role: "user", content: "hello from fixture" },
  };
  return [header, info, msg].map((o) => JSON.stringify(o)).join("\n") + "\n";
}

const INDEX_CONTENT = JSON.stringify(
  {
    v: 1,
    sessions: {
      [SESSION_ID]: {
        title: "CLI 兼容性实测会话",
        agentSource: "builtin:compat",
        updatedAt: "2026-07-30T00:00:00.000Z",
      },
    },
  },
  null,
  2,
);

/** 目录快照:文件名 → 内容(用于证明 sessions 目录未被改动)。 */
async function snapshot(dir: string): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const name of (await fs.readdir(dir)).sort()) {
    out[name] = await fs.readFile(path.join(dir, name), "utf8");
  }
  return out;
}

/**
 * 跑一次 pi CLI,返回 stdout+stderr 合并文本(非零退出码属正常路径,不抛)。
 *
 * ★ stdin 必须给 EOF:CLI 在 fork 询问处会等输入,不喂 EOF 则每次都要等到超时被杀
 * (实测 20s → 0.9s)。经 `sh -c ... < /dev/null` 而非 execFile 直调,因 execFile
 * 无法把已关闭的 stdin 传给子进程。
 */
async function runPi(args: readonly string[]): Promise<string> {
  const cmd = ["pi", ...args.map((a) => `'${a.replace(/'/g, "'\\''")}'`)].join(" ");
  try {
    const { stdout, stderr } = await exec("sh", ["-c", `${cmd} < /dev/null`], {
      cwd: root,
      timeout: 20_000,
    });
    return `${stdout}\n${stderr}`.trim();
  } catch (err) {
    const e = err as { stdout?: string; stderr?: string; message?: string };
    return `${e.stdout ?? ""}\n${e.stderr ?? ""}`.trim();
  }
}

/** 让 CLI 解析目标会话并立即退出(不带 prompt → 不发模型请求)。 */
const loadSession = (): Promise<string> =>
  runPi(["--print", "--session", SESSION_ID, "--session-dir", sessionsDir]);

/** 会话加载/解析类错误的迹象。 */
const SESSION_LOAD_ERROR =
  /session (file )?(not found|invalid|corrupt)|failed to (load|read|parse) session|unknown session version|Unexpected token/i;

beforeAll(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "meta-cli-compat-"));
  sessionsDir = path.join(root, "sessions");
  await fs.mkdir(sessionsDir, { recursive: true });
  await fs.writeFile(
    path.join(sessionsDir, `20260701T000000_${SESSION_ID}.jsonl`),
    sessionJsonl(SESSION_ID, root),
    "utf8",
  );
});

afterAll(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

describe("pi CLI 与元数据索引共存(Req 9.2)", () => {
  it("pi CLI 可用(前置条件,失败即说明本机缺 CLI 而非兼容性问题)", async () => {
    const out = await runPi(["--version"]);
    expect(out).toMatch(/\d+\.\d+\.\d+/);
  });

  it("布局①无索引:CLI 成功解析会话(基线)", async () => {
    baseline = await loadSession();
    // 实测面貌:CLI 认出会话所属项目目录 → 证明它读懂了这份 jsonl
    expect(baseline).toMatch(/Session found in different project/i);
    expect(baseline).not.toMatch(SESSION_LOAD_ERROR);
  });

  it("★ 布局②索引在 sessions 目录之外(本特性的选择):CLI 输出与基线逐字相同", async () => {
    const outsideIndex = path.join(root, "piweb-session-index.json");
    await fs.writeFile(outsideIndex, INDEX_CONTENT, "utf8");
    const before = await snapshot(sessionsDir);

    const out = await loadSession();
    // 等价性判据:多一个索引文件后 CLI 的行为**一字不差**
    expect(out).toBe(baseline);
    // Req 9.1:sessions 目录的文件名与字节均未被改动
    expect(await snapshot(sessionsDir)).toEqual(before);
    // 索引确实在 sessions 目录之外
    expect(path.dirname(outsideIndex)).not.toBe(sessionsDir);

    await fs.rm(outsideIndex, { force: true });
  });

  it("布局③索引放进 sessions 目录(反例):记录 CLI 的实际反应", async () => {
    const insideIndex = path.join(sessionsDir, "piweb-session-index.json");
    await fs.writeFile(insideIndex, INDEX_CONTENT, "utf8");
    const out = await loadSession();
    await fs.rm(insideIndex, { force: true });

    // 本布局不是本特性采用的方案;此用例的价值是把 CLI 的真实反应记录下来。
    const same = out === baseline;
    // eslint-disable-next-line no-console
    console.log(
      `[compat] 索引放进 sessions 目录时 CLI 行为是否仍与基线一致: ${same ? "是(放到目录外属保守选择,但零风险)" : "否(证明放到目录外是必要的)"}`,
    );
    expect(out).not.toMatch(SESSION_LOAD_ERROR);
  });
});
