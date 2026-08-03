/**
 * agent-slash-completion e2e fixture:声明 slashCompletions 的最小 agent。
 *
 * 用 plain `AgentDefinition` 对象(shape a;loader 经 duck-type 接受),**不** import
 * agent-kit —— server 包不依赖 agent-kit,fixture 又落在 server tsconfig 内。无 pi SDK
 * 工具 / extension,使真实子进程 boot 不依赖 provider 密钥;用于验证 runner 装配期把
 * slash_completions 帧写到 stdout 且不破坏 runRpcMode(R1)。
 */
const agent = {
  systemPrompt: "slash-completion e2e fixture",
  slashCompletions: [
    { name: "img-gen", description: "生成图像", insertText: "/img-gen " },
    { name: "img-edit" },
  ],
};

export default agent;
