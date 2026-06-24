# pi-probe-agent

一个**自包含的探针示例**,用于验证「项目级 `.pi/` 资源(扩展 / 子代理 / 技能)是否被正确加载」,
并演示 pi-web 的 **project trust** 门控(见仓库根 `docs/pi-trust-loading-design.md`)。

与 `hello-agent` 同构(单文件 `index.ts`,default export 一个 `AgentDefinition`,由 bootstrap
runner 经 jiti 加载),但**刻意保留 `.pi/` 资源发现**,并自带一组项目级探针资源。

## 目录结构

```
examples/pi-probe-agent/
  index.ts                      # defineAgent({...}):探针 agent(default export)
  README.md
  .pi/                          # ← 被测对象:本目录的项目级资源(以本目录为 cwd 时被发现)
    extensions/pi-probe.ts      # 注册工具 pi_probe_ping + 命令 /pi-probe + session_start 通知
    agents/pi-probe-subagent.md # 测试子代理
    skills/pi-probe/SKILL.md    # 测试技能
```

> 注:`.pi/` 资源按**工作目录(cwd)**发现,而非 agent 源目录。要让本示例的 `.pi/` 生效,
> 运行时需把 **cwd 指向本目录**(`examples/pi-probe-agent`)。

## 它测什么(以本目录为 cwd 运行)

| 现象 | 含义 |
|---|---|
| `get_commands` 出现 `pi-probe`(`source:"extension"`)/ 工具列表出现 `pi_probe_ping` / 会话开始有 "✅ .pi/extensions/pi-probe 已加载" 通知 | `.pi/extensions` 已加载 |
| 子代理 `pi-probe-subagent` 可派发 | `.pi/agents` 已加载 |
| 系统提示出现 `pi-probe-skill` 的 name+description | `.pi/skills` 已加载 |
| 只剩 `agent_selfcheck`、上述都没有 | `.pi/` **未加载**(多半 trust 未放行) |

`index.ts` 里的 `agent_selfcheck` 工具用于确认 agent 本体存活(与 `.pi/` 是否加载无关)。

## 先决条件:project trust(关键)

项目级 `.pi/` 受 **project trust** 门控。放行方式:

- **经 pi-web server(create-session)— 默认即可**:pi-web 默认信任 app 所服务的项目根
  (`config.defaultCwd` = `PI_WEB_DEFAULT_CWD ?? process.cwd()`)及其子树。本示例位于仓库内
  (`examples/pi-probe-agent`,在该根之下),故**重启 app 后开箱即加载**,无需额外配置。
  - ⚠️ pi-handler 单例 pin 在 `globalThis` 上、热重载不重建 → 改完代码/配置须**整进程重启**。
  - 关闭默认信任:`PI_WEB_TRUST_DEFAULT_CWD=false`;额外受信根:`PI_WEB_TRUSTED_ROOTS`(路径分隔符分隔)。
  - 也可按请求显式放行:create-session 请求体传 `trust: true`(单次放行 + 写入信任库,跨会话记住)。
- **经 runner 直接启动**:`--trusted`,或环境变量 `PI_WEB_TRUST_PROJECT=1`。

## 运行

### A. 经 pi-web server
建会话时:`source = examples/pi-probe-agent`、`cwd = <仓库绝对路径>/examples/pi-probe-agent`、
`trust: true`。然后观察工具/命令/子代理是否出现(见上表)。

### B. 直接经 bootstrap runner(RPC 模式,适合自动化验证)
```bash
node packages/server/runner-bootstrap.mjs \
  --agent  examples/pi-probe-agent \
  --cwd    "$PWD/examples/pi-probe-agent" \
  --agent-dir <隔离的临时 agent 目录> \
  --trusted
# 向 stdin 写一行 {"id":"c1","type":"get_commands"},stdout 的响应里
# data.commands 应含 { name:"pi-probe", source:"extension" }。
```

> 自动化覆盖:`packages/server/test/runner/trust-pi-loading.e2e.test.ts` 用真启 runner 子进程
> 验证「带 `PI_WEB_TRUST_PROJECT=1` → `.pi/extensions` 命令出现;不带 → 不出现」。

## 说明

- 本示例**自包含**:`.pi/` 探针就在本目录下,与仓库根的 `.pi/`(若有)互不影响。
- examples 不是 workspace 包、被根 `tsconfig` 排除;`index.ts` / `.pi/*.ts` 在 IDE 里对
  `@blksails/agent-kit` / `@earendil-works/*` / `typebox` 的 "Cannot find module" 属预期编辑器噪音——
  运行时由 runner 的 jiti alias / SDK 扩展加载器解析(已实测可加载),不影响 CI/构建/运行。
