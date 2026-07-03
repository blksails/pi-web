# surface-demo-agent

Agent 权威 surface(agent-authoritative-surface)的**领域无关**最小示例——把「富交互 UI = agent 进程里某 `domain` 的瘦投影 + 命令发起端」这一 CQRS 范式落成一个 config。

## 它演示什么

- **agent 侧** `createSurface`(经 `extensions: [(pi) => createSurface(pi, …)]` 装载):
  - 持有以 `domain="demo"` 命名的**权威快照** `{ count, log }`(权威永在子进程);
  - 暴露两个命令 `increment` / `echo`;命令内经 `ctx.setState(reducer)` 改快照 → 经 state-injection-bridge 写入原语推 `control:"state"` 下行帧;
  - 注册探针命令 `surface:demo`(经 `pi.registerCommand`),使 `getCommands` 可见 → 前端 `available`。
- **UI 侧** `.pi/web` panelRight 面板:
  - 镜像快照渲染 count / log(经宿主注入的 `WebExtSurfaceAccess.getState/subscribe`,等价于 `useSurface("demo")`);
  - 点击 `increment(命令)` → `surface.run("demo","increment")` → **ui-rpc agent 转发**(payload 无 `name` → 逃逸 host 拦截 → 子进程 `wireSurfaceBridge` 派发)→ 快照回流镜像 → 计数更新。命令**不过 LLM**;
  - 退化:换成非该 domain 的 source(如 `hello-agent`)→ 探针缺失 → `available===false` → 只读、不报错。

## 关键点

- **宿主零领域语义**:count/log 纯计数/日志;宿主(`app/`、`packages/server`)把 `domain`/快照 `value`/命令 `payload` 一律当 `unknown` 搬运。
- **零 REST route、零 protocol 结构改**:下行复用 `control:"state"`(`key="surface:demo"`),上行复用 Tier3 ui-rpc(payload 细化 `SurfaceCommandPayload`)。

## 运行

```bash
pi-web ./examples/surface-demo-agent
```

model 省略 → 继承 `~/.pi/agent/settings.json` 默认 provider/model。命令交互不需要 provider 凭证(命令在子进程内确定性执行,不过 LLM);对话回复才用 LLM。
