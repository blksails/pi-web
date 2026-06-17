# Brief — agent-source-resolver

> 语言:zh。权威设计:`PLAN.md` §3.0.0(双模式)、§3.0.1(源解析)、§10.0.C(信任门控)、§14.1③(源插件)。

## 问题
- **谁**:会话创建流程,需要知道"给定一个 source 该 spawn 什么、是自定义 agent 还是通用 CLI、要不要信任 `.pi/`"。
- **现状**:无统一的源解析;目录/git 两种来源、有/无 `index` 两种模式、project trust 在 headless 下默认静默忽略 `.pi/`,极易踩坑。
- **改变**:一个 `AgentSourceResolver`,把 `source` → `{ mode, spawnSpec, cwd, trust }`,集中处理探测与信任策略。

## 方法 / 范围
- **源类型**:本地目录(abs/rel)、git(`git:host/user/repo@ref`、`https://...@ref`、`ssh://...`)。
- **解析**:git → clone/pull 到缓存(pinned ref,非交互 `GIT_TERMINAL_PROMPT=0` + BatchMode);目录直接用。
- **入口探测**:`index.ts > index.js > index.mjs`,可被 `package.json#pi-web.entry` 覆盖。
- **双模式判定**:有入口 → `custom`(spawnSpec = `node --import jiti/register runner.ts --agent <path> --cwd <work>`);
  无入口 → `cli`(spawnSpec = `node <pkg>/dist/cli.js --mode rpc --cwd <source>`)。
- **信任策略**:`trustPolicy(source) → "always"|"never"|"ask"`(可插拔);cli 模式据此加 `--approve`,custom 模式传递给 runner。
- 缓存与并发:同 `source@ref` 复用克隆。
- **范围外**:不 spawn(rpc-channel 做);runner 本体在 agent-runner spec。

## 依赖
- protocol-contract(spawnSpec/DTO 类型)。

## 测试 + e2e(硬性)
- **单元**:源类型识别、入口探测优先级、`pi-web.entry` 覆盖、双模式判定、trustPolicy 决策矩阵(headless `ask`→忽略 `.pi/`)。
- **集成**:本地目录(含 index / 不含 index)→ 正确 mode+spawnSpec;git 源克隆到缓存(可用本地裸库 mock 远端)。
- **e2e**:两种 fixture 目录解析 → 得到的 spawnSpec 真能被 rpc-channel 拉起并 prompt 成功(跨 spec 联调,可在本 spec 内做轻量验证)。

## 约束
- 源 = 任意代码执行(jiti 载 index),信任决策须显式、按来源(§11.2)。`PI_CODING_AGENT_DIR` 用于隔离 agentDir。
