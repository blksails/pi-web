/**
 * 集成(真实 runner 子进程)— 装配期 per-source settings 注入(spec:
 * source-settings-and-slots,任务 3.1,通道 a;Requirements 4.1-4.5)。
 *
 * design.md Implementation Notes 明确要求本任务必须用**真实子进程**证明回归(stub
 * 抓不到装配期注入类回归,与 state-injection-bridge 同教训)——因此不 mock
 * `resolvePiPlugin`/`SourceSettingsCodec`/runner 装配流程,而是真 spawn
 * `packages/server/src/runner/runner.ts`,用 fixture(见 `test/runner/fixtures/
 * settings-assembly-*-e2e-agent`)的 shape-(b) 工厂把 runner 注入的 `ctx.settings`
 * 经 agent-declared-routes(非 LLM RPC 通道,先例 `agent-routes-subprocess.test.ts`)
 * 回吐,断言子进程内真实收到的值。
 *
 * 覆盖:
 *  ① scope:"source" 命中已落盘值(Req 4.1/4.2)。
 *  ② scope:"source" 声明了 settings 但文件不存在 → 空对象(Req 2.4)。
 *  ③ scope:"project" + 受信任 → 命中 `<cwd>/.pi/source-settings/` 落盘值(Req 2.2)。
 *  ④ scope:"project" + 未受信任 → 空对象(trust 门控,design 装配期注入段)。
 *  ⑤ 未声明 settings 的存量 source → 空对象,行为零变化(Req 4.5)。
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import type { SpawnSpec } from "@blksails/pi-web-protocol";
import { PiRpcProcess } from "../../src/rpc-channel/pi-rpc-process.js";
import { PiSession } from "../../src/session/pi-session.js";
import { makeResolved } from "../session/fixtures.js";
import { sourceKey } from "../../src/source-key.js";
import { SourceSettingsCodec } from "../../src/config/source-settings-codec.js";

const here = dirname(fileURLToPath(import.meta.url));
// test/integration -> packages/server
const serverPkgDir = join(here, "..", "..");
const runnerEntry = join(serverPkgDir, "src", "runner", "runner.ts");
const fixturesDir = join(serverPkgDir, "test", "runner", "fixtures");

const SOURCE_FIXTURE = join(fixturesDir, "settings-assembly-source-e2e-agent");
const PROJECT_FIXTURE = join(fixturesDir, "settings-assembly-project-e2e-agent");
const NONE_FIXTURE = join(fixturesDir, "settings-assembly-none-e2e-agent");

const SOURCE_FIXTURE_ID = "settings-assembly-source-e2e-agent";
const PROJECT_FIXTURE_ID = "settings-assembly-project-e2e-agent";

const tmpDirs: string[] = [];
function makeTmpDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tmpDirs.push(dir);
  return dir;
}

interface SpawnedRunner {
  channel: PiRpcProcess;
  session: PiSession;
}

function spawnRunner(opts: {
  agentPath: string;
  cwd: string;
  agentDir: string;
  trusted?: boolean;
}): SpawnedRunner {
  const spec: SpawnSpec = {
    cmd: process.execPath,
    args: [
      "--import",
      "jiti/register",
      runnerEntry,
      "--agent",
      opts.agentPath,
      "--cwd",
      opts.cwd,
      "--agent-dir",
      opts.agentDir,
      ...(opts.trusted === true ? ["--trusted"] : []),
    ],
    // jiti/register 从 cwd 解析:必须以 server 包为 cwd(state-bridge/routes-subprocess 先例)。
    cwd: serverPkgDir,
    env: { ...process.env } as Record<string, string>,
  };
  const channel = new PiRpcProcess(spec);
  const session = new PiSession({
    id: `settings-assembly-${Math.random().toString(36).slice(2)}`,
    resolved: makeResolved(),
    channel,
    idleMs: 0,
  });
  return { channel, session };
}

async function waitFor(
  cond: () => boolean,
  what: string,
  timeoutMs = 30_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!cond()) {
    if (Date.now() > deadline) {
      throw new Error(`Timed out waiting for ${what}`);
    }
    await new Promise((r) => setTimeout(r, 25));
  }
}

/** 拉起 runner、等就绪、取 `get-settings` route 结果、收尾。 */
async function fetchInjectedSettings(opts: {
  agentPath: string;
  cwd: string;
  agentDir: string;
  trusted?: boolean;
}): Promise<Readonly<Record<string, unknown>>> {
  const { session } = spawnRunner(opts);
  try {
    // 就绪锚点:装配期声明帧(routes)已被 PiSession 缓存(与 agent-routes-subprocess
    // 先例同法),此后 RPC 通路已联通,可安全发 get_commands + invokeAgentRoute。
    await waitFor(() => session.agentRoutes.length > 0, "get-settings route declaration");
    const commands = await session.getCommands();
    expect(commands.success).toBe(true);

    const res = await session.invokeAgentRoute("get-settings", {
      method: "GET",
      query: {},
    });
    expect(res.ok).toBe(true);
    return (res.result as { settings: Readonly<Record<string, unknown>> }).settings;
  } finally {
    await session.stop().catch(() => undefined);
  }
}

describe("装配期 per-source settings 注入 — 真实 runner 子进程 (Task 3.1, Req 4.1-4.5)", () => {
  afterEach(() => {
    for (const dir of tmpDirs.splice(0)) {
      try {
        rmSync(dir, { recursive: true, force: true });
      } catch {
        // best-effort 清理
      }
    }
  });

  it(
    "① scope:\"source\" — 已落盘值经装配期命中 ctx.settings(Req 4.1/4.2)",
    async () => {
      const cwd = makeTmpDir("settings-asm-src-cwd-");
      const agentDir = makeTmpDir("settings-asm-src-agentdir-");
      const codec = new SourceSettingsCodec(agentDir);
      const seeded = { apiBase: "https://example.test/api", nested: { count: 3 } };
      await codec.save("source", sourceKey(SOURCE_FIXTURE_ID), seeded);

      const settings = await fetchInjectedSettings({
        agentPath: SOURCE_FIXTURE,
        cwd,
        agentDir,
      });
      expect(settings).toEqual(seeded);
    },
    40_000,
  );

  it(
    "② scope:\"source\" 声明但无落盘文件 — ctx.settings 为空对象(Req 2.4)",
    async () => {
      const cwd = makeTmpDir("settings-asm-src-empty-cwd-");
      const agentDir = makeTmpDir("settings-asm-src-empty-agentdir-");

      const settings = await fetchInjectedSettings({
        agentPath: SOURCE_FIXTURE,
        cwd,
        agentDir,
      });
      expect(settings).toEqual({});
    },
    40_000,
  );

  it(
    "③ scope:\"project\" + 受信任 — 命中 <cwd>/.pi/source-settings/ 落盘值(Req 2.2)",
    async () => {
      const cwd = makeTmpDir("settings-asm-proj-trusted-cwd-");
      const agentDir = makeTmpDir("settings-asm-proj-trusted-agentdir-");
      const codec = new SourceSettingsCodec(agentDir);
      const seeded = { theme: "dark", limit: 10 };
      await codec.save("project", sourceKey(PROJECT_FIXTURE_ID), seeded, { cwd });

      const settings = await fetchInjectedSettings({
        agentPath: PROJECT_FIXTURE,
        cwd,
        agentDir,
        trusted: true,
      });
      expect(settings).toEqual(seeded);
    },
    40_000,
  );

  it(
    "④ scope:\"project\" + 未受信任 — trust 门控生效,ctx.settings 为空对象",
    async () => {
      const cwd = makeTmpDir("settings-asm-proj-untrusted-cwd-");
      const agentDir = makeTmpDir("settings-asm-proj-untrusted-agentdir-");
      const codec = new SourceSettingsCodec(agentDir);
      // 文件确实存在于磁盘上,但装配期不应读取(未受信任项目)。
      await codec.save("project", sourceKey(PROJECT_FIXTURE_ID), { theme: "dark" }, { cwd });

      const settings = await fetchInjectedSettings({
        agentPath: PROJECT_FIXTURE,
        cwd,
        agentDir,
        // trusted 省略 → runner 默认 untrusted(无 --trusted / 无 PI_WEB_TRUST_PROJECT)。
      });
      expect(settings).toEqual({});
    },
    40_000,
  );

  it(
    "⑤ 未声明 settings 的存量 source — ctx.settings 为空对象,零变化(Req 4.5)",
    async () => {
      const cwd = makeTmpDir("settings-asm-none-cwd-");
      const agentDir = makeTmpDir("settings-asm-none-agentdir-");

      const settings = await fetchInjectedSettings({
        agentPath: NONE_FIXTURE,
        cwd,
        agentDir,
      });
      expect(settings).toEqual({});
    },
    40_000,
  );
});
