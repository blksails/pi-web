/**
 * llm-gateway e2e(spec sandbox-credentials-v2,Task 4.1)—— 独立子进程,模拟沙盒基座镜像
 * entrypoint 语义:进程 env 仅含 `PI_LLM_GATEWAY_BASE` + `PI_LLM_TOKEN_<ID>`(经
 * `buildSandboxLlmEnv` 产出的跨仓契约键名),**不含任何 `PROVIDER_KEY_NAMES` 真实值**
 * (Req 6.1)——编排脚本 spawn 本进程时以显式白名单传 env,不继承父 shell。
 *
 * 用 token 当 apiKey 打网关(与真实沙盒内 AIGC/主 LLM 工具的用法等价):
 * `Authorization: Bearer ${PI_LLM_TOKEN_NEWAPI}` 发往
 * `${PI_LLM_GATEWAY_BASE}/newapi/chat/completions`,`stream:true`(Req 2.3, 6.2)。
 *
 * 输出契约:唯一一行 `SANDBOX_RESULT <json>` 到 stdout,供编排脚本解析。
 *   { ok: true,  status, chunkCount, fullText, incremental, envLeak: false }
 *   { ok: false, error: string, envLeak: false }
 *   envLeak: true 表示子进程自检发现 process.env 某键属于 PROVIDER_KEY_NAMES(须永不发生)。
 *   incremental: true 表示分块到达之间存在可观测的时间间隔(证明非整体缓冲后一次性返回,
 *   而是逐块流式转发——见 gateway-routes.ts 的 `new Response(upstream.body, …)` 非缓冲直通)。
 */

/**
 * 镜像 `lib/app/config.ts` 的 `PROVIDER_KEY_NAMES`(该常量未导出,故在此按当前实况镜像一份
 * 字面量,与该文件同构惯例——参见已摘除的 `e2e/aigc-proxy/sandbox-child.ts` 的
 * `REAL_KEY_LITERAL` 自检写法)。任何一个键在本子进程 env 中出现即视为凭据泄露。
 */
const PROVIDER_KEY_NAMES = [
  "ANTHROPIC_API_KEY",
  "OPENAI_API_KEY",
  "GOOGLE_GENERATIVE_AI_API_KEY",
  "GEMINI_API_KEY",
  "MISTRAL_API_KEY",
  "OPENROUTER_API_KEY",
  "DASHSCOPE_API_KEY",
  "APISERVICES_API_KEY",
  "NEWAPI_API_KEY",
  "SUFY_API_KEY",
] as const;

function selfCheckNoProviderKeyLeak(): boolean {
  return PROVIDER_KEY_NAMES.some((name) => process.env[name] !== undefined);
}

/**
 * 最小 SSE 增量分帧器:按 `\n\n` 切事件,提取 `data: ...` 行(忽略 `[DONE]`)。
 *
 * 有状态(非纯函数):调用方每次喂入新解码到的文本片段,内部维护跨调用的残余 buffer——
 * 只有以 `\n\n` 结尾确认完整的事件才会被消费并返回,未完整的尾部留在 buffer 里等下次
 * 拼接,避免重复解析已消费过的事件(逐次全量重新 split 整个累积 buffer 会导致同一事件
 * 被计入多次)。
 */
function createSseFrameParser(): { push(text: string): string[] } {
  let buf = "";
  return {
    push(text: string): string[] {
      buf += text;
      const events = buf.split("\n\n");
      // 最后一段可能不完整(未见到结尾的 \n\n),留到下次继续拼接。
      buf = events.pop() ?? "";
      return events
        .map((event) => event.trim())
        .filter((event) => event.startsWith("data:"))
        .map((event) => event.slice("data:".length).trim())
        .filter((payload) => payload.length > 0 && payload !== "[DONE]");
    },
  };
}

async function main(): Promise<void> {
  const envLeak = selfCheckNoProviderKeyLeak();

  const gatewayBase = process.env.PI_LLM_GATEWAY_BASE;
  const token = process.env.PI_LLM_TOKEN_NEWAPI;

  if (!gatewayBase || !token) {
    process.stdout.write(
      `SANDBOX_RESULT ${JSON.stringify({
        ok: false,
        error: `缺少 PI_LLM_GATEWAY_BASE/PI_LLM_TOKEN_NEWAPI(gatewayBase=${gatewayBase}, hasToken=${Boolean(token)})`,
        envLeak,
      })}\n`,
    );
    return;
  }

  try {
    const res = await fetch(`${gatewayBase}/newapi/chat/completions`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-image-2-e2e",
        stream: true,
        messages: [{ role: "user", content: "e2e llm-gateway probe" }],
      }),
    });

    if (!res.ok || res.body === null) {
      process.stdout.write(
        `SANDBOX_RESULT ${JSON.stringify({
          ok: false,
          error: `非预期响应 status=${res.status}`,
          envLeak,
        })}\n`,
      );
      return;
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    const readTimestamps: number[] = [];
    const dataPayloads: string[] = [];
    const parser = createSseFrameParser();

    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      readTimestamps.push(Date.now());
      dataPayloads.push(...parser.push(decoder.decode(value, { stream: true })));
    }

    // 逐块到达证明(非整体缓冲一次性返回):至少两次独立 read() 且首末 read 之间存在可观测
    // 间隔(stub 上游按 CHUNK_DELAY_MS 分批 flush,若网关整体缓冲后转发,client 侧的多次
    // read() 到达时间会紧贴在一起,不会跨越 stub 侧引入的分块间隔)。
    const firstRead = readTimestamps[0];
    const lastRead = readTimestamps[readTimestamps.length - 1];
    const span =
      readTimestamps.length >= 2 && firstRead !== undefined && lastRead !== undefined
        ? lastRead - firstRead
        : 0;
    const incremental = readTimestamps.length >= 2 && span >= 40;

    // 每个 SSE data 事件是 `{"choices":[{"delta":{"content":"..."}}]}`(openai chat
    // completions 风格增量);拼接 delta.content 得到全文,供与 stub fixture 逐字精确比较
    // (仅凭 chunkCount/incremental 无法排除代理把内容字节转坏但仍产出语法合法分帧的情形)。
    const fullText = dataPayloads
      .map((payload) => {
        try {
          const parsed = JSON.parse(payload) as {
            choices?: { delta?: { content?: string } }[];
          };
          return parsed.choices?.[0]?.delta?.content ?? "";
        } catch {
          return "";
        }
      })
      .join("");

    process.stdout.write(
      `SANDBOX_RESULT ${JSON.stringify({
        ok: true,
        status: res.status,
        chunkCount: dataPayloads.length,
        readCount: readTimestamps.length,
        spanMs: span,
        incremental,
        fullText,
        envLeak,
      })}\n`,
    );
  } catch (err) {
    process.stdout.write(
      `SANDBOX_RESULT ${JSON.stringify({
        ok: false,
        error: err instanceof Error ? err.message : String(err),
        envLeak,
      })}\n`,
    );
  }
}

void main();
