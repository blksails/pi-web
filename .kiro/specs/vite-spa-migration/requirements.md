# Requirements Document

## Introduction

把 pi-web 从 Next.js 迁移到 Vite + 轻量客户端路由（SPA）+ 标准 Node HTTP 宿主 + esbuild 打包。

Next.js 在本项目里只扮演「打包器 + 静态资源服务器 + 一个 fetch 入口」：全仓对 `next` 的直接
import 仅 4 处，`app/api/**` 下 11 个路由文件全是把标准 Web `Request` 转交
`createPiWebHandler()` 的薄转发器，两个 server component 都标了 `force-dynamic` 且只做
「读 config → 传 props」。代价却是 RSC 边界、Edge runtime 约束，以及 `scripts/pack-standalone.mjs`
（563 行）为修补 nft 拍平 pnpm 依赖树而写的一整套变通。

本迁移的目标是让前端退化为纯 SPA、后端退化为普通 Node HTTP 服务，同时**分发模型对用户完全不变**：
`pi-web` 全局命令与 Electron 桌面壳仍然是「一个自包含目录 + 一个可 spawn 的 server 入口」。

### 已完成的实证（本 spec 的输入，非待办）

| 阶段 | commit | 结论 |
| --- | --- | --- |
| P0 | `8ff1e23` | Vite 生产构建 + 生产 CSP（禁 `unsafe-eval`）下能加载**真实** webext dist：单例 import map 生效、原生动态 import 被原样保留、产物 0 个 `new Function` / `eval(` / `__vitePreload`。含反证探针。 |
| P1 | `5e81fc8` | Hono server（一条 `app.all` 取代 11 个转发器）+ `GET /api/bootstrap`。与 Next 逐字节 parity：29 帧一致，11/11 项绿，带反证探针。 |

## Boundary Context

- **In scope**：HTTP 宿主替换；运行时配置端点；SPA 前端与客户端路由（`/`、`/session/:id`、
  `/settings`）；webext 五层加载在新宿主下的完整性；esbuild 产物替换 Next standalone；
  CLI 与桌面壳入口切换；三套 e2e（browser / cli / desktop）与 node e2e 的迁移与全绿；
  移除 `next` 依赖。
- **Out of scope**：多租户认证（`middleware.ts`、`app/login/`、`lib/auth/`、Supabase）——
  这些当前**不在 `main` 上**，属未提交的 WIP。本 spec 只在服务端保留一个鉴权中间件接缝并写明其契约，
  不实现登录墙、不新增 `/login` 路由。`packages/*` 的任何行为变更。webext 五层模型、附件系统、
  AIGC 工具、状态桥等业务能力的重构。
- **Adjacent expectations**：`packages/server` 导出的 `createPiWebHandler` 必须保持
  `(Request) => Promise<Response>` 契约且 SSE 响应体可流式透传；`packages/react` 的
  `extension-loader` 必须保持其动态 `import()` 的 URL 经变量传入。本 spec 依赖这两点，但不修改它们。

## Requirements

### Requirement 1: HTTP 宿主等价替换

**Objective:** As a pi-web 维护者, I want 用一个不依赖 Next.js 的 Node HTTP 宿主承载全部 `/api/*` 请求, so that 框架层不再约束运行时能力，且业务行为零回归。

#### Acceptance Criteria

1. The pi-web 服务端 shall 将所有 `/api/*` 请求原样转交 `createPiWebHandler` 返回的处理器，不重写状态码、响应头或响应体。
2. When 处理器返回 SSE 响应, the pi-web 服务端 shall 以流式方式透传其响应体，不缓冲、不改写 `content-type`。
3. When 客户端对整会话路径 `/api/sessions/:id` 发起 DELETE 且处理器返回成功, the pi-web 服务端 shall 一并丢弃该会话的 `sessionId → source` 映射。
4. When DELETE 路径含额外路径段（子资源删除）, the pi-web 服务端 shall 不触发会话映射清理。
5. If 会话映射清理失败, then the pi-web 服务端 shall 保持处理器的原始响应不变。
6. While 多租户门控关闭（默认）, the pi-web 服务端的鉴权中间件接缝 shall 表现得与该中间件不存在完全一致。
7. The pi-web 服务端 shall 在 Node runtime 下运行，使中间件可直接使用会派生子进程或访问文件系统的模块。
8. When 收到 SIGTERM 或 SIGINT, the pi-web 服务端 shall 关闭监听并优雅停止所有会话。

### Requirement 2: 运行时配置端点

**Objective:** As a pi-web 的 CLI 或自托管使用者, I want 前端配置在服务启动时读取而非构建时固化, so that 我设置的环境变量能真正生效，而不必为改一个开关重新构建前端。

#### Acceptance Criteria

1. The pi-web 服务端 shall 提供一个配置端点，返回默认 agent 源、默认模型、默认工作目录、自动启动标志，以及当前所有前端功能门控的取值。
2. When 服务端进程启动时环境变量指定了某个前端功能门控, the 配置端点 shall 在该次运行中反映该取值，无需重新构建前端产物。
3. The 配置端点 shall 永不返回任何 provider 密钥。
4. When 配置读取抛出异常（例如缺少 provider 密钥）, the 配置端点 shall 仍返回可用的默认值，使前端渲染选源页，且 shall 不泄漏底层错误信息。
5. When 请求携带会话标识, the 配置端点 shall 返回该会话持久化的 agent 源；查找顺序为先会话映射、后持久化会话元数据。
6. If 会话源无法恢复, then the 配置端点 shall 省略该字段而非报错，使会话仍能按标识恢复。

### Requirement 3: SPA 前端与客户端路由

**Objective:** As a pi-web 用户, I want 页面在没有服务端渲染的情况下行为不变, so that 我的深链、刷新与会话恢复体验与迁移前完全一致。

#### Acceptance Criteria

1. The pi-web SPA shall 提供三条路由：根路径（新会话）、会话详情路径（携带会话标识）、设置路径。
2. When 用户直接访问会话详情路径（深链或刷新）, the pi-web SPA shall 恢复该会话的历史并可继续对话。
3. While 会话详情路径被冷加载, the pi-web SPA shall 取得该会话持久化的 agent 源，使其 web 扩展表面在刷新后仍然渲染。
4. When 服务端收到任何非 `/api/*` 且不匹配静态资源的路径请求, the pi-web 服务端 shall 返回 SPA 入口文档，使客户端路由接管。
5. While 运行时配置尚未到达, the pi-web SPA shall 呈现明确的加载态，且 shall 不以缺省值渲染出会误导用户的界面。
6. The pi-web SPA shall 保留主题切换与语言切换控件的既有行为与其 e2e 锚点属性。
7. The pi-web SPA shall 保留设置页的配置面板装配行为，包括仅在检测到相应扩展时才登记的条件面板。

### Requirement 4: Web 扩展加载完整性

**Objective:** As 一个 pi agent 的作者, I want 我的 `.pi/web` 扩展在新宿主下以完全相同的方式被加载, so that 迁移对我的扩展是透明的。

#### Acceptance Criteria

1. The pi-web SPA 入口文档 shall 在任何模块加载之前提供单例映射表，把扩展使用的裸模块名解析到宿主单例端点。
2. The pi-web 服务端 shall 提供单例端点，其返回的模块从宿主运行时注入的全局对象再导出，使扩展与宿主共享同一 React 实例。
3. When 扩展代码被动态加载, the pi-web SPA shall 使用浏览器原生的运行时 import，且构建产物 shall 不包含任何需要 `unsafe-eval` 的求值构造。
4. While 生产内容安全策略生效（禁止 `unsafe-eval`）, the pi-web SPA shall 能完整加载代码扩展并渲染其贡献的渲染器。
5. The pi-web 服务端 shall 继续托管 Tier4 隔离表面所需的静态文档，使其在既有门控开启时可经 iframe 加载。
6. Where Tier4 隔离表面的基址门控未开启, the pi-web SPA shall 不挂载该 iframe（保持既有门控语义）。
7. The 迁移 shall 不修改 `packages/react` 中的扩展加载器源码。

### Requirement 5: 自包含产物与分发

**Objective:** As pi-web 的安装用户, I want `pi-web` 命令与桌面应用在迁移后照常工作, so that 我不必关心底层构建工具的更换。

#### Acceptance Criteria

1. The pi-web 构建流程 shall 产出一个自包含目录，其中含一个可直接由 Node 执行的服务端入口与全部前端静态资源。
2. The pi-web 构建流程 shall 把 agent 子进程在运行时动态加载的依赖（pi SDK、运行时加载器、runner 引导脚本）按其**原始目录结构**纳入产物，不拍平符号链接、不重排依赖树。
3. When 产物被整体移动到另一个绝对路径后执行, the pi-web 服务端 shall 正常启动并能创建真实会话，不出现模块解析失败。
4. While 运行在 Windows 上, the pi-web 服务端 shall 正常解析产物内的路径，不因符号链接或路径大小写而失败。
5. When 用户执行 `pi-web` 命令, the pi-web CLI shall 拉起新的服务端入口，且其既有命令行参数、环境变量翻译与就绪探测行为 shall 保持不变。
6. When 桌面壳启动, the pi-web 桌面壳 shall 从随包资源目录定位并拉起同一服务端入口；在未打包态 shall 沿用既有的入口覆盖环境变量。
7. While 桌面壳运行在没有独立 Node 的机器上, the pi-web 桌面壳 shall 继续以 Electron 充当 Node 的方式派生服务端进程。

### Requirement 6: 验证与防假绿

**Objective:** As pi-web 维护者, I want 每一处「通过」都建立在能证明自己会失败的检查之上, so that 迁移不会因为「一致地什么都没发生」而被误判为成功。

#### Acceptance Criteria

1. The 迁移 shall 使既有浏览器 e2e 套件在新宿主与新产物下全部通过，且 shall 不削弱任何一条既有断言。
2. The 迁移 shall 使既有 node e2e、CLI e2e（含真实会话与可重定位守卫）与桌面 e2e 全部通过。
3. When 任一对等性或端到端检查报告通过, the 检查本身 shall 已被证明在注入已知缺陷时会报告失败。
4. If 一次检查在被测流程未真正执行时仍报告通过, then 该检查 shall 被视为无效，且 shall 补充前置有效性断言后重跑。
5. The 迁移 shall 在删除 Next.js 之前，以对等性证据证明新宿主与旧宿主在会话创建、消息发送、SSE 帧序列、配置读取与会话删除上的行为一致。
6. The 迁移 shall 保持双持久化后端（文件与 SQLite）各自的会话持久化 e2e 覆盖不变。

### Requirement 7: 依赖收敛与清理

**Objective:** As pi-web 维护者, I want 迁移完成后仓库里不再残留 Next.js 的任何痕迹, so that 新贡献者不会被两套并存的宿主机制误导。

#### Acceptance Criteria

1. When 迁移完成, the pi-web 仓库 shall 不再声明或传递依赖 `next` 包。
2. The 迁移 shall 删除 Next 专属的配置文件、路由目录、中间件文件，以及为修补其依赖追踪而存在的打包脚本。
3. The 迁移 shall 更新所有涉及构建、启动、测试的脚本，使其不再调用 Next 命令。
4. While 迁移分阶段进行, the 新旧宿主 shall 可在不同端口并存，使每一阶段都能独立验证并可回滚。
5. The 迁移 shall 使前端构建产物不再需要为内联脚本放宽内容安全策略（即可移除因框架注入而必需的 `'unsafe-inline'` 脚本源）。
