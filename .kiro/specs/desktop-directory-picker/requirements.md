# Requirements Document

## Introduction
本规格为 pi-web 桌面版(Electron 薄壳)补齐 **M2 能力之一:原生目录选择桥**。桌面用户当前只能在 `AgentSourcePicker` 里**手输**本地目录路径作为 agent source;本特性让用户经系统原生「选择文件夹」对话框浏览挑选目录,选中后把绝对路径**填入**来源输入框(不自动提交),再由用户确认建会话。

能力**仅在 Electron 桌面壳内**提供:渲染层经受控 preload 桥调用,主进程弹出原生对话框。浏览器部署(`pnpm dev` / standalone / 生产)不得受任何影响,且**不新增任何可枚举本地目录的服务端路由**——目录浏览完全经桌面本地对话框完成,选中即等价于操作系统级用户授权。全程维持 Electron 严格隔离(`contextIsolation` / `sandbox` / `nodeIntegration:false`)。

本特性对应 `pi-web-desktop` 规格 requirements 中列为「Out of scope(顺延 M2)」的「原生目录选择器选 agent source」,并复用其 preload 桥预留的扩展点(Req 5.3)。

## Boundary Context
- **In scope**:桌面壳内的原生「选择文件夹」对话框触发与结果回填;preload 桥新增一个受控的目录选择方法;`AgentSourcePicker` 在桌面壳内多出「浏览文件夹」入口;桌面/浏览器两态下的入口可见性门控;取消与失败的用户可见处理。
- **Out of scope**:选文件(非目录);Windows/Linux 打包分发;把选中目录持久化为最近项/收藏项;`.pi/` 项目信任提示与授权(维持既有 headless 默认);修改 agent source 的服务端解析与信任策略;任何面向浏览器的目录枚举/浏览 HTTP 端点。
- **Adjacent expectations**:本特性只产出一个 source 路径字符串交由既有 `AgentSourcePicker` → `create-session` 流程处理,不改变服务端对 source 的解析、校验与信任裁定;依赖桌面壳既有的 `piWebDesktop` preload 桥与主窗口引用作为宿主。

## Requirements

### Requirement 1: 桌面壳内提供「浏览文件夹」入口
**Objective:** 作为桌面版用户,我想在选择 agent source 时有一个「浏览文件夹」入口,以便不必手动键入本地目录路径。

#### Acceptance Criteria
1. While 应用运行于 Electron 桌面壳内, the AgentSourcePicker shall 在来源输入框旁展示一个「浏览文件夹」入口。
2. While 应用运行于普通浏览器(非桌面壳), the AgentSourcePicker shall 不展示该入口,且现有手输与源列表行为保持不变。
3. When 桌面壳未注入目录选择能力时, the AgentSourcePicker shall 不展示该入口(与门控未开启等价)。
4. When 用户触发该入口, the AgentSourcePicker shall 请求宿主打开系统原生「选择文件夹」对话框。

### Requirement 2: 原生目录对话框与结果回填
**Objective:** 作为桌面版用户,我想在原生对话框里选中一个文件夹后路径被自动填入来源框,以便复核后再决定是否建会话。

#### Acceptance Criteria
1. When 目录选择被触发, the 桌面壳主进程 shall 弹出以主窗口为父窗体的系统原生「选择文件夹」对话框,且仅允许选择目录。
2. When 用户在对话框中确认选定一个目录, the 桌面壳 shall 将该目录的绝对路径返回给渲染层。
3. When 渲染层收到返回的目录路径, the AgentSourcePicker shall 把该路径填入来源输入框且**不自动提交**会话。
4. When 路径已填入来源输入框后用户触发提交, the AgentSourcePicker shall 以该路径作为 source 走既有的建会话流程(与手输等价字符串提交完全一致)。
5. If 用户在对话框中取消或未选择任何目录, then the AgentSourcePicker shall 保持来源输入框原值不变且不建会话、不显示错误。

### Requirement 3: preload 桥的受控最小暴露与隔离不回归
**Objective:** 作为平台维护者,我想目录选择能力经最小受控的 preload 桥暴露,以便不削弱桌面壳的安全隔离基线。

#### Acceptance Criteria
1. The 桌面壳 shall 仅经 contextBridge 暴露一个用于目录选择的受控方法,不授予渲染层任何通用文件系统访问或 Node 集成能力。
2. The 桌面壳窗口 shall 维持 `contextIsolation: true`、`sandbox: true`、`nodeIntegration: false`。
3. When 渲染层调用目录选择方法, the 桌面壳 shall 仅返回被选中目录的路径字符串(或取消时的空结果),不返回目录内容、文件列表或其它文件系统元数据。
4. The 桌面壳 shall 保留既有 `piWebDesktop` 桥上的只读标识与平台字段,新增能力为向后兼容的追加。

### Requirement 4: 浏览器部署零影响与无服务端目录枚举
**Objective:** 作为平台维护者,我想目录浏览严格限定在桌面本地对话框内,以便浏览器部署不暴露任何本地文件系统浏览面。

#### Acceptance Criteria
1. The 本特性 shall 不新增任何用于枚举、浏览或列出本地目录/文件的服务端 HTTP 路由。
2. While 应用运行于普通浏览器, the AgentSourcePicker shall 不呈现任何目录浏览入口,亦不具备触达本地文件系统的路径。
3. The 目录浏览能力 shall 完全经桌面壳本地的系统原生对话框完成,选中目录即视为操作系统级的用户授权。
4. The 服务端对 source 的解析、校验与项目信任裁定 shall 与本特性引入前保持一致,不因本特性放宽。

### Requirement 5: 失败与异常的可见处理
**Objective:** 作为桌面版用户,我想在目录选择出现异常时得到明确反馈,以便不陷入无响应或误建会话。

#### Acceptance Criteria
1. If 打开原生对话框或获取选择结果的过程失败, then the AgentSourcePicker shall 不建会话、不改变来源输入框原值,并保持手输与源列表入口可继续使用。
2. While 目录选择正在进行, the AgentSourcePicker shall 保证用户仍可改用手输或源列表提交,不因等待对话框而永久阻塞交互。
