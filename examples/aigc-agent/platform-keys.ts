/**
 * 子进程侧 provider key 预取(P0-B B6 消费端 · 方案 A)。
 *
 * vendor tool-kit 的 `var-resolver` 是纯 `process.env`、无解析钩子(注释明说多租户 key 留给
 * 应用层)。故本 agent 启动时经 @aigc-agent/platform-client 从**父进程平台**解析本租户(回调
 * token 绑定)的 provider key,写进子进程 `process.env`,再交给 vendor 工具照常读。
 *
 * 语义:
 *  - 平台不可用(无回调 token / stub / 离线)→ 直接返回,保留父进程经 spawn env 直传的全局 key
 *    (现状,向后兼容)。
 *  - 平台某 provider 命中 DB key → 覆盖 env(按租户);未命中 → resolveProviderKey 自身回落父进程
 *    env,回来的仍是全局 key,幂等无害。
 *  - 单 provider 失败/超时不影响其余;整体有超时上限,绝不无限阻塞启动。
 *
 * **安全边界(2026-07-20 核实,勿想当然)**:写进 `process.env` 的裸 key 会被**孙进程完整继承**
 * ——pi SDK 的 bash 工具用 `getShellEnv()` = `{...process.env}` 交给 shell
 * (`pi-coding-agent/dist/utils/shell.js:103-114`、`dist/core/tools/bash.js:42,100`),**无白名单**。
 * 因此「裸 key 不外泄」靠的**不是** key 不在 env,而是这个 agent **没有 bash 工具**
 * (`index.ts` 的 `noTools: "builtin"`,并由 `e2e/node/aigc-agent-load.e2e.test.ts` 钉死)。
 * 推论:**若将来接 stdio transport 的 MCP server(也是孙进程),同样会拿到这些 key** ——
 * 故 MCP 下发只走 http(`McpBinding.transport` 已定死为 `"http"`)。
 */
import { getPlatformContext } from "./platform-client.js";

/** AIGC 工具用到的 provider → 承载其 key 的 env 变量名(与 vendor `${VAR}` 占位一致)。 */
const AIGC_PROVIDERS: ReadonlyArray<{
  readonly provider: string;
  readonly envVar: string;
  readonly purpose?: string;
}> = [
  { provider: "sufy", envVar: "SUFY_API_KEY" },
  { provider: "newapi", envVar: "NEWAPI_API_KEY" },
  // AIGC 用标准 dashscope(purpose=aigc 跳过 token-plan,与 pi-labs 一致)。
  { provider: "dashscope", envVar: "DASHSCOPE_API_KEY", purpose: "aigc" },
  { provider: "openrouter", envVar: "OPENROUTER_API_KEY" },
  { provider: "ark", envVar: "ARK_API_KEY" },
];

const PREFETCH_TIMEOUT_MS = 3000;

export async function prefetchPlatformKeys(): Promise<void> {
  const platform = getPlatformContext();
  if (!platform.available) return; // 无回调 token → env 直传兜底(现状)。

  const resolveOne = async (p: (typeof AIGC_PROVIDERS)[number]): Promise<void> => {
    try {
      const { key } = await platform.getKey(p.provider, p.purpose);
      if (key.length > 0) process.env[p.envVar] = key;
    } catch {
      // 平台无此 key(404)或回调失败 → 保留子进程 env 兜底。
    }
  };

  // 整体超时:父进程卡住也不无限阻塞 agent 启动(超时后用已填/原有 env 继续)。
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<void>((resolve) => {
    timer = setTimeout(resolve, PREFETCH_TIMEOUT_MS);
  });
  try {
    await Promise.race([Promise.all(AIGC_PROVIDERS.map(resolveOne)), timeout]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}
