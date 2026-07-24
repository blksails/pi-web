# Requirements Document

## Introduction

pi-web 的内置扩展(sandbox enforcement、扩展管理、自动会话标题、MCP 客户端)当前经**主进程算好绝对路径 → spawn env 下发 → runner 加入 forcedExtensionPaths**的机制注入 agent 子进程。该机制隐含一个前提:**主进程与 runner 在同一文件系统**。本地传输成立;但 e2b 沙箱传输下 runner 跑在远程容器里,主进程算的宿主机绝对路径在容器内不存在,且这些 env 也不在沙箱的透传白名单内 —— 结果是**四个内置扩展在 e2b 沙箱下全部静默不可用**(无报错、仅能力缺失)。

同仓已有一个不受此问题影响的先例:sandbox enforcement 扩展的入口位于 `@blksails/pi-web-server` 包内,并用「从自身模块位置推算」的方式自解析;沙箱镜像标准安装了该包,故它在沙箱内**够得着**。真正够不着的是另外三个位于 `@blksails/pi-web-tool-kit` 的扩展,而 server 包的依赖树不含 tool-kit。

本特性把内置扩展的注入方式从「主进程下发绝对路径」改为「**runner 从自身安装树自解析**」,并让全部内置扩展的代码进入 runner 可解析的安装树,使内置扩展在**本地与 e2b 沙箱两种传输下行为一致**,并消除「每新增一个内置扩展就要在三处 spawn env 接线、漏一处即静默失效」这一反复出现的缺陷类别。

## Boundary Context

- **In scope**:内置扩展注入机制从「主进程下发路径」改为「runner 自解析」;让四个内置扩展的入口都能被 runner 从自身安装树解析;保持本地传输行为逐字节不变;使内置扩展在 e2b 沙箱传输下可用;各内置扩展既有的启用/门控语义(如自动标题总开关、MCP 条目启停)保持不变。
- **Out of scope**:不改各内置扩展自身的功能逻辑;不改 agent 调用工具或渲染的交互形态;不新增内置扩展;不改用户 agent 自身声明的扩展(`AgentDefinition.extensions`)的加载路径;不承担 e2b **base 镜像**在外部仓库的构建维护(本特性只保证「标准安装 server 即带上内置扩展代码」这一可打包前提成立,base 镜像是否据此重建由部署方决定)。
- **Adjacent expectations**:本特性依赖 e2b 沙箱镜像通过标准包安装获得 `@blksails/pi-web-server` 及其依赖;若某形态(本地 / standalone 产物 / 沙箱镜像)的安装树中缺失内置扩展代码,该形态下对应扩展**降级为不可用而非报错**,与既有降级方向一致。它**不拥有**镜像构建流程,只对「代码随包安装到位」负责。

## Requirements

### Requirement 1: runner 自解析内置扩展

**Objective:** 作为 pi-web 维护者,我想让 runner 从自身安装树解析内置扩展入口,以便内置扩展不再依赖主进程与 runner 处于同一文件系统。

#### Acceptance Criteria

1. When runner 装配会话, the runner shall 从自身模块位置解析内置扩展入口,得到在其运行环境中有效的路径。
2. The runner shall 不再依赖主进程经 spawn env 下发的内置扩展绝对路径来注入内置扩展。
3. Where 某个内置扩展的代码存在于 runner 的安装树中, the runner shall 将其纳入本次会话强制加载的扩展。
4. If 某个内置扩展的代码在 runner 的安装树中无法解析, then the runner shall 跳过该扩展并继续完成会话装配,不因此报错或中断会话。
5. The runner shall 保持内置扩展的加载顺序稳定且可预期。

### Requirement 2: 内置扩展代码进入可解析安装树

**Objective:** 作为 pi-web 维护者,我想让全部内置扩展的代码随 runner 所在的包一同安装,以便任何标准安装了 runner 的环境都能解析到它们。

#### Acceptance Criteria

1. The pi-web shall 使四个内置扩展(sandbox enforcement、扩展管理、自动会话标题、MCP 客户端)的入口在标准安装 runner 所在包后均可被解析。
2. Where 内置扩展代码位于独立子包中, the pi-web shall 通过该子包成为 runner 所在包的运行时依赖,使其随安装一并就位。
3. When 标准安装 runner 所在包, the resulting 安装树 shall 同时包含全部内置扩展的可执行入口。
4. The pi-web shall 不把仅前端使用的代码作为该运行时依赖引入,避免膨胀 runner 运行环境。

### Requirement 3: 本地传输行为不变

**Objective:** 作为 pi-web 本地用户,我想在本地开发与运行时内置扩展的行为与改造前完全一致,以便这次机制变更对我不可感知。

#### Acceptance Criteria

1. While 使用本地传输, the 内置扩展 shall 与改造前加载相同、行为相同(自动标题、扩展管理、sandbox enforcement、MCP 客户端均照常可用)。
2. When 内置扩展存在启用/门控开关(如自动标题总开关、MCP 条目启停), the pi-web shall 保持这些开关的既有语义不变。
3. The pi-web shall 保持既有 spawn 环境变量在过渡期内被识别或被安全忽略,不因移除下发而使本地启动报错。
4. While 运行既有本地测试套件, the 全部既有测试 shall 保持通过(改造不破坏既有行为)。

### Requirement 4: e2b 沙箱传输下内置扩展可用

**Objective:** 作为使用 e2b 沙箱传输的 pi-web 用户,我想让内置扩展在沙箱会话中和本地一样可用,以便沙箱形态不再缺失这些能力。

#### Acceptance Criteria

1. While 使用 e2b 沙箱传输且沙箱镜像包含内置扩展代码, the runner shall 在沙箱会话中加载内置扩展。
2. When 内置扩展在沙箱会话中加载成功, the 对应能力 shall 在该会话中可用(如 MCP 工具可被 agent 调用)。
3. If 沙箱镜像缺失某内置扩展的代码, then the runner shall 跳过该扩展并保持会话可用,不报错。
4. The pi-web shall 使沙箱形态与本地形态经**同一套自解析逻辑**注入内置扩展,不为沙箱另立一条注入路径。

### Requirement 5: 消除多处接线的静默失效风险

**Objective:** 作为 pi-web 维护者,我想让新增内置扩展不再需要在多处 spawn env 接线,以便杜绝「漏改一处即静默失效」的缺陷类别。

#### Acceptance Criteria

1. When 新增一个内置扩展, the 注入机制 shall 不要求在多处传输相关的环境变量下发点分别接线。
2. The pi-web shall 以单一来源枚举内置扩展入口,使新增扩展的接入点收敛为一处。
3. Where 某内置扩展在某形态下不可解析, the pi-web shall 使该情况对维护者可观测(如经日志),而非无声缺失。
