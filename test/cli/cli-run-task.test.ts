/**
 * `pi-web run` 子命令解析与任务编排纯函数单测。
 */
import { describe, it, expect, vi } from "vitest";
import { resolve } from "node:path";
import {
  parseCliArgs,
  buildEnv,
  CliUsageError,
  expandRunAttachmentArgv,
  stripAttachmentAtPrefix,
  guessMimeFromPath,
  bootstrapRunTask,
  main,
} from "@/bin/pi-web.mjs";

const BASE = "/home/user/proj";
const ENV = { PATH: "/usr/bin" };

describe("expandRunAttachmentArgv", () => {
  it("把 --attachments 后连续路径拆成重复 --attachment", () => {
    expect(
      expandRunAttachmentArgv([
        "hello",
        "--source",
        "./agent",
        "--attachments",
        "@images/1.jpg",
        "@images/2.jpg",
        "--open",
      ]),
    ).toEqual([
      "hello",
      "--source",
      "./agent",
      "--attachment",
      "@images/1.jpg",
      "--attachment",
      "@images/2.jpg",
      "--open",
    ]);
  });

  it("支持逗号分隔与重复 --attachment", () => {
    expect(expandRunAttachmentArgv(["p", "--attachments", "a.jpg,b.png"])).toEqual([
      "p",
      "--attachment",
      "a.jpg",
      "--attachment",
      "b.png",
    ]);
    expect(expandRunAttachmentArgv(["p", "--attachment", "a.jpg", "--attachment", "b.png"])).toEqual([
      "p",
      "--attachment",
      "a.jpg",
      "--attachment",
      "b.png",
    ]);
  });
});

describe("stripAttachmentAtPrefix / guessMimeFromPath", () => {
  it("剥 @ 前缀", () => {
    expect(stripAttachmentAtPrefix("@images/1.jpg")).toBe("images/1.jpg");
    expect(stripAttachmentAtPrefix("images/1.jpg")).toBe("images/1.jpg");
  });

  it("按扩展名猜 MIME", () => {
    expect(guessMimeFromPath("x.PNG")).toBe("image/png");
    expect(guessMimeFromPath("a.jpg")).toBe("image/jpeg");
    expect(guessMimeFromPath("z.bin")).toBe("application/octet-stream");
  });
});

describe("parseCliArgs — run 子命令", () => {
  it("解析 prompt / source / model / provider / attachments / open", () => {
    const o = parseCliArgs([
      "run",
      "参考下面图片生成一个新的设计，保持风格一致，光影效果，移除水印",
      "--source",
      "./aigc-agent",
      "-m",
      "qwen-3.8-max",
      "--provider",
      "dashscope-token-plan",
      "--attachments",
      "@images/1.jpg",
      "@images/2.jpg",
      "--open",
    ]);
    expect(o.intent).toBe("run-task");
    expect(o.prompt).toBe("参考下面图片生成一个新的设计，保持风格一致，光影效果，移除水印");
    expect(o.source).toBe("./aigc-agent");
    expect(o.model).toBe("qwen-3.8-max");
    expect(o.provider).toBe("dashscope-token-plan");
    expect(o.attachments).toEqual(["images/1.jpg", "images/2.jpg"]);
    expect(o.open).toBe(true);
  });

  it("缺少 prompt 抛 CliUsageError", () => {
    expect(() => parseCliArgs(["run", "--source", "./a"])).toThrow(CliUsageError);
  });

  it("多余位置参数(未挂到 attachments)抛错", () => {
    expect(() => parseCliArgs(["run", "hi", "extra"])).toThrow(CliUsageError);
  });

  it("`run --help` → help 意图", () => {
    const o = parseCliArgs(["run", "--help"]);
    expect(o.intent).toBe("help");
    expect(o.subcommand).toBe("run");
  });

  it("main() 对 `run --help` 输出专属用法", async () => {
    const chunks: string[] = [];
    const spy = vi.spyOn(process.stdout, "write").mockImplementation((c: unknown) => {
      chunks.push(String(c));
      return true;
    });
    try {
      const code = await main(["run", "--help"]);
      expect(code).toBe(0);
      const out = chunks.join("");
      expect(out).toContain("pi-web run");
      expect(out).toContain("--attachments");
      expect(out).toContain("--provider");
    } finally {
      spy.mockRestore();
    }
  });
});

describe("buildEnv — run-task 模型/provider", () => {
  it("注入 PI_WEB_DEFAULT_MODEL / PROVIDER 与 source", () => {
    const o = parseCliArgs([
      "run",
      "hello",
      "--source",
      "./agent",
      "--model",
      "m1",
      "--provider",
      "p1",
    ]);
    const env = buildEnv(
      {
        ...o,
        intent: "run",
        source: o.source,
        watch: false,
      },
      BASE,
      ENV,
    );
    expect(env.PI_WEB_DEFAULT_SOURCE).toBe(resolve(BASE, "./agent"));
    expect(env.PI_WEB_DEFAULT_MODEL).toBe("m1");
    expect(env.PI_WEB_DEFAULT_PROVIDER).toBe("p1");
    expect(env.PI_WEB_AUTOSTART).toBe("1");
  });
});

describe("bootstrapRunTask", () => {
  it("按序 create → setModel → upload → stream → message,返回会话 URL", async () => {
    const calls: Array<{ url: string; method?: string }> = [];
    const fetchImpl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      calls.push({ url, method });

      if (url.endsWith("/api/sessions") && method === "POST") {
        return new Response(JSON.stringify({ sessionId: "sess_test" }), { status: 201 });
      }
      if (url.includes("/models") && method === "POST") {
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }
      if (url.includes("/attachments") && method === "POST") {
        return new Response(
          JSON.stringify({
            attachment: { id: "att_abc" },
            displayUrl: "/attachments/att_abc/raw",
          }),
          { status: 200 },
        );
      }
      if (url.includes("/stream")) {
        return new Response(
          new ReadableStream({
            start(controller) {
              controller.enqueue(new TextEncoder().encode(":ok\n\n"));
              // 保持打开一会,模拟 SSE
              setTimeout(() => controller.close(), 30);
            },
          }),
          { status: 200, headers: { "content-type": "text/event-stream" } },
        );
      }
      if (url.includes("/messages") && method === "POST") {
        const body = JSON.parse(String(init?.body ?? "{}"));
        expect(body.message).toBe("参考图片改图");
        expect(body.attachmentIds).toEqual(["att_abc"]);
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }
      return new Response("not found", { status: 404 });
    });

    // 用真实存在的本文件当假附件,避免存在性检查失败。
    const self = new URL(import.meta.url).pathname;

    const result = await bootstrapRunTask({
      baseUrl: "http://127.0.0.1:3999",
      source: "/tmp/agent",
      prompt: "参考图片改图",
      model: "qwen-3.8-max",
      provider: "dashscope-token-plan",
      attachments: [self],
      trust: true,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    expect(result.sessionId).toBe("sess_test");
    expect(result.url).toBe("http://127.0.0.1:3999/session/sess_test");

    const methods = calls.map((c) => `${c.method} ${c.url.replace("http://127.0.0.1:3999", "")}`);
    expect(methods[0]).toBe("POST /api/sessions");
    expect(methods).toContain("POST /api/sessions/sess_test/models");
    expect(methods.some((m) => m.startsWith("POST /api/sessions/sess_test/attachments"))).toBe(
      true,
    );
    expect(methods.some((m) => m.startsWith("GET /api/sessions/sess_test/stream"))).toBe(true);
    expect(methods).toContain("POST /api/sessions/sess_test/messages");

    // stream 必须在 messages 之前发起
    const streamIdx = methods.findIndex((m) => m.includes("/stream"));
    const msgIdx = methods.findIndex((m) => m.includes("/messages"));
    expect(streamIdx).toBeGreaterThanOrEqual(0);
    expect(msgIdx).toBeGreaterThan(streamIdx);
  });
});
