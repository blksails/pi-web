/**
 * E2bTransport 单元测试(spec e2b-sandbox-transport,Req 2.2–2.6/7.1)。
 *
 * 用 `vi.mock("e2b")` 注入可编程假 SDK(不真连 e2b),覆盖:boot 起沙盒+后台 runner
 * (参数含 template/cwd/envs/background/stdin)、onStdout 数据块经分帧只喂 onLine(含
 * 跨块半行)、stderr 只喂 onStderr、就绪前 send 进 outbox 就绪后 flush、close 先 kill
 * 命令后 kill 沙盒且 health 变死、boot 失败传播 SpawnError 并经 onExit 拒绝待决。
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import type { SpawnSpec } from "@blksails/pi-web-protocol";

// vi.mock 工厂被提升到 import 之上,故共享状态须用 vi.hoisted 一并提升。
const e2bState = vi.hoisted(() => ({
  createArgs: [] as Array<{ template: string; opts: Record<string, unknown> }>,
  runArgs: [] as Array<{ cmd: string; opts: Record<string, unknown> }>,
  sentStdin: [] as string[],
  commandKilled: 0,
  sandboxKilled: 0,
  createShouldThrow: false,
  onStdout: undefined as ((d: string) => void) | undefined,
  onStderr: undefined as ((d: string) => void) | undefined,
}));

vi.mock("e2b", () => {
  class FakeCommandHandle {
    readonly pid = 4242;
    async sendStdin(data: string): Promise<void> {
      e2bState.sentStdin.push(data);
    }
    async kill(): Promise<boolean> {
      e2bState.commandKilled++;
      return true;
    }
  }
  class Sandbox {
    commands = {
      run: async (cmd: string, opts: Record<string, unknown>) => {
        e2bState.runArgs.push({ cmd, opts });
        e2bState.onStdout = opts.onStdout as (d: string) => void;
        e2bState.onStderr = opts.onStderr as (d: string) => void;
        return new FakeCommandHandle();
      },
    };
    async kill(): Promise<boolean> {
      e2bState.sandboxKilled++;
      return true;
    }
    static async create(template: string, opts: Record<string, unknown>) {
      e2bState.createArgs.push({ template, opts });
      if (e2bState.createShouldThrow) throw new Error("boom-create");
      return new Sandbox();
    }
  }
  return { Sandbox };
});

// mock 声明后再导入被测模块(vi.mock 已提升,顺序无碍)。
const { E2bTransport } = await import("../../src/rpc-channel/e2b-transport.js");
const { SpawnError } = await import(
  "../../src/rpc-channel/pi-rpc-process.errors.js"
);

function spec(env: Record<string, string> = {}): SpawnSpec {
  return { cmd: "node", args: [], cwd: "/tmp", env };
}

beforeEach(() => {
  e2bState.createArgs = [];
  e2bState.runArgs = [];
  e2bState.sentStdin = [];
  e2bState.commandKilled = 0;
  e2bState.sandboxKilled = 0;
  e2bState.createShouldThrow = false;
  e2bState.onStdout = undefined;
  e2bState.onStderr = undefined;
});

describe("E2bTransport — boot 起沙盒与后台 runner (Req 2.1)", () => {
  it("以 template/timeout 起沙盒,并以 background+stdin+cwd+envs 起 runner", async () => {
    const t = new E2bTransport(spec({ FOO: "1", BAR: "2" }), {
      apiKey: "k",
      template: "tmpl-x",
      timeoutMs: 12345,
      sandboxCwd: "/work",
      runnerCmd: "pi --mode rpc",
      envPassthrough: ["FOO"],
    });
    await t.ready();

    expect(e2bState.createArgs).toHaveLength(1);
    const create = e2bState.createArgs[0]!;
    expect(create.template).toBe("tmpl-x");
    expect(create.opts).toMatchObject({ apiKey: "k", timeoutMs: 12345 });

    expect(e2bState.runArgs).toHaveLength(1);
    const run = e2bState.runArgs[0]!;
    expect(run.cmd).toBe("pi --mode rpc");
    expect(run.opts).toMatchObject({
      background: true,
      stdin: true,
      cwd: "/work",
      envs: { FOO: "1" }, // 仅白名单键透传,BAR 被剔除
    });
    expect(t.health().alive).toBe(true);
    await t.close();
  });

  it("domain/validateApiKey 透传给 Sandbox.create(自托管/ACS 端点)", async () => {
    const t = new E2bTransport(spec(), {
      apiKey: "sys-token",
      template: "aio",
      domain: "localhost:10000",
      validateApiKey: false,
    });
    await t.ready();
    const create = e2bState.createArgs[0]!;
    expect(create.opts).toMatchObject({
      apiKey: "sys-token",
      domain: "localhost:10000",
      validateApiKey: false,
    });
    await t.close();
  });

  it("未设 domain/validateApiKey → 不出现在 create opts(默认真实 e2b 云)", async () => {
    const t = new E2bTransport(spec(), { apiKey: "e2b_x", template: "base" });
    await t.ready();
    const create = e2bState.createArgs[0]!;
    expect(create.opts).not.toHaveProperty("domain");
    expect(create.opts).not.toHaveProperty("validateApiKey");
    await t.close();
  });
});

describe("E2bTransport — fd1 铁律与分帧 (Req 2.2)", () => {
  it("onStdout 数据块经分帧逐行喂 onLine(含跨块半行)", async () => {
    const t = new E2bTransport(spec(), { apiKey: "k", template: "t" });
    await t.ready();
    const lines: string[] = [];
    t.onLine((l) => lines.push(l));

    // 一次含两整行 + 一个半行;下一块补齐半行。
    e2bState.onStdout!('{"a":1}\n{"b":2}\n{"c":');
    e2bState.onStdout!('3}\n');

    expect(lines).toEqual(['{"a":1}', '{"b":2}', '{"c":3}']);
    await t.close();
  });

  it("stderr 只喂 onStderr,绝不混入 onLine", async () => {
    const t = new E2bTransport(spec(), { apiKey: "k", template: "t" });
    await t.ready();
    const lines: string[] = [];
    const errs: string[] = [];
    t.onLine((l) => lines.push(l));
    t.onStderr((c) => errs.push(c));

    e2bState.onStderr!("some diagnostic\n");

    expect(errs).toEqual(["some diagnostic\n"]);
    expect(lines).toEqual([]);
    await t.close();
  });
});

describe("E2bTransport — send 与 outbox (Req 2.3)", () => {
  it("就绪前 send 进 outbox,就绪后 flush 并调用 sendStdin", async () => {
    const t = new E2bTransport(spec(), { apiKey: "k", template: "t" });
    // 构造后同步 send:此刻 boot 未完成(#command 为 null)→ 进 outbox。
    t.send('{"early":true}');
    await t.ready();
    // 就绪后追加一条:直发。
    t.send('{"late":true}\n');

    expect(e2bState.sentStdin).toEqual([
      '{"early":true}\n', // outbox flush 时补了换行
      '{"late":true}\n',
    ]);
    await t.close();
  });
});

describe("E2bTransport — close 与 health (Req 2.4/2.5)", () => {
  it("close 先 kill 命令后 kill 沙盒,且 health().alive 变 false", async () => {
    const t = new E2bTransport(spec(), { apiKey: "k", template: "t" });
    await t.ready();
    expect(t.health().alive).toBe(true);

    await t.close();

    expect(e2bState.commandKilled).toBe(1);
    expect(e2bState.sandboxKilled).toBe(1);
    expect(t.health().alive).toBe(false);
  });

  it("close 后触发 onExit 监听器", async () => {
    const t = new E2bTransport(spec(), { apiKey: "k", template: "t" });
    await t.ready();
    const infos: Array<{ code: number | null; signal: string | null }> = [];
    t.onExit((i) => infos.push(i));
    await t.close();
    expect(infos).toHaveLength(1);
  });
});

describe("E2bTransport — 错误传播 (Req 2.6)", () => {
  it("boot 失败以 SpawnError 拒绝 ready(),并经 onExit 通知", async () => {
    e2bState.createShouldThrow = true;
    const t = new E2bTransport(spec(), { apiKey: "k", template: "t" });
    const exits: unknown[] = [];
    t.onExit((i) => exits.push(i));

    await expect(t.ready()).rejects.toBeInstanceOf(SpawnError);
    await expect(t.ready()).rejects.toThrow(/沙盒启动失败/);
    expect(exits).toHaveLength(1); // onExit 触发 → 会话核心据此拒绝待决命令
    expect(t.health().alive).toBe(false);
  });
});
