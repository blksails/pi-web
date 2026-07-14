/**
 * 视觉识别端到端(真实 runner 子进程 + mock OpenAI 兼容 provider,离线零成本)
 *   —— spec image-vision-tool。
 *
 * 真实 spawn custom 模式 runner,装载 `visionExtension`(经 e2e fixture agent,
 * 仅注入确定性假附件上下文,`complete` 走真实 `completeSimple`)。
 *
 * ★ 头号断言(「关键决策 1」在真实 HTTP 上成立):
 *   视觉模型的 apiKey **只写在 `models.json`,绝不写进环境变量**。若实现照抄 auto-title、
 *   让 `completeSimple` 自行回落 env,mock provider 收到的 Authorization 就是错的/缺失的。
 *   这条断言把「凭据必须显式解析并传入」钉死在真实网络往返上。
 *
 * 其他断言:
 *   - `/img_vision` 作为 `source:"extension"` 命令出现在 `get_commands`(Req 6.1)
 *   - 命令执行后经 `extension_ui_request{method:"notify"}` 呈现结论,**不产生助手消息**(6.3/6.4)
 *   - 送给模型的请求体确实携带图像(裸 base64 被 provider 序列化进 image_url)(5.1)
 *   - 主模型是纯文本模型也能完成识别 —— 识别被委派给视觉模型(本特性核心价值)
 */
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createServer, type Server } from "node:http";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..", "..");
const serverPkgDir = join(repoRoot, "packages", "server");
const runnerEntry = join(serverPkgDir, "src", "runner", "runner.ts");
const fixtureAgent = join(repoRoot, "e2e", "fixtures", "vision-e2e-agent");

/** 视觉模型凭据:**只**存在于 models.json,绝不进 env(关键决策 1 的实验条件)。 */
const VLM_API_KEY = "sk-only-in-models-json";
const VLM_CONCLUSION = "这是一张 1×1 的透明图片。";
const FINAL_ANSWER = "根据识别结果作答。";

interface Captured {
  readonly authorization: string | undefined;
  readonly body: string;
  readonly model: string;
}

interface MockOpts {
  /** true 时主模型(mock-text)首次回一个 image_vision 的 tool_call,第二次回终稿文本。 */
  readonly toolCall?: boolean;
}

/** mock OpenAI 兼容 provider:记录每次请求,按模型(与调用序)返回不同 SSE。 */
function startMockProvider(
  captured: Captured[],
  opts: MockOpts = {},
): Promise<{ server: Server; port: number }> {
  let textCalls = 0;
  const server = createServer((req, res) => {
    if (req.method !== "POST" || !/\/chat\/completions/.test(req.url ?? "")) {
      res.writeHead(404).end();
      return;
    }
    let raw = "";
    req.on("data", (c) => {
      raw += String(c);
    });
    req.on("end", () => {
      let model = "";
      try {
        model = String((JSON.parse(raw) as { model?: unknown }).model ?? "");
      } catch {
        /* ignore */
      }
      captured.push({
        authorization: req.headers.authorization,
        body: raw,
        model,
      });

      res.writeHead(200, {
        "content-type": "text/event-stream; charset=utf-8",
        "cache-control": "no-cache",
        connection: "keep-alive",
      });
      const base = { id: "chatcmpl-mock", object: "chat.completion.chunk", created: 0, model };
      const send = (choices: unknown[], extra?: object): void => {
        res.write(`data: ${JSON.stringify({ ...base, choices, ...extra })}\n\n`);
      };
      send([{ index: 0, delta: { role: "assistant", content: "" }, finish_reason: null }]);

      const isMainModel = model !== "mock-vlm";
      if (isMainModel) textCalls += 1;

      if (opts.toolCall === true && isMainModel && textCalls === 1) {
        // 主模型自主决定调用 image_vision 工具(Req 6.1 场景一)。
        send([
          {
            index: 0,
            delta: {
              tool_calls: [
                { index: 0, id: "call_1", type: "function", function: { name: "image_vision", arguments: "" } },
              ],
            },
            finish_reason: null,
          },
        ]);
        send([
          {
            index: 0,
            delta: { tool_calls: [{ index: 0, function: { arguments: '{"question":"什么颜色?"}' } }] },
            finish_reason: null,
          },
        ]);
        send([{ index: 0, delta: {}, finish_reason: "tool_calls" }]);
      } else {
        // 视觉模型回结论;主模型回终稿文本(或在非 toolCall 模式下回一句无关的话)。
        const content = model === "mock-vlm" ? VLM_CONCLUSION : FINAL_ANSWER;
        send([{ index: 0, delta: { content }, finish_reason: null }]);
        send([{ index: 0, delta: {}, finish_reason: "stop" }]);
      }
      send([], { usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } });
      res.write("data: [DONE]\n\n");
      res.end();
    });
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      const port = typeof addr === "object" && addr !== null ? addr.port : 0;
      resolve({ server, port });
    });
  });
}

/**
 * agent-dir:
 *  - `mock-text` 为默认(主)模型,**纯文本**(input:["text"])⇒ 证明主模型无须多模态。
 *  - `mock-vlm` 支持图像输入,凭据只在此文件里。
 */
function makeAgentDir(mockPort: number): string {
  const dir = mkdtempSync(join(tmpdir(), "vision-agentdir-"));
  const models = {
    providers: {
      mockvlm: {
        name: "Mock VLM (e2e)",
        baseUrl: `http://127.0.0.1:${mockPort}/v1`,
        apiKey: VLM_API_KEY,
        api: "openai-completions",
        models: [
          {
            id: "mock-text",
            name: "Mock Text",
            reasoning: false,
            input: ["text"],
            contextWindow: 8192,
            maxTokens: 4096,
            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
          },
          {
            id: "mock-vlm",
            name: "Mock VLM",
            reasoning: false,
            input: ["text", "image"],
            contextWindow: 8192,
            maxTokens: 4096,
            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
          },
        ],
      },
    },
  };
  const settings = {
    defaultProvider: "mockvlm",
    defaultModel: "mock-text",
    packages: [],
    loadSystemSkills: false,
  };
  writeFileSync(join(dir, "models.json"), JSON.stringify(models, null, 2));
  writeFileSync(join(dir, "settings.json"), JSON.stringify(settings, null, 2));
  writeFileSync(join(dir, "auth.json"), "{}\n");
  return dir;
}

/**
 * 隔离 env:剥掉宿主机器上的一切 provider 凭据。
 *
 * 否则 pi 的**内置模型表**(openrouter 等)会因 `OPENROUTER_API_KEY` 之类的环境变量而被
 * `getAvailable()` 判为「凭据可用」,混进候选清单 —— e2e 就依赖了跑测者的机器状态,不可重现。
 * 剥干净后候选唯一 = models.json 里的 `mockvlm/mock-vlm`,顺带证明纯文本 `mock-text` 被排除。
 */
function sanitizeEnv(): NodeJS.ProcessEnv {
  const drop =
    /(API_KEY|_TOKEN|OPENROUTER|ANTHROPIC|OPENAI|GOOGLE|GEMINI|DASHSCOPE|GROQ|XAI|MISTRAL|COHERE|DEEPSEEK|MOONSHOT|NEWAPI|SUFY|AZURE|BEDROCK|AWS_)/i;
  const env: NodeJS.ProcessEnv = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (!drop.test(k)) env[k] = v;
  }
  env["PI_WEB_STUB_AGENT"] = "";
  return env;
}

interface RunnerHandle {
  frames: unknown[];
  send: (cmd: object) => void;
  waitForFrame: (p: (f: unknown) => boolean, timeoutMs?: number) => Promise<unknown>;
  dispose: () => void;
}

function launch(agentDir: string, cwd: string): RunnerHandle {
  const proc: ChildProcessWithoutNullStreams = spawn(
    process.execPath,
    [
      "--import",
      "jiti/register",
      runnerEntry,
      "--agent",
      fixtureAgent,
      "--cwd",
      cwd,
      "--agent-dir",
      agentDir,
    ],
    {
      cwd: serverPkgDir,
      stdio: ["pipe", "pipe", "pipe"],
      // ★ 刻意剥掉一切 provider 凭据:视觉模型的 key 只能来自 models.json。
      env: sanitizeEnv(),
    },
  );
  const frames: unknown[] = [];
  let stdoutBuf = "";
  let stderrBuf = "";
  proc.stdout.setEncoding("utf8");
  proc.stdout.on("data", (chunk: string) => {
    stdoutBuf += chunk;
    let nl: number;
    while ((nl = stdoutBuf.indexOf("\n")) !== -1) {
      const line = stdoutBuf.slice(0, nl).trim();
      stdoutBuf = stdoutBuf.slice(nl + 1);
      if (line.length > 0) {
        try {
          frames.push(JSON.parse(line));
        } catch {
          /* 非 JSON 行忽略 */
        }
      }
    }
  });
  proc.stderr.setEncoding("utf8");
  proc.stderr.on("data", (c: string) => {
    stderrBuf += c;
  });
  const send = (cmd: object): void => {
    proc.stdin.write(`${JSON.stringify(cmd)}\n`);
  };
  const waitForFrame = (p: (f: unknown) => boolean, timeoutMs = 20000): Promise<unknown> =>
    new Promise((resolve, reject) => {
      const found = frames.find(p);
      if (found !== undefined) return resolve(found);
      const timer = setTimeout(() => {
        proc.stdout.off("data", onData);
        reject(
          new Error(
            `timeout waiting for frame\nframes=${JSON.stringify(frames)}\nstderr=${stderrBuf}`,
          ),
        );
      }, timeoutMs);
      const onData = (): void => {
        const m = frames.find(p);
        if (m !== undefined) {
          clearTimeout(timer);
          proc.stdout.off("data", onData);
          resolve(m);
        }
      };
      proc.stdout.on("data", onData);
    });
  return {
    frames,
    send,
    waitForFrame,
    dispose: () => {
      proc.stdin.end();
      proc.kill("SIGKILL");
    },
  };
}

interface Frame {
  type?: string;
  method?: string;
  command?: string;
  success?: boolean;
  data?: unknown;
  message?: string;
  id?: string;
  title?: string;
  options?: string[];
  toolName?: string;
  result?: {
    content?: Array<{ type: string; text?: string }>;
    details?: { ok?: boolean; model?: string };
  };
}

/** 自动应答模型选择器:选中含 `mock-vlm` 的候选。 */
function autoAnswerSelect(handle: RunnerHandle): void {
  void handle
    .waitForFrame(isSelect)
    .then((f) => {
      const sel = f as Frame;
      const opt = sel.options?.find((o) => o.includes("mock-vlm"));
      handle.send({ type: "extension_ui_response", id: sel.id, value: opt });
    })
    .catch(() => undefined);
}

const isMessagesReply = (f: unknown): boolean =>
  typeof f === "object" && f !== null && (f as Frame).command === "get_messages";

const isCommandsReply = (f: unknown): boolean =>
  typeof f === "object" && f !== null && (f as Frame).command === "get_commands";

const isToolStart = (f: unknown): boolean =>
  typeof f === "object" && f !== null && (f as Frame).type === "tool_execution_start";

const isToolEnd = (f: unknown): boolean =>
  typeof f === "object" && f !== null && (f as Frame).type === "tool_execution_end";

const isAgentEnd = (f: unknown): boolean =>
  typeof f === "object" && f !== null && (f as Frame).type === "agent_end";

const isSelect = (f: unknown): boolean =>
  typeof f === "object" &&
  f !== null &&
  (f as Frame).type === "extension_ui_request" &&
  (f as Frame).method === "select";

const isNotify = (f: unknown): boolean =>
  typeof f === "object" &&
  f !== null &&
  (f as Frame).type === "extension_ui_request" &&
  (f as Frame).method === "notify";

describe("image-vision-tool e2e(真实 runner + mock VLM provider)", () => {
  let handle: RunnerHandle | undefined;
  let mock: { server: Server; port: number } | undefined;

  afterEach(() => {
    handle?.dispose();
    handle = undefined;
    mock?.server.close();
    mock = undefined;
  });

  it("/img_vision 注册为 extension 命令(6.1)", { timeout: 60_000 }, async () => {
    const captured: Captured[] = [];
    mock = await startMockProvider(captured);
    const agentDir = makeAgentDir(mock.port);
    handle = launch(agentDir, mkdtempSync(join(tmpdir(), "vision-cwd-")));

    handle.send({ type: "get_commands" });
    const reply = (await handle.waitForFrame(isCommandsReply)) as {
      data: { commands: Array<{ name: string; source: string }> };
    };

    const cmd = reply.data.commands.find((c) => c.name === "img_vision");
    expect(cmd, `commands=${JSON.stringify(reply.data.commands)}`).toBeDefined();
    expect(cmd?.source).toBe("extension");
  });

  it("★ 凭据来自 models.json 而非 env,并经真实 HTTP 送达视觉模型(关键决策 1)", { timeout: 60_000 }, async () => {
    const captured: Captured[] = [];
    mock = await startMockProvider(captured);
    const agentDir = makeAgentDir(mock.port);
    handle = launch(agentDir, mkdtempSync(join(tmpdir(), "vision-cwd-")));

    // 等 agent 就绪(命令表可查)后再发命令,避免竞态。
    handle.send({ type: "get_commands" });
    await handle.waitForFrame(isCommandsReply);

    // 扩展命令:pi 在 agent 进程内本地执行,不进 LLM 对话流。
    handle.send({ type: "prompt", message: "/img_vision 这是什么？" });

    // RPC 模式 hasUI === true ⇒ 内核会弹模型选择器(Req 3.1)。应答它,续跑。
    const sel = (await handle.waitForFrame(isSelect)) as Frame;
    // 候选唯一:env 已剥干净,纯文本 mock-text 被 input 过滤排除(2.1 / 2.2)。
    expect(sel.options, `options=${JSON.stringify(sel.options)}`).toEqual([
      "mockvlm/mock-vlm — Mock VLM",
    ]);
    handle.send({ type: "extension_ui_response", id: sel.id, value: sel.options![0] });

    const notify = (await handle.waitForFrame(isNotify)) as Frame;

    // 结论经 ctx.ui.notify 呈现(6.3 / 6.4)。
    expect(JSON.stringify(notify)).toContain(VLM_CONCLUSION);

    // ★ 视觉模型确实被调用,且 Authorization 来自 models.json(而非环境变量)。
    const vlmCalls = captured.filter((c) => c.model === "mock-vlm");
    expect(vlmCalls, `captured=${JSON.stringify(captured.map((c) => c.model))}`).toHaveLength(1);
    expect(vlmCalls[0]?.authorization).toBe(`Bearer ${VLM_API_KEY}`);

    // 请求体确实携带图像(裸 base64 被 provider 序列化进 image_url 的 data URI)。
    const body = vlmCalls[0]?.body ?? "";
    expect(body).toContain("image_url");
    expect(body).toContain("data:image/png;base64,");

    // 主模型(纯文本)未被卷入 —— 扩展命令不走 LLM 对话流(6.4)。
    expect(captured.some((c) => c.model === "mock-text")).toBe(false);
  });

  it("用户取消模型选择 → 以 info 级呈现,不调用任何模型(3.3)", { timeout: 60_000 }, async () => {
    const captured: Captured[] = [];
    mock = await startMockProvider(captured);
    const agentDir = makeAgentDir(mock.port);
    handle = launch(agentDir, mkdtempSync(join(tmpdir(), "vision-cwd-")));

    handle.send({ type: "get_commands" });
    await handle.waitForFrame(isCommandsReply);
    handle.send({ type: "prompt", message: "/img_vision 这是什么？" });

    const sel = (await handle.waitForFrame(isSelect)) as Frame;
    handle.send({ type: "extension_ui_response", id: sel.id, cancelled: true });

    const notify = (await handle.waitForFrame(isNotify)) as Frame;
    const text = JSON.stringify(notify);
    expect(text).toContain("cancelled");
    // 取消是用户意图,不是故障 ⇒ info 级,不是 error。
    expect(text).toContain("info");
    expect(captured).toHaveLength(0);
  });

  it("★ 主模型自主调用 image_vision 工具,结果回流对话流(6.1 场景一)", { timeout: 90_000 }, async () => {
    const captured: Captured[] = [];
    mock = await startMockProvider(captured, { toolCall: true });
    const agentDir = makeAgentDir(mock.port);
    handle = launch(agentDir, mkdtempSync(join(tmpdir(), "vision-cwd-")));

    handle.send({ type: "get_commands" });
    await handle.waitForFrame(isCommandsReply);

    // 工具路径同样会弹模型选择器(与命令路径共用内核) —— 后台自动应答。
    autoAnswerSelect(handle);

    // 普通 prompt(非命令):由主模型自己决定调用 image_vision。
    handle.send({ type: "prompt", message: "看看这张图什么颜色" });

    const start = (await handle.waitForFrame(isToolStart)) as Frame;
    expect(start.toolName).toBe("image_vision");

    const end = (await handle.waitForFrame(isToolEnd)) as Frame;
    expect(end.toolName).toBe("image_vision");

    // 结果 content 仅含文本、携带 VLM 结论;**不含内联图像**(5.4)。
    const content = end.result?.content ?? [];
    expect(content.every((c) => c.type === "text")).toBe(true);
    expect(content.some((c) => c.type === "image")).toBe(false);
    expect(content.map((c) => c.text).join("")).toContain(VLM_CONCLUSION);

    // details 标明实际所用视觉模型(5.3)。
    expect(end.result?.details?.ok).toBe(true);
    expect(end.result?.details?.model).toBe("mockvlm/mock-vlm");

    // 主模型据工具结果给出终稿,轮次正常收敛。
    const done = (await handle.waitForFrame(isAgentEnd)) as { messages?: unknown[] };
    expect(JSON.stringify(done.messages)).toContain(FINAL_ANSWER);

    // 视觉模型被真实调用一次,凭据仍来自 models.json。
    const vlmCalls = captured.filter((c) => c.model === "mock-vlm");
    expect(vlmCalls).toHaveLength(1);
    expect(vlmCalls[0]?.authorization).toBe(`Bearer ${VLM_API_KEY}`);
  });

  /**
   * 注意归属:「命令不进消息历史」是 **pi + pi-web 宿主的既有平台不变量**,不是本 spec 的需求
   * (requirements 6.4 只要求「不依赖助手消息流来呈现结果」)。pi 的 registerCommand 在 agent
   * 进程内本地执行、不发 agent_start/agent_end、不产生 message;宿主再 fire-and-forget 投递。
   * vision 也无从违反它 —— 除非有人在 handler 里主动调 `pi.appendEntry`。
   *
   * 故本用例定位为**回归护栏**(挡住未来往 handler 里写历史)+ 一条真正属于本 spec 的断言:
   * 命令确实执行了识别(mock-vlm 被调用一次),而非空跑。
   */
  it("命令执行了识别,且未破坏「扩展命令不进消息历史」这一平台不变量", { timeout: 90_000 }, async () => {
    const captured: Captured[] = [];
    mock = await startMockProvider(captured);
    const agentDir = makeAgentDir(mock.port);
    handle = launch(agentDir, mkdtempSync(join(tmpdir(), "vision-cwd-")));

    handle.send({ type: "get_commands" });
    await handle.waitForFrame(isCommandsReply);

    const messagesCount = async (): Promise<number> => {
      const seen = handle!.frames.filter(isMessagesReply).length;
      handle!.send({ type: "get_messages" });
      await handle!.waitForFrame(
        (f) => isMessagesReply(f) && handle!.frames.filter(isMessagesReply).length > seen,
      );
      const replies = handle!.frames.filter(isMessagesReply) as Array<{
        data: { messages: unknown[] };
      }>;
      return replies[replies.length - 1]!.data.messages.length;
    };

    // 空会话基线。
    expect(await messagesCount()).toBe(0);

    // 先跑一轮**普通对话**,把历史撑起来 —— 借此证明 messagesCount 确实敏感,
    // 否则下面「命令后不变」可能只是「读数恒为 0」的假绿。
    handle.send({ type: "prompt", message: "你好" });
    await handle.waitForFrame(isAgentEnd);
    const baseline = await messagesCount();
    expect(baseline).toBeGreaterThan(0);

    const textCallsBefore = captured.filter((c) => c.model === "mock-text").length;
    expect(textCallsBefore).toBe(1);
    const agentEndsBefore = handle.frames.filter(isAgentEnd).length;

    // 现在发扩展命令:它是「动作」而非对话。
    autoAnswerSelect(handle);
    handle.send({ type: "prompt", message: "/img_vision 这是什么？" });
    const notify = (await handle.waitForFrame(isNotify)) as Frame;
    expect(JSON.stringify(notify)).toContain(VLM_CONCLUSION);

    // ── 本 spec 的断言:命令真的跑了识别(6.2),结论经 ctx.ui 到达(6.3/6.4)。
    expect(captured.filter((c) => c.model === "mock-vlm")).toHaveLength(1);

    // ── 平台不变量的回归护栏(非本 spec 需求,见上方注释):
    //    历史长度纹丝不动、主模型未被再次调用、无新轮次事件。
    expect(await messagesCount()).toBe(baseline);
    expect(captured.filter((c) => c.model === "mock-text")).toHaveLength(textCallsBefore);
    expect(handle.frames.filter(isAgentEnd)).toHaveLength(agentEndsBefore);
  });
});
