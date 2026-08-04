# Requirements Document

## Introduction

桌面版（Tauri 壳）没有面向用户的运行配置入口：所有功能门控只能经环境变量传入，而从 Finder /
`open` 启动的 GUI 应用既不继承 shell 环境、也不读仓库里的 `.env.local`。结果是桌面版**恒定
运行在「全部增强功能关闭」的形态**，用户没有合法手段改变它。开发者用 `pnpm dev:desktop`
时一切正常（该脚本会加载 `.env.local`），所以这个缺口在开发中完全不可见。

真机实测（`/Applications/pi-web.app`，从 dmg 安装）：桌面版 `/api/bootstrap` 下发
`sourcePicker=false`（同机 dev 为 `true`）；`/api/webext/resolve` 对本地 agent 返回
`found:true` 但 `rejectedReason:"代码 webext 未签名"`。**agent 本体装载是正常的** ——
同一会话 `/commands` 返回 13 条命令、runner 进程在跑；失败的只是它的 UI 扩展，
而用户看到的现象是「界面上什么都没有」，极易误判为「agent 载入失败」。

本特性给桌面版建立自己的运行配置来源：一组仅在桌面形态生效的默认值，加上一个用户可改的
配置入口；同时把本地 agent 的 UI 扩展纳入可用范围，且不放松 Web 部署形态的任何安全约束。

## Boundary Context

- **In scope**
  - 桌面形态下功能门控的**默认取值**，以及取值的优先级次序。
  - 用户可改写这些取值的**本机配置入口**（不需要环境变量、不需要改仓库文件）。
  - 本地 agent 的 UI 扩展在桌面形态下的可用性。
  - 桌面形态下 agent source 扫描根的可配置性。

- **Out of scope**
  - **Web（非桌面）部署形态的任何默认值**：签名强制、门控默认关闭一律保持原样。
  - `desktop-hybrid-agent-sources` 已交付的「登录后合并线上源」链路与去重优先级。
  - 云端契约：本特性的配置是纯本机的，不新增任何云端交互。
  - agent 本体的装载链路（已验证正常，不在改动范围）。
  - webext 的 SRI 校验、完整性校验：只涉及**签名**这一道门，其余校验不动。

- **Adjacent expectations**
  - 依赖桌面壳已有的「我是桌面壳」自述标记（现由壳在拉起后端时写入），本特性不新造识别机制。
  - 依赖既有的「随包固化默认值」优先级约定（env 显式值 > 用户配置 > 固化默认），沿用不另立。

## Requirements

### Requirement 1: 桌面形态的功能默认值

**Objective:** As a 桌面版用户, I want 装完即可用到选源列表等基本能力, so that 我不必接触环境变量或仓库文件就能正常使用产品

#### Acceptance Criteria

1. While 运行在桌面形态, when 用户未做任何配置, the 系统 shall 启用 agent source 选择器。
2. While 运行在桌面形态, when 用户未做任何配置, the 系统 shall 允许载入本地 agent 的 UI 扩展（不因缺少签名而拒绝）。
3. The 系统 shall 仅在桌面形态应用上述默认值；其他宿主形态（浏览器 dev、npm CLI）的取值与本特性引入前**逐字段一致**。
4. If 环境变量显式给出了某项取值，the 系统 shall 以环境变量为准，桌面默认值不得覆盖它。
5. The 系统 shall 使桌面默认值处于**最低优先级**：环境变量 > 用户配置 > 桌面默认值。

### Requirement 2: 本地 UI 扩展的签名放行有明确边界

**Objective:** As a 维护者, I want 放行只覆盖用户显式指定的本机来源, so that 「让本地 agent 可用」不会变成「任何来源都不验签」

#### Acceptance Criteria

1. When agent 来源是用户显式指定的本机文件系统路径，且运行在桌面形态，the 系统 shall 不因缺少签名而拒绝其 UI 扩展。
2. If agent 来源不是本机文件系统路径（如经 registry 装取的包），the 系统 shall 保持既有的签名要求，不受本特性影响。
3. While 运行在非桌面形态，the 系统 shall 保持既有的签名要求，不论来源是否为本机路径。
4. The 系统 shall 在放行时留下可观测记录，使运维能够判断某次载入是否走了放行路径。
5. The 系统 shall 不改变 SRI 与完整性校验行为；放行只作用于签名这一道门。

### Requirement 3: 用户可改写的本机配置入口

**Objective:** As a 桌面版用户, I want 能改这些开关而不必碰环境变量, so that 我可以按自己的需要开关功能、指定 agent 存放位置

#### Acceptance Criteria

1. When 用户在本机配置中给出某项取值，the 系统 shall 以该取值覆盖桌面默认值。
2. When 本机配置文件不存在、为空或内容损坏，the 系统 shall 退回桌面默认值并保持可用，不得使启动失败。
3. When 用户修改配置并重启应用，the 系统 shall 使新取值生效。
4. The 系统 shall 允许用户配置 agent source 的本机扫描根，覆盖默认扫描位置。
5. If 配置中出现系统不认识的键，the 系统 shall 忽略它并继续，不得因此拒绝整份配置。

### Requirement 4: Web 形态与既有行为不得回退

**Objective:** As a 维护者, I want 这次改动不以放松 Web 侧安全为代价, so that 桌面便利性不会外溢成部署风险

#### Acceptance Criteria

1. While 运行在非桌面形态，the 系统 shall 保持 UI 扩展签名强制为默认开启。
2. While 运行在非桌面形态，the 系统 shall 保持各功能门控默认关闭，与本特性引入前一致。
3. The 系统 shall 不改变 `desktop-hybrid-agent-sources` 已定义的线上/本地源合并与去重优先级。
4. When 桌面用户已登录，the 系统 shall 保持线上源合并行为不变，本特性只影响本机贡献部分。
5. The 系统 shall 不引入任何新的云端请求。

### Requirement 5: 修复必须以「打包产物」为准验证

**Objective:** As a 维护者, I want 验收证据来自真实打包产物, so that 不会重蹈「开发路径恰好绕开、缺口长期不可见」的覆辙

#### Acceptance Criteria

1. The 验收证据 shall 包含在**真实打包产物**上的观测，而非仅开发模式下的结果。
2. The 验收证据 shall 证明桌面版下发的功能取值与预期一致（可经其运行时接口观测）。
3. The 验收证据 shall 证明本地 agent 的 UI 扩展在桌面产物中确实可载入。
4. If 某项行为只在开发模式下被验证，the 验收证据 shall 显式标注该局限，不得以开发模式结果充当打包形态的证明。
