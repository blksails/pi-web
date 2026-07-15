# Research & Design Decisions — sandbox-baked-agent-image

## Summary
- **Feature**: `sandbox-baked-agent-image`
- **Discovery Scope**: Extension(在既有 e2b/ws-runner 传输、agent-source 解析、附件可插拔后端、CLI/脚本构建体系上扩展)
- **Key Findings**:
  - 沙盒三症状(工具/webext/布局全丢)根因 = 沙箱内跑裸 `pi --mode rpc`,pi-web custom runner 从未启动;基础镜像(`pi-clouds/agent-runner:pi`)已内置 `@blksails/pi-web-server@0.3.0` + `PI_WEB_RUNNER_ENTRY`,只差「烘焙源 + 指向 runner-bootstrap 的启动命令」。
  - agent-sandbox 的 `config-templates` 支持 **dynamic 模板**(`type:"dynamic"` + Go regexp `pattern` + 命名捕获组代入 `image`),一条规则即可路由任意烘焙镜像,无需逐镜像注册。
  - 仓内没有「agent source 预编译成 dist」的现成能力(runner-bootstrap 靠 jiti 运行时加载 TS);有成熟 esbuild 编排先例(`scripts/build-server.mjs` 的 EXTERNAL/产物根约束、`@blksails/pi-web-kit/build` 的 webext 打包)。

## Research Log

### 沙箱内进程与装配面(根因链)
- **Context**: 用户报沙盒模式工具不可用/webext 不生效/布局不对。
- **Sources Consulted**: `packages/server/src/rpc-channel/sandbox-ws-transport.ts`、`e2b-transport.ts`、`e2b-config.ts`;pi-clouds `packages/sandbox/src/agent-runner/agent-runner.ts`、`child-process-like.ts`、`demo/cloud-e2e/runner-entry.mjs`、`Dockerfile.pi`、`cloud-bridge-acs.mjs`。
- **Findings**:
  - 装配面(自定义工具 wireAttachmentBridge、webext 贡献、布局、slash 补全、state/surface、agent routes、attachment catalog)全部由 pi-web custom runner(`packages/server/src/runner/runner.ts`,经 `runner-bootstrap.mjs` 引导)在装配期建立;裸 pi 全部缺失。
  - `SandboxWsTransport` 的 configure 帧只发 env 白名单(`sandbox-ws-transport.ts:170-177`);沙箱内 `runner-entry.mjs` 无 `sourceRef` 时走 `buildFallbackChild` → `AGENT_CMD`(基础镜像默认 `pi --mode rpc`)。
  - `AGENT_CMD` 是 Pod spec 容器 env(模板渲染进 ReplicaSet),**无 envd 注入竞态**;`parseCmd` 支持空格分隔或 JSON argv(`runner-entry.mjs:29-35`)。
  - 基础镜像已 `npm i -g @blksails/pi-web-server@0.3.0 pi-web-agent-kit pi-web-tool-kit`(Dockerfile.pi:78),`RUN test -f …/runner-bootstrap.mjs`(:88),`ENV PI_WEB_RUNNER_ENTRY=…`(:90),`/workspace/node_modules → 全局` symlink(:105)。
- **Implications**: agent 镜像 = `FROM 基础镜像 + COPY 源产物 + ENV AGENT_CMD=node <bootstrap> --agent … --cwd … --agent-dir …`,沙箱内零新组件、pi-clouds 零代码改动。

### webext 静态资产与声明帧的分工(沙盒模式)
- **Context**: 烘焙镜像里是否需要携带 webext 产物、宿主是否仍能服务静态资产。
- **Findings**:
  - e2b 分支的 `resolved` 仍由宿主本地 resolver 产出(`lib/app/pi-handler.ts:407-455`)——源目录在宿主本地存在,webext 静态资产(`.pi/web/dist`)照旧由宿主服务(与非沙盒一致)。
  - webext **激活**靠 runner 装配期声明帧;沙箱内 runner 读的是烘焙进镜像的 `.pi/web` 副本。
- **Implications**: 声明(沙箱内副本)与资产(宿主本地源)须来自同一份源;烘焙工具应把 `.pi/` 全量(含 web/dist)拷入镜像,保证两侧一致。

### source 标识与模板派生
- **Context**: 建会话按 source 选模板需要稳定标识。
- **Findings**: `identify()` 分派 dir/git/plugin/builtin/default 五型(`agent-source/source-type.ts:96-130`);`policySource` 是贯穿的稳定来源标识(dir→绝对路径,git→url,resolver.ts:60-95);无现成 slug/模板名派生 helper。`selectTransport` 在会话创建路径(per-session)被调用(`pi-handler.ts:438`),`PI_WEB_E2B_TEMPLATE` 仅被 `e2bTransportConfigFromEnv` 消费且为全局单值。
- **Implications**: 新造纯函数派生(slug + 短哈希),会话时解析与构建时命名共用同一模块,保证两侧一致。

### agent-sandbox 模板注册机制
- **Context**: 烘焙镜像如何被沙盒后端寻址。
- **Sources Consulted**: 本地 kind 集群 `agent-sandbox` ConfigMap(`config-templates`/`config-sandbox-template`)。
- **Findings**: 模板为 JSON 数组 `{name,image,port?,resources?,metadata?,pool?}`;存在 **dynamic 模板先例**:`{"name":"code-interpreter-biz","pattern":"faas-code-(?P<name>.+)\\.(?P<version>.+)$","image":"ghcr.io/agent-sandbox/<name>:<version>","type":"dynamic"}`。既有静态注册:`piweb-pi` → `pi-clouds/agent-runner:pi`(port 8080)。
- **Implications**: 生产可注册一条 dynamic 规则路由全部烘焙镜像;本地 dev 也可由构建脚本静态注册单条(kubectl patch)。模板注册属部署运维操作,不算改 pi-clouds 代码。**待验证**:manager 对 ConfigMap 变更的热加载语义(不热加载则需 rollout restart)。

### CLI/脚本形态与 esbuild 先例
- **Context**: 构建工具落在 CLI 子命令还是 scripts/。
- **Findings**: CLI 子命令改动面大(bin 三处 + `server/cli/` 子域 + `new Function` 动态 import 约束);`scripts/` 家族(`build-server.mjs`/`build-webext-examples.ts`/`dev-e2b-local.mjs`)风格统一、可被 dev 流程直接 spawn。`build-server.mjs` 的 EXTERNAL 清单(pi SDK 两包 + jiti)与 workspace ALIAS 是 agent 打包的直接参照。`pack-dist.mjs` 仅原样 cpSync examples(无预编译)。
- **Implications**: 构建工具取「scripts 编排 + server 包纯函数内核」;CLI 子命令留作后续(接口已按纯函数切好)。

### 附件可插拔后端与沙盒传递
- **Context**: R5 附件语义。
- **Findings**: `PI_WEB_ATTACHMENT_BACKENDS` 单 env 承载拓扑(zod 判别联合,kind ∈ local-fs|s3|cloud-http);`computePassthroughEnv`(backends-config.ts:301-323)已计算「拓扑原文 + 被引用凭据」透传清单;子进程用同 env 重建同构拓扑。e2b 分支当前刻意不注入附件 env(pi-handler.ts:428-431);子进程附件 wiring 在 env 缺失时优雅降级(available:false,fail-closed)。
- **Implications**: 沙盒注入规则 = 拓扑存在且全部后端为远程可达类(cloud-http/s3)才透传;否则不注入 → 既有降级路径即 R5.2。

## Architecture Pattern Evaluation

| Option | Description | Strengths | Risks / Limitations | Notes |
|--------|-------------|-----------|---------------------|-------|
| WS 投源(源经 configure/source 帧进沙箱) | pi-web 客户端打包源经 WS 投递,runner 写盘再 spawn | 无镜像构建步骤 | 跨两仓改私有线协议;每会话投递慢;与"加载最快"目标相悖 | 用户已否 |
| hostPath 挂载(本地 kind) | 沙箱 Pod 挂宿主源目录 | 零投递、热更新 | 仅本地;须重建 kind 集群;与线上形态分叉 | 用户已否 |
| **镜像烘焙(选定)** | 每 source 构建专属 image:tag,启动即加载 | 加载最快;线上/本地同形态;pi-clouds 零改动;层缓存 | 源变更需重建镜像;需模板寻址机制 | 本 spec |

## Design Decisions

### Decision: 构建工具 = scripts 编排 + server 包纯函数内核
- **Context**: R2 构建工具的落点与可测试性。
- **Alternatives Considered**:
  1. CLI 子命令 `pi-web sandbox-build` — 正规但改动面大(bin/spec/dispatch/new Function 约束)。
  2. 纯 scripts/*.mjs — 最省,但决策逻辑(收集/排除/命名)不可单测。
- **Selected Approach**: 决策逻辑(文件收集、排除规则、Dockerfile 文本生成、镜像名/模板名派生)为 `packages/server/src/sandbox-image/` 纯函数;`scripts/build-agent-image.mjs` 只做 spawn 编排(esbuild/docker/kind/kubectl)。
- **Rationale**: 与 attachmentStoreConfigFromEnv 等「纯函数 + 组合根」既有风格一致;单测覆盖 R7.1;CLI 化留接缝。
- **Trade-offs**: 需要 script 经 jiti/`new Function` 加载 TS 模块(有 build-webext-examples.ts 先例:`node --import jiti/register`)。

### Decision: 源预编译 = 宿主侧 esbuild bundle → dist(index.js)
- **Context**: R2.2「构建期编译、运行时零编译」;用户明确"agent source files (dist)"。
- **Alternatives Considered**:
  1. 拷源 .ts,运行时 jiti 编译(正确但首启有编译成本,且 jiti 缓存预热难烘进镜像)。
  2. 宿主侧 esbuild bundle 成单文件 index.js(externals=pi SDK + @blksails/*,镜像全局 node_modules 可解析)。
- **Selected Approach**: 方案 2。`resolveSpawnCommand` 天然先探 `index.js`(child-process-like.ts:54);routes/ 等相对导入被 bundle 内联;`.pi/`(skills/config/web 含 dist)原样拷贝。
- **Rationale**: 运行时零编译零下载;externals 与 build-server.mjs 先例一致。
- **Trade-offs**: bundle 后 agent 内 `import.meta.url` 相对路径语义变化——排除规则与文档须提示;有此依赖的 agent 可用 `--no-bundle` 退回拷源+jiti(接口留,MVP 实现 bundle 路径)。

### Decision: 模板解析序 = 显式映射 → 门控派生 → 全局模板 → 清晰错误
- **Context**: R3;向后兼容既有单模板部署(dev:e2b:local 的 piweb-demo/piweb-pi)。
- **Selected Approach**: 新 env `PI_WEB_E2B_TEMPLATE_MAP`(JSON:source 标识→模板名);派生约定 `piweb-agent-<slug>.<tag>` 仅在 `PI_WEB_E2B_TEMPLATE_DERIVE=1` 时参与(依赖 dynamic 规则已注册,默认关避免既有部署解析到未注册名);再回落 `PI_WEB_E2B_TEMPLATE`;全空 → 携修复指引报错。派生函数与构建时命名共用 `sandbox-image/template-name.ts`。
- **Rationale**: 默认行为与现状逐字节一致(map 未配、derive 关 → 走全局模板);R3.3/3.4 全覆盖。
- **Trade-offs**: 多一个门控 env;换取零回归。
- **Follow-up**: e2b-config 的「template 必填」校验需放宽为「三级解析后仍无才报错」,注意既有 `e2b-config.test.ts` 断言迁移。

### Decision: 附件拓扑透传条件 = 拓扑存在且后端全为远程类
- **Context**: R5;沙箱不共享宿主盘,local-fs 拓扑进沙箱必坏。
- **Selected Approach**: pi-handler e2b 分支解析拓扑(parseBackendsEnv),所有 backend.kind ∈ {cloud-http, s3} 时把 `computePassthroughEnv` 结果并入 e2bSpec.env 且扩展 envPassthrough 白名单;否则不注入(子进程 wiring 既有 fail-closed 降级即 R5.2)。provider 凭据键(config.providerKeys)自动并入 envPassthrough(R4.2)。
- **Trade-offs**: 混合拓扑(含 local-fs)一律降级——宁可保守;文档注明。

### Decision: 烘焙镜像启动契约 = AGENT_CMD 指向 runner-bootstrap
- **Context**: R1/R4;沙箱内零新组件。
- **Selected Approach**: Dockerfile 生成 `ENV AGENT_CMD="node /usr/local/lib/node_modules/@blksails/pi-web-server/runner-bootstrap.mjs --agent /workspace/agent/index.js --cwd /workspace/agent --agent-dir /root/.pi/agent"` + `ENV AGENT_CWD=/workspace/agent` + `COPY staged/ /workspace/agent/`。路径写死(基础镜像 build 期已 `RUN test -f` 校验该路径)。源放 `/workspace/agent` 使向上解析命中 `/workspace/node_modules → 全局` symlink。
- **Rationale**: 复用 runner-entry builtin 兜底路径,configure 帧现状(只发 env)正好够用。
- **Follow-up**: 若基础镜像日后挪 bootstrap 路径,烘焙镜像须重建(Revalidation Trigger)。

### Simplification(综合裁剪)
- 不做「镜像内预热 jiti 缓存」(bundle 已零编译,预热无意义)。
- 不做逐镜像静态模板自动注册的强依赖——本地 dev 脚本提供 `--register`(kubectl patch)便利,生产走一次性 dynamic 规则,两者都不是会话路径依赖。
- 不为 cli 模式源(纯 .pi/ 配置)做烘焙(Out of scope,沿用通用镜像)。

## Risks & Mitigations
- **manager 不热加载 ConfigMap 模板变更** — 本地 `--register` 后执行 `kubectl rollout restart deploy/agent-sandbox` 并等就绪;e2e 脚本内置该步骤。
- **bundle 破坏个别 agent 的 import.meta/动态资源假设** — 排除规则文档化 + `--no-bundle` 逃生口(拷源 + jiti,基础镜像已带 jiti)。
- **烘焙副本与宿主本地源漂移(webext 声明 vs 资产)** — 构建输出打印内容哈希;e2e 断言声明帧与非沙盒一致;文档要求改源后重建镜像。
- **envPassthrough 白名单遗漏致沙箱内缺凭据** — providerKeys 键自动并入;附件透传键由 computePassthroughEnv 计算,不靠手填。
- **既有 e2b-config「template 必填」语义变化** — 三级解析后仍无才报错,错误文案带三种修复路径;既有测试逐条迁移。

## References
- `.kiro/specs/e2b-sandbox-transport/{requirements,design}.md` — 一期传输通道与二期锚点(附件禁用、runnerCmd)。
- pi-clouds `demo/cloud-e2e/Dockerfile.pi` / `runner-entry.mjs` — 基础镜像契约(只读参照,不修改)。
- `packages/server/src/attachment/backends-config.ts` — 拓扑与 computePassthroughEnv。
- `scripts/build-server.mjs` / `packages/web-kit/build/build.ts` — esbuild 编排先例。
