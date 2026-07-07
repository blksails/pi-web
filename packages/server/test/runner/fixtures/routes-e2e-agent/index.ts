/**
 * agent-declared-routes task 5.1 集成 fixture:声明 routes 的最小真实子进程 agent。
 *
 * 用 plain `AgentDefinition` 对象(shape a;loader 经 duck-type 接受),**不** import
 * agent-kit —— server 包不依赖 agent-kit,fixture 又落在 server tsconfig 内(slash-agent
 * 先例)。无 pi SDK 工具 / extension,真实子进程 boot 不依赖 provider 密钥;model 继承
 * --agent-dir 下 settings.json(集成测试写入 mock provider,供 busy 场景发真 prompt)。
 *
 * 四个 route 覆盖集成断言面:
 *  - gallery-stats(GET):定值 JSON + query 回显(闭环 + 入参透传断言);
 *  - echo(POST):body/method 回显(POST body 过帧断言);
 *  - boom(GET):handler 抛错(ok:false handler_error 归一化断言);
 *  - slow(GET):按 query.ms 睡后返回(并发独立配对/不排队断言)。
 */
const agent = {
  systemPrompt: "routes e2e fixture agent",
  routes: [
    {
      name: "gallery-stats",
      methods: ["GET"],
      description: "Gallery statistics (fixture)",
      handler: (req: { query: Record<string, string> }): unknown => ({
        images: 3,
        source: "routes-e2e-agent",
        query: req.query,
      }),
    },
    {
      name: "echo",
      methods: ["POST"],
      handler: (req: { method: string; body?: unknown }): unknown => ({
        method: req.method,
        received: req.body,
      }),
    },
    {
      name: "boom",
      methods: ["GET"],
      handler: (): unknown => {
        throw new Error("boom: intentional fixture failure");
      },
    },
    {
      name: "slow",
      methods: ["GET"],
      handler: async (req: { query: Record<string, string> }): Promise<unknown> => {
        const ms = Number(req.query.ms ?? "300");
        await new Promise((r) => setTimeout(r, ms));
        return { slept: ms };
      },
    },
  ],
};

export default agent;
