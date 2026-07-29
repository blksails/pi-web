/**
 * agent-declared-routes task 5.1 集成 fixture:声明 routes 的最小真实子进程 agent。
 *
 * 用 plain `AgentDefinition` 对象(shape a;loader 经 duck-type 接受),**不** import
 * agent-kit —— server 包不依赖 agent-kit,fixture 又落在 server tsconfig 内(slash-agent
 * 先例)。无 pi SDK 工具 / extension,真实子进程 boot 不依赖 provider 密钥;model 继承
 * --agent-dir 下 settings.json(集成测试写入 mock provider,供 busy 场景发真 prompt)。
 *
 * 文件组织按声明式路由标准(≥2 路由抽 routes/ 子目录,一路由一文件 + barrel;见
 * docs/product/07「声明式路由的文件组织」)。四个 route 覆盖集成断言面:
 *  - gallery-stats(GET):定值 JSON + query 回显(闭环 + 入参透传断言);
 *  - echo(POST):body/method 回显(POST body 过帧断言);
 *  - boom(GET):handler 抛错(ok:false handler_error 归一化断言);
 *  - slow(GET):按 query.ms 睡后返回(并发独立配对/不排队断言)。
 */
import { routes } from "./routes/index.js";

const agent = {
  systemPrompt: "routes e2e fixture agent",
  routes,
};

export default agent;
