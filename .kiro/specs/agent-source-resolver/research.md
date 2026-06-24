# Research & Design Decisions — agent-source-resolver

## Summary
- **Feature**: `agent-source-resolver`
- **Discovery Scope**: New Feature(greenfield 内核引擎组件)
- **Key Findings**:
  - 解析器是**纯规格生产者**:产出 `{ mode, spawnSpec, cwd, trust }`,不 spawn、不载入用户代码;spawn 归 `rpc-channel`,runner 本体归 `agent-runner`(PLAN §3.0.0/§3.0.3,brief 范围外)。
  - headless(`--mode rpc`)下 pi **不弹信任提示**,`defaultProjectTrust` 默认 `"ask"` → **静默忽略** `.pi/` 项目资源;必须由本特性显式表态(cli 加 `--approve`/`--no-approve`,custom 传 runner 决策)。这是项目最易踩坑点(PLAN §10.0.C)。
  - 信任 = 自动执行项目内任意扩展代码 = RCE;故信任做成**可插拔、按来源**的 `trustPolicy(source)`,默认 `"ask"`,绝不无脑全开(PLAN §11.2、§13.4)。
  - spawnSpec 形状须与 `@blksails/protocol` 对齐并满足 `rpc-channel` local 通道(child_process)直接拉起需求;agentDir 隔离 env 名是 `PI_CODING_AGENT_DIR`(非 `PI_AGENT_DIR`)。

## Research Log

### 双模式判定与 spawn 目标
- **Context**:需要由"是否有入口文件"决定 custom 还是 cli,且两模式对外同一 RPC 协议。
- **Sources Consulted**:`PLAN.md` §3.0.0(双模式表)、§3.0.1(源解析)、§3.0.3(runner 启动方式)。
- **Findings**:
  - 含 `index.[ts|js|mjs]`(或 `package.json#pi-web.entry`)→ custom → `node --import jiti/register runner.ts --agent <path> --cwd <work>`。
  - 无入口 / 未指定 source → cli → `node <pkg>/dist/cli.js --mode rpc --cwd <source>`。
  - 检测逻辑权威落点为 `agent-source.ts`,返回 `{ mode, spawnSpec }`(brief 扩展为含 `cwd`、`trust`)。
- **Implications**:解析器输出形状固定为四元组;cmd 恒为 `node`,差异落在 `args/cwd/env`;runner 路径作为解析器配置注入(runner 本体不在本 spec)。

### Git 源解析、缓存与非交互
- **Context**:git 三形态 URL、pinned ref、缓存复用、并发去重、非交互安全。
- **Sources Consulted**:`PLAN.md` §3.0.1、§10.1.3③(非交互 git 约束)。
- **Findings**:缓存路径 `~/.pi-web/agents/git/<host>/<path>@<ref>`;`GIT_TERMINAL_PROMPT=0` + `GIT_SSH_COMMAND` BatchMode;同 `source@ref` 复用克隆。
- **Implications**:需要按 `source@ref` 归一化的缓存键与一把进行中操作锁(in-flight promise)做并发去重;集成测试可用本地 bare repo 作远端 mock,免外网。

### 信任门控(headless `.pi/`)
- **Context**:`.pi/` 项目资源在 headless 下默认被静默忽略,需显式信任策略。
- **Sources Consulted**:`PLAN.md` §10.0.C(Q1/Q2 + pi-web 处理策略)。
- **Findings**:
  - 全局/用户级扩展 + context 文件(AGENTS.md/CLAUDE.md)**不受信任限制**,相对 agentDir 加载。
  - `.pi/` 受 project trust 门控;headless 无已保存决定时按 `defaultProjectTrust`(默认 `ask`→忽略)。
  - 覆盖手段:cli `--approve`(单次信任)/`--no-approve`(单次忽略);custom 模式由 runner 在 `resolveProjectTrust` 回调 / `projectTrustContext` 控制。
- **Implications**:信任结果映射到两种模式落地方式不同:cli → args 标志;custom → 经 spawnSpec(arg/env)把决策传给 runner(runner 实现在 agent-runner)。本 spec 只产出"如何告诉子进程",不实现 runner 端读取。

### 与上游 protocol-contract 的契约消费
- **Context**:spawnSpec/DTO 类型来源。
- **Sources Consulted**:`protocol-contract/design.md`(REST DTO:建会话 `{source, cwd?, model?, env?}`)。
- **Findings**:protocol 的 `CreateSessionRequest` 提供入参形状;`SpawnSpec { cmd, args, cwd, env }` 由上游 `@blksails/protocol`(protocol-contract)**拥有**,本 spec 经 `import type { SpawnSpec } from "@blksails/protocol"` 复用,不在本地定义或重声明该类型。
- **Implications**:依赖方向单向(本 spec → protocol);`SpawnSpec` 已被多 spec(本 spec、`rpc-channel` 等)共享,其单一来源在 protocol-contract;该类型形状/命名变化作为 revalidation trigger。

## Architecture Pattern Evaluation

| Option | Description | Strengths | Risks / Limitations | Notes |
|--------|-------------|-----------|---------------------|-------|
| 管道式解析(identify → fetch → probe → decide → trust → assemble) | 按阶段串联的纯函数 + 少量 IO 阶段 | 每阶段可独立单测;边界清晰 | 需明确 IO(git/fs)与纯逻辑分层 | 选定 |
| 单体 resolve() 大函数 | 一个函数内全部完成 | 简单 | 难测、难插拔、易耦合 | 否决 |
| 策略对象(每源类型一个解析器) | 以接口分发不同源类型 | 天然支持 `sourceResolver` 插件 | 轻微样板 | 采纳其插件接缝,核心仍走管道 |

## Design Decisions

### Decision: 解析器只产出规格,不 spawn、不载入用户代码
- **Context**:brief 明确范围外为 rpc-channel(spawn)与 agent-runner(runner 本体)。
- **Alternatives Considered**:1) 解析后顺手 spawn 验证可用性;2) 严格只产出规格。
- **Selected Approach**:严格只产出 `{ mode, spawnSpec, cwd, trust }`;e2e 健全性仅断言 spawnSpec 形状满足 rpc-channel 拉起契约,不长期运行子进程。
- **Rationale**:守住 spec 边界,避免把 RCE 风险与进程生命周期带入本层。
- **Trade-offs**:无法在本层直接证明"真能跑";以 spawnSpec 形状契约 + 跨 spec 健全性测试折中。
- **Follow-up**:rpc-channel 实装后做一次跨 spec 联调验证(Req 9.5)。

### Decision: 信任做成可插拔 `trustPolicy(source)`,默认 `ask`
- **Context**:信任 = RCE;须显式按来源。
- **Selected Approach**:`trustPolicy(source) → "always"|"never"|"ask"`,默认 `ask`;结果映射 cli 模式 `--approve`/`--no-approve`、custom 模式经 spawnSpec 传 runner。
- **Rationale**:满足 §10.0.C 与 §13.4 的可插拔策略点,默认安全。
- **Trade-offs**:`ask` 在 headless 下静默忽略 `.pi/`——这是预期且文档化的行为,需在测试中固化。

### Decision: 缓存键 = 归一化 `source@ref`,并发去重用 in-flight promise 表
- **Context**:重复/并发解析同源。
- **Selected Approach**:缓存目录按 host/path@ref 派生;一张 `Map<cacheKey, Promise<resolvedDir>>` 去重进行中操作;缓存损坏则重建。
- **Rationale**:避免重复克隆与竞态(Req 6)。

## Risks & Mitigations
- pi 信任语义/CLI 标志随版本变化 → 把 cli 标志与 custom 决策传递点收敛到单一映射函数,变更只改一处;集成测试固化当前映射。
- spawnSpec 形状与 rpc-channel 期望漂移 → Req 9.5 跨 spec 健全性测试 + 与 protocol 命名对齐。
- git 非交互配置遗漏导致挂起 → 强制注入 `GIT_TERMINAL_PROMPT=0` 与 ssh BatchMode,集成测试用本地 bare repo 验证零交互。
- 敏感 env 泄露 → 错误/日志路径禁止打印 env 值(Req 7.3)。

## References
- `PLAN.md` §3.0.0 双模式、§3.0.1 源解析、§3.0.3 bootstrap runner、§10.0.C 信任门控、§11.2 安全沙箱、§13.4 扩展点(trustPolicy/sourceResolver)、§14.1 三道接缝。
- `.kiro/specs/protocol-contract/design.md` — REST DTO(CreateSessionRequest)与契约消费方向。
- `.kiro/steering/{tech,structure,product}.md` — 技术栈、目录模式、产品定位。
