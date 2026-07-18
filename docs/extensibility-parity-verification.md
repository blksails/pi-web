# 扩展性真机验证 · pi-cloud ↔ pi-web 行为等价

> 状态:**Phase A(无凭据取证)完成 · 2026-07-19**。Phase B(真机)待用户凭据 + 排在 baked-source 6.3 结论之后;Phase C 明确排除项已锁。
> 目标:确认 pi-cloud 云版会话中 agent-source 携带的扩展(skills / routes / surface extension / canvas / webext)与 pi-web 本机行为**等价**。
> 参考:`surface-extension-standard.md`(SES)、`agent-source-extensibility-module-design.md`(七面)、`surface-app-runtime-contract-v1.md`(SAR)。

## 0. 等价性的物理前提(先锁死)

pi-cloud 沙箱内与 pi-web 本机跑的是**同一个 `@blksails/pi-web-server` runner-bootstrap**;沙箱边界只是一条 **byte-for-byte 透明 JSONL 行代理**(`cloud-bridge-acs.cjs` 逐行原样回吐 + WS 转发 + `SandboxWsChannel`)。
→ runner 进程内的扩展面(①agent 行为 / ②pi 资源 / ③运行时通道 / ⑥routes)**天然等价**:它们在沙箱里跑的是同一二进制,帧经透明桥往返不改字节。浏览器面(④⑤webext dist)不过沙箱,经 registry 内容寻址跨界(baked-source 交付)。

## 1. 扩展面 A/B/C 态判定(以代码为准)

| 扩展面 | 态 | 云端加载途径 | 等价性判据 |
|---|---|---|---|
| ① Agent 行为(index.ts) | **A** 基线 | 沙箱内同一 runner-bootstrap;源经 registry 装入 workspace | 同源两端产出同一 AgentDefinition;baked-source 6.2 已 deep-diff parity |
| ② pi 资源(skills/extensions) | **A** | 同一 pi SDK loader;trust 经 `handler.ts requestTrust` 透传 | 装载与否两端一致;`--no-skills`/trust 门控语义一致 |
| ③④ Surface 管线(SES) | **A** ✅真机已验(cloud-canvas-webext 11.1) | 沙箱内 `wireSurfaceBridge`,`ui_rpc` 帧经透明桥 | 命令往返 ok / 快照 rev 收敛 / 退化契约 / 刷新重连粘性 |
| ④ canvas | **A** ✅真机已验(11.1) | 构建期车道①第一方烘入云 app bundle | 左 launcher+右画布(4:6)+ image_generation 富卡 + surface 闭环 |
| ⑤ webext(Web UI) | **A**(第一方/声明式)+ **B 缺口**(第三方 slots 组件型) | 运行时车道② `/api/webext/resolve` + declarative-only 门 + dist 经 registry 内容寻址 | manifest 解析 + SRI/签名 + 声明式挂载;**第三方 slots 云上暂不支持(MVP 缺口)** |
| ⑥ routes(agent-declared-routes) | **A** 透明继承(等价此前未独立锁,Phase A 已锁 in-process) | 同一 `createPiWebHandler` built-in `/sessions/:id/agent-routes` 转发到沙箱内 runner | 列举 + invoke 返回 handler 结果两端一致;真机往返并入主控 E2E 任务 |
| ⑦ settings(per-source 面板) | **C** 排除 | — | **上游 pi-web 未落地**(`AgentContext.settings` 等两仓零命中);主控已记 backlog,不阻塞上线 |

**面⑥ routes 门控实况**:env `PI_WEB_AGENT_ROUTES_DISABLED`(`agent-route-routes.ts:58 routesDisabled()`)仅在 `="1"` 时关,**默认开启**——云上无需额外开 env(此前规划的 env-gate 顾虑消解,为正面结论)。

## 2. Phase A 取证结果(无凭据 · 全离线实跑 2026-07-19)

**总计 24 文件 / 204 用例全 pass,0 fail,0 skip。**

| 面 | 仓/包 | 测试文件 | 用例 | 锁定的等价性 |
|---|---|---|---|---|
| ①②③④⑤ 云侧 | pi-clouds apps/cloud | handler-gate-on(5) · baked-source-e2e · dist-route · canvas-webext-route(9) · webext-host-shell(4) · resolve-extension(6) · chat-shell-canvas(3) · registry-source-resolver-plugin(12) | **53** | 真实 `createPiWebHandler` 管道装配 + trust 透传 + tenant 门控 + webext 声明式-only 拒绝 + dist 路径安全 + 全链 bake→resolve→dist 无 HTTP |
| ③ 透明通道 / ①② 沙箱 runner | pi-clouds packages/sandbox | agent-runner(12) · sandbox-ws-channel(4) | **16** | `ui_rpc` 行经 WS channel 往返无丢无改(seq/ring buffer);沙箱 argv 组装 = 同一 runner-bootstrap |
| ③④⑥ 真实子进程集成 | pi-web packages/server | surface-bridge.integration(2) · canvas-surface.integration(4) · surface-wiring · surface-command-dispatcher · agent-routes-subprocess(7) · agent-route-routes · agent-routes-wiring · pi-session-agent-routes | **70** | **SES-T2 MUST**:真实 runner 子进程 fd1 回流 + setState 下行;canvas hydrate/sync/register/A档 edit 端到端;routes 全闭环 + 并发独立配对 + built-in 转发 |
| ② skills/extensions/trust | pi-web packages/server | option-mapper(15) · project-trust · trust-pi-loading.e2e(3) · trust-landing(8) · project-trust-policy · mode-trust | **65** | 真实加载 `.pi/extensions`+`.pi/skills` 受 `PI_WEB_TRUST_PROJECT` 门控;flags override 语义 |

**证据映射逻辑**:pi-web server 侧真实子进程集成锁定「本机行为」;pi-cloud/sandbox 侧锁定「透明桥不改字节 + 云侧装配同管道」。二者相乘 = 沙箱内跑同一二进制、帧透明往返 ⇒ 面①②③⑥ 等价可由 in-process 证据充分推断,面④已叠加 11.1 真机。

## 3. Phase B(真机,待用户凭据)

排在 **baked-source 6.3 open defect(production-topology session-ready stall)** 结论之后(workspace:5 正在生产部署态诊断)。凭据(ACS/registry/OSS、已发布 source、bake job + Supabase migration `20260716120000` 手动 apply)统一由用户提供。

| 项 | 依赖 | own 归属 |
|---|---|---|
| ④ canvas surface 真机 | ACS + 发布 canvas agent + gate on | **已验**(cloud-canvas-webext 11.1)— 引用勿重复 |
| ① 装配 parity | ACS + baked source | **已验**(baked-source 6.2,deep-diff 0)— 引用勿重复 |
| ⑤ runtime webext 车道 live | registry HTTP base + bake env + migration | **owned by baked-source 6.2/6.3** — 勿重复 |
| ⑥ routes 真机往返 | ACS + 发布带 routes 的 source + gate 默认开 | **并入主控「发布→应用闭环 E2E」任务**(主控拍板①,不单独搭真机);论证:与 canvas surface 走同一透明通道,信任 11.1 已验 |

## 4. Phase C(明确排除)

- **面⑦ settings**:C 态,上游 pi-web 未落地。本任务排除;主控已另记 backlog,不阻塞上线。要做须先在 pi-web 立 spec(实现 `AgentContext.settings` 注入 + 面板登记 + `/config/source` 端点),再谈云端接线。
- **面⑤ 第三方 slots 型 webext**:B 态缺口。MVP 接受「云上暂不支持」(runtime 车道 declarative-only,带 slots 的第三方组件 webext 无法跨沙箱到浏览器;只有第一方 canvas 走 build-time bake 支持 slots)。补接线(第三方 slots dist 也走 registry + 宿主动态挂载)列入 backlog 后续决策。

## 5. 主控拍板记录(2026-07-19)

1. 面⑥ routes:本任务只 in-process 锁 + 「同一透明通道、信任 11.1 已验」论证;真机往返并入主控 E2E 任务。
2. 面⑦ settings:排除,写「上游未落地」,主控已记 backlog。
3. 面⑤ 第三方 slots:MVP 云上暂不支持,如实标注缺口,补接线 backlog。
4. 真机凭据统一由用户提供;Phase B 排在 baked-source 6.3 结论之后。
5. 批准 `agent-source-extensibility-module-design.md` 面⑥⑦ API 名过时/未落地更正注记(已写入)。

## 6. 陈旧文档警告

`agent-source-extensibility-module-design.md` 面⑥⑦ 的 pre-spec API 名(`defineRoutes`/`ext_http_request`/`ROUTES_NOT_DECLARED`/`registerSourceSettingsPanel`/`ext_settings_changed`/`AgentContext.settings`)**均为虚构未落地**;routes 真实走 `agent-declared-routes`。已在该文档开头加实况更正块(本任务 2026-07-19)。清单/后续 spec 一律以代码为准。
