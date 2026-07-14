/**
 * 单元:frame-channel 共享原语(runner-frame-channel, Task 1)。
 * 覆盖 makeLineWriter / createInboundFrameRouter / emitAssemblyFrame / disposeAll。
 */
import { describe, it, expect, vi } from "vitest";
import { EventEmitter } from "node:events";
import {
  makeLineWriter,
  createInboundFrameRouter,
  emitAssemblyFrame,
  disposeAll,
  type SafeParser,
} from "../../src/runner/frame-channel/index.js";

/** 注入用假 stdin(EventEmitter + setEncoding + off 计数)。 */
function makeStdin() {
  const ee = new EventEmitter() as EventEmitter & {
    setEncoding(e: string): void;
  };
  (ee as unknown as { setEncoding: (e: string) => void }).setEncoding = () => {};
  return ee;
}

/** 恒通过、原样返回的 SafeParser。 */
function passThrough<T>(): SafeParser<T> {
  return { safeParse: (v) => ({ success: true, data: v as T }) };
}

describe("makeLineWriter", () => {
  it("注入出口:原样单次写出", () => {
    const out: string[] = [];
    const w = makeLineWriter({ write: (s: string) => out.push(s) });
    w("hello\n");
    expect(out).toEqual(["hello\n"]);
  });

  it("默认路径:返回可调用 writer(fd1 直写由真实子进程集成测试实测)", () => {
    // node:fs.writeSync 不可 spy(属性不可重定义);fd1 直写路径由
    // state-bridge / surface-bridge 真实子进程集成测试端到端覆盖。此处仅断言默认分支返回 writer。
    const w = makeLineWriter();
    expect(typeof w).toBe("function");
  });
});

describe("createInboundFrameRouter", () => {
  function harness() {
    const stdin = makeStdin();
    const lines: string[] = [];
    const errors: string[] = [];
    const channel = createInboundFrameRouter({
      sessionId: "s1",
      stdin,
      stdout: { write: (s: string) => (lines.push(s), true) },
      stderr: { write: (s: string) => (errors.push(s), true) },
    });
    const feed = (obj: unknown) => stdin.emit("data", JSON.stringify(obj) + "\n");
    return { stdin, lines, errors, channel, feed };
  }

  it("installed 为 true;单一 reader 派发匹配 type", () => {
    const { channel, feed } = harness();
    const seen: unknown[] = [];
    channel.register("demo", passThrough(), (f) => {
      seen.push(f);
    });
    expect(channel.installed).toBe(true);
    feed({ type: "demo", n: 1 });
    expect(seen).toEqual([{ type: "demo", n: 1 }]);
  });

  it("未注册 type / 非 JSON / 无 type 放行(不派发不抛)", () => {
    const { channel, feed, stdin } = harness();
    const seen: unknown[] = [];
    channel.register("demo", passThrough(), (f) => { seen.push(f); });
    feed({ type: "other", n: 1 });
    stdin.emit("data", "not-json\n");
    feed({ noType: true });
    expect(seen).toEqual([]);
  });

  it("schema 失败:丢弃畸形行,不调 handler", () => {
    const { channel, feed } = harness();
    const seen: unknown[] = [];
    const failing: SafeParser<unknown> = { safeParse: () => ({ success: false }) };
    channel.register("demo", failing, (f) => { seen.push(f); });
    feed({ type: "demo", bad: true });
    expect(seen).toEqual([]);
  });

  it("ctx.send / channel.send 经注入 stdout 捕获(含换行)", () => {
    const { channel, lines, feed } = harness();
    channel.register("demo", passThrough(), (_f, ctx) => {
      ctx.send({ type: "reply", ok: true });
    });
    feed({ type: "demo" });
    channel.send({ type: "outbound", v: 2 });
    expect(lines).toHaveLength(2);
    expect(lines[0]!.endsWith("\n")).toBe(true);
    expect(JSON.parse(lines[0]!.trim())).toEqual({ type: "reply", ok: true });
    expect(JSON.parse(lines[1]!.trim())).toEqual({ type: "outbound", v: 2 });
  });

  it("多 type 注册共享一个 handler;解绑句柄幂等", () => {
    const { channel, feed } = harness();
    const seen: string[] = [];
    const unregister = channel.register(
      ["a", "b"],
      passThrough(),
      (f) => { seen.push((f as { type: string }).type); },
    );
    feed({ type: "a" });
    feed({ type: "b" });
    expect(seen).toEqual(["a", "b"]);
    unregister();
    unregister(); // 幂等
    feed({ type: "a" });
    feed({ type: "b" });
    expect(seen).toEqual(["a", "b"]); // 解绑后不再派发
  });

  it("handler 抛错被捕获,记诊断不外泄", () => {
    const { channel, feed, errors } = harness();
    channel.register("demo", passThrough(), () => {
      throw new Error("boom");
    });
    expect(() => feed({ type: "demo" })).not.toThrow();
    expect(errors.join("")).toMatch(/handler error \[demo\]/);
  });

  it("cleanup 幂等:卸载 stdin 读取器后不再派发", () => {
    const { channel, feed } = harness();
    const seen: unknown[] = [];
    channel.register("demo", passThrough(), (f) => { seen.push(f); });
    channel.cleanup();
    channel.cleanup(); // 幂等
    feed({ type: "demo" });
    expect(seen).toEqual([]);
  });

  it("install 失败:installed 为 false,不抛(降级)", () => {
    const badStdin = {
      on() {
        throw new Error("cannot attach");
      },
    } as unknown as EventEmitter;
    const errors: string[] = [];
    const channel = createInboundFrameRouter({
      sessionId: "s1",
      stdin: badStdin as never,
      stderr: { write: (s: string) => (errors.push(s), true) },
    });
    expect(channel.installed).toBe(false);
    expect(errors.join("")).toMatch(/stdin reader install error/);
    // send 仍可用(与 reader 无关)。
    expect(() => channel.send({ type: "x" })).not.toThrow();
  });
});

describe("emitAssemblyFrame", () => {
  it("注入出口:写单行 JSONL 帧", () => {
    const out: string[] = [];
    emitAssemblyFrame({ type: "decl", items: [1, 2] }, (l) => out.push(l));
    expect(out).toHaveLength(1);
    expect(out[0]!.endsWith("\n")).toBe(true);
    expect(JSON.parse(out[0]!.trim())).toEqual({ type: "decl", items: [1, 2] });
  });

  it("默认出口:经 process.stdout.write", () => {
    const spy = vi
      .spyOn(process.stdout, "write")
      .mockReturnValue(true as unknown as boolean);
    try {
      emitAssemblyFrame({ type: "decl" });
      expect(spy).toHaveBeenCalledWith(JSON.stringify({ type: "decl" }) + "\n");
    } finally {
      spy.mockRestore();
    }
  });
});

describe("disposeAll", () => {
  it("单个 cleanup 抛错仍释放其余并记诊断;跳过 null", () => {
    const order: string[] = [];
    const errs: string[] = [];
    disposeAll(
      [
        { cleanup: () => { order.push("a"); } },
        null,
        {
          cleanup: () => {
            throw new Error("nope");
          },
        },
        undefined,
        { cleanup: () => { order.push("c"); } },
      ],
      { write: (s: string) => (errs.push(s), true) },
    );
    expect(order).toEqual(["a", "c"]);
    expect(errs.join("")).toMatch(/dispose cleanup error/);
  });

  it("支持异步 cleanup(拒绝被收敛不抛)", async () => {
    const errs: string[] = [];
    expect(() =>
      disposeAll(
        [{ cleanup: async () => Promise.reject(new Error("async boom")) }],
        { write: (s: string) => (errs.push(s), true) },
      ),
    ).not.toThrow();
    await new Promise((r) => setTimeout(r, 0));
    expect(errs.join("")).toMatch(/dispose cleanup error/);
  });
});
