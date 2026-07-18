/**
 * desktop-cloud-login task 7.2 集成 fixture:最小真实子进程 agent(egress-login-subprocess.test.ts)。
 *
 * 不声明 routes/tools/extension(routes-e2e-agent 先例的裁剪版:本任务只需一个能真实
 * 走 prompt turn 的 plain `AgentDefinition`)。model 不在此写死 —— 继承 `--agent-dir` 下
 * settings.json 的 defaultProvider/defaultModel(登录态用例指向注入的 `pi-cloud` provider;
 * 对照组指向本地 mock provider)。
 */
const agent = {
  systemPrompt: "egress-login e2e fixture agent",
};

export default agent;
