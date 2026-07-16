/**
 * aigc-key-proxy e2e(任务 5.1)—— 独立子进程,模拟 e2b 沙盒内 aigc 工具执行。
 *
 * 与生产沙盒（`buildSandboxGatewayEnv`）注入形态等价的最小复刻:进程 env 仅含
 * `NEWAPI_BASE_URL`(指向宿主代理 `/aigc-proxy/newapi`)+ `NEWAPI_API_KEY`(=
 * 会话短期 token,非真实 provider key);编排脚本 spawn 本进程时以显式白名单
 * 传 env,不继承父 shell(断言③的前置条件)。
 *
 * 直接调用 tool-kit `createNewApiImage` 产出的路由 + 真实 `runEndpoint` 发起文生图
 * (Req 2.1, 3.3, 4.1, 5.2)—— 不经 `runImageTool`/`pi.registerTool`(那层还需要
 * `ExtensionContext`/attachment 编排,与本任务验证的"凭据换手链路"无关)。
 *
 * 输出契约:唯一一行 `SANDBOX_RESULT <json>` 到 stdout,供编排脚本解析。
 *   { ok: true,  kind, isDataUri, url, envLeak: false }
 *   { ok: false, error: string, envLeak: false }
 *   envLeak: true 表示子进程自检发现 process.env 某值包含真实 key 字面量(须永不发生)。
 *   url 携带 picked.url 全文(含 base64 全文),供编排脚本与 stub 的 FIXED_B64 fixture
 *   逐字节精确比较——仅凭 isDataUri 布尔值只做形状检查,无法排除代理转发把字节转坏的情形。
 */
import { runEndpoint } from "../../packages/tool-kit/src/engine/endpoint-adapter.js";
import { createNewApiImage } from "../../packages/tool-kit/src/aigc/providers/newapi.js";

/** 编排脚本永不应传给本子进程的真实 key 字面量(断言③自检基准)。 */
const REAL_KEY_LITERAL = process.env.E2E_REAL_KEY_LITERAL ?? "sk-real-e2e";

function selfCheckNoRealKeyLeak(): boolean {
  for (const v of Object.values(process.env)) {
    if (typeof v === "string" && v.includes(REAL_KEY_LITERAL)) return true;
  }
  return false;
}

async function main(): Promise<void> {
  const envLeak = selfCheckNoRealKeyLeak();

  const route = createNewApiImage({
    model: "gpt-image-1",
    label: "gpt-image-1",
    description: "e2e sandbox-child probe",
  });

  try {
    const picked = await runEndpoint(route, {
      prompt: "a tiny red square, flat color",
      n: 1,
      size: "256*256",
    });
    process.stdout.write(
      `SANDBOX_RESULT ${JSON.stringify({
        ok: true,
        kind: picked.kind,
        isDataUri: "url" in picked ? picked.url.startsWith("data:image") : false,
        // 断言①须与 stub 的已知 FIXED_B64 fixture 做精确比较(非仅形状检查),
        // 故完整回传 url(含 base64 全文),供编排脚本逐字节比对。
        url: "url" in picked ? picked.url : undefined,
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
