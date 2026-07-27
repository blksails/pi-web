# Requirements Document

## Project Description (Input)

**谁有问题**：已通过 pi-cloud 登录的 pi-web 桌面用户。

**现状**：上游 spec `desktop-hybrid-agent-sources`（P1，已 `implemented`）让登录用户**能在选择器里看见**线上 registry 的 agent，但 P1 的 Req 7 明确只承诺「能看见」、不承诺「能直接跑」——选中一个线上条目什么也不会发生。用户面对一个可选却不可用的选项；要真正用上云端分发的 agent，今天仍得离开界面手动跑 `pi-web install`。

同时，安装能力其实**已经存在但没被接上**：`server/cli/install/registry-install.ts` 的 `installFromRegistry` 已实现 resolve → 经 registry 代理下载（安装侧不接触 OSS 凭据）→ staging 解包 → sha384 逐项完整性复核 → 失败回滚 / 成功原子移入 → 写回执 `.pi-web-registry.json`；`HttpRegistryAdapter` 需要的 `baseUrl + consumeToken`，正是 P1 的 `DesktopCapabilitiesClient` 已经在产出的授予。缺的只是把「线上条目被选中」接到这条链上。

**该改成什么**：桌面已登录用户选中线上源后，系统在**同一次建会话请求内**完成安装并进入会话；安装落点为 P1 的默认扫描根 `~/.pi-web/agents`，使其装完即成为一个**普通的本地扫描源** —— 重启、离线、建会话、resolver 全部复用既有本地目录源通路，不为云端源新造运行时概念。失败时返回可区分阶段的结构化错误，且不留下半成品目录。

**已知的两处硬骨头**（须在设计阶段拍板，不得随手发明）：

1. **装后列表会出现重复条目**。线上条目 `id` = sourceId（`registry-http-provider.ts:82`），装完后的扫描条目 `id` = 绝对路径，而 composite 按 `r.id` 去重（`composite-provider.ts:56`）—— 两者 id 不同则去重命不中，**同一个 agent 必然在列表里出现两条**。原料已在：回执里记着 `sourceId`。
2. **依赖方向铁律**。`installFromRegistry` 与 `HttpRegistryAdapter` 位于 `server/cli/**` 且 import `@pi-clouds/registry-client`，而 P1 明令该依赖**不得进入 `packages/server/src`**。`lib/app/pi-handler.ts` 与 `server/cli/**` 同属根应用层，跨层调用可能本就不违规，但必须在设计阶段定死接线位置与依赖方向。

## Introduction

本特性补上 P1 留下的最后一段：把「在列表里看得见的线上 agent」变成「选中就能用的 agent」。

核心策略是**不为云端源新造运行时概念** —— 选中线上源时先把它安装到本机 agent 源根，装完之后它就是一个普通的本地目录源，建会话、重启、离线全部复用既有通路。安装在建会话请求内同步完成，成功即进会话，失败返回可区分阶段的结构化错误且不留残迹。

本特性只做「装 + 能跑」。更新、卸载、版本切换与完整的安装进度前端形态留给后续特性。

## Boundary Context

- **In scope**：以线上源标识发起建会话时的安装编排；安装成功后的会话创建；装后列表的条目归一（不出现重复）；分阶段可诊断的失败态与残迹清理；未登录 / 授予不可得 / 分发形态不受支持 / 标识不存在等拒绝路径；安装产物的持久化与离线可用。
- **Out of scope**：更新、卸载、版本切换、已装版本展示；安装进度条、重试交互、「可运行 / 需安装」徽标、版本选择器等前端形态；plugin 类源（延续 P1，在列表侧即被排除）；经直连（非注册表分发）形态的来源安装；注册表服务端与云端能力端点自身的任何改动。
- **Adjacent expectations**：本特性依赖 P1 已交付的桌面登录态与短期能力授予链路（`desktop-hybrid-agent-sources`、`desktop-cloud-login`）；依赖既有的注册表安装实现与其完整性/原子落盘语义（`cli-package-commands`）；依赖既有的本地目录源解析与建会话通路（`agent-source-resolver`）。本特性**不拥有**上述任何一方的内部行为，仅编排它们；若它们的对外语义变更，本特性需重新验证。

## Requirements

### Requirement 1: 选中线上源即可进入会话

**Objective:** 作为已登录的桌面用户，我想选中一个线上 agent 后直接开始对话，以便不必离开界面手动安装。

#### Acceptance Criteria

1. While 处于有效桌面登录态, when 用户以线上源标识（`sourceId@channel` 形态）发起创建会话, the 系统 shall 先完成该源在本机的安装，再按本地目录源的既有方式创建会话。
2. When 安装成功, the 系统 shall 在同一次创建会话请求内返回可用会话，不要求用户再次发起。
3. When 用户选中的线上源在本机已存在满足复用条件的安装, the 系统 shall 直接创建会话而不重复下载。
4. When 安装完成, the 系统 shall 使该源在后续的源列表请求中作为本机源出现。

### Requirement 2: 安装产物持久且离线可用

**Objective:** 作为桌面用户，我想装过一次的 agent 之后随时能用，以便断网或登出时工作不中断。

#### Acceptance Criteria

1. The 系统 shall 将安装产物持久保存在本机 agent 源根目录下，使其在应用重启后仍可用。
2. While 网络不可达或用户已登出, when 用户选中此前已安装的源, the 系统 shall 正常创建会话。
3. While 用户已登出, the 系统 shall 仍在源列表中呈现此前已安装的源（其可见性不再依赖登录态）。

### Requirement 3: 装后列表不出现重复条目

**Objective:** 作为桌面用户，我想一个 agent 在列表里始终只出现一次，以便不必分辨哪一条是"线上的"、哪一条是"装好的"。

#### Acceptance Criteria

1. When 一个线上源已安装到本机, the 系统 shall 在源列表中对该源仅呈现一个条目，不得线上与本机各出现一条。
2. When 同一个源既可从线上枚举到又已在本机安装, the 系统 shall 保持该条目的可提交标识稳定，使调用方无需分辨来源即可创建会话。
3. The 系统 shall 不因本特性改变既有的列表排序与分页语义。

### Requirement 4: 失败可诊断且不留残迹

**Objective:** 作为桌面用户与运维方，我想安装失败时知道卡在哪一步且本机不被弄脏，以便重试或求助。

#### Acceptance Criteria

1. If 安装在解析、下载、解包、完整性校验或落盘任一阶段失败, then the 系统 shall 返回可区分失败阶段的结构化错误。
2. If 安装失败, then the 系统 shall 不在目标位置留下部分写入的源目录。
3. If 安装失败且目标位置此前已有可用安装, then the 系统 shall 保持该已有安装不被破坏。
4. If 安装失败, then the 系统 shall 不创建会话。
5. The 系统 shall 不在任何错误信息、响应体或日志中包含桌面凭据或能力授予令牌。

### Requirement 5: 授权前置与降级

**Objective:** 作为安全与运维方，我想安装链路不扩大凭据面且在缺乏授权时明确拒绝，以便与桌面登录安全不变式一致。

#### Acceptance Criteria

1. While 未登录或桌面凭据已失效, when 用户以线上源标识发起创建会话, the 系统 shall 拒绝该请求并说明需要登录，且不发起任何下载。
2. If 能力授予不可得（端点不可达、被拒绝或响应缺少授予）, then the 系统 shall 使该次安装明确失败，并保持本机既有源不受影响。
3. The 系统 shall 仅使用短期能力授予访问注册表，不要求用户另行配置长期令牌作为默认路径。
4. The 系统 shall 不将能力授予令牌写入任何配置文件、会话历史或磁盘产物。

### Requirement 6: 支持范围与明确拒绝

**Objective:** 作为桌面用户，我想遇到本特性支持不了的源时立刻得到明确答复，以便不必猜测为何没反应。

#### Acceptance Criteria

1. If 目标源的分发形态不属于本特性支持的注册表分发形态, then the 系统 shall 明确拒绝并说明不支持，且不进行部分安装。
2. If 目标源标识在注册表中不存在，或其指定通道没有可用版本, then the 系统 shall 返回可与其他失败区分的"未找到"结果。
3. The 系统 shall 不将 plugin 类源作为会话 agent 安装。

### Requirement 7: 内容可信与来源可追溯

**Objective:** 作为安全方与后续维护者，我想装到本机的内容经过校验且知道它从哪来，以便信任它并支持将来的更新与卸载。

#### Acceptance Criteria

1. When 安装内容落盘前, the 系统 shall 校验其内容完整性，校验不通过时使本次安装失败。
2. The 系统 shall 随安装记录该源的来源标识与实际安装的版本，使后续的更新与卸载能力能够识别该安装。
3. The 系统 shall 使本机在整个安装过程中不接触对象存储凭据。

### Requirement 8: 既有行为不回归

**Objective:** 作为现有用户，我想本特性不改变我今天已经在用的东西，以便升级无感。

#### Acceptance Criteria

1. The 系统 shall 保持本地目录源（扫描得到的与本地登记的）的创建会话行为与本特性引入前一致。
2. While 未启用云登录或未配置能力端点, the 系统 shall 保持源列表与创建会话行为与本特性引入前一致。
3. The 系统 shall 保持既有源列表协议的字段与分页游标语义不变。
