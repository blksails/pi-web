# Requirements Document

## Introduction

本特性实现 **webext（5 层 web 扩展）扩展包的安装与浏览器侧动态加载生效**。

webext 安装与 pi 资源（extension/skill/prompt/theme）安装是两个不同问题：pi 资源在 node runner 里执行，落盘 + runner 重解析即可（已由 `extension-management` + pi `DefaultPackageManager` 覆盖）；webext 的代码要**在浏览器同源、与宿主共享 React/web-kit 单例**中执行，这是 webext 独有难点，也是本特性的核心。

webext 协议、SDK、构建工具、安全门、加载器 API 已由 `agent-web-extension`（24/24 实现）提供；本特性复用这些既有能力，把「运行时动态加载车道（import map）」接到生产宿主，并定稿其**信任模型**（完整性、签名、白名单治理、中心化可信发布者列表）。

落盘复用 `pi install`：webext 产物 `.pi/web/dist/` 随其所在 npm/git 包被装到 pi 包目录，本特性不重做安装器。

## Boundary Context

- **In scope**：
  - 已装包内 webext 产物的**发现、解析与浏览器侧加载生效**（Tier5 纯声明 + Tier1-4 代码两路）。
  - webext **信任模型**：完整性校验、发布者签名校验、白名单治理、中心化可信发布者列表。
  - 安装后**生效反馈**的双路覆盖（pi 资源 reload + webext 加载）的 webext 侧。
- **Out of scope**：
  - 安装器 / 落盘本身（复用 `pi install` / `extension-management`，不重做）。
  - `/plugin` 命令本体（属 `builtin-plugin-command`）。
  - marketplace / 扩展目录 / 发现推荐（Phase 2，明确排除）。
  - webext 协议契约、SDK、构建工具（`pi-web build`）、安全门与加载器核心算法（属 `agent-web-extension`，已实现，本特性复用）。
- **Adjacent expectations**：
  - 依赖 `agent-web-extension` 提供的 manifest 契约、加载器、安全门。
  - 依赖 `builtin-plugin-command` 提供 `/plugin install` 落盘触发与「装后生效反馈」挂点。
  - 依赖 pi `DefaultPackageManager` 将包（含 `.pi/web/dist/`）落到 pi 包目录。

## Requirements

### Requirement 1: webext 发现与解析

**Objective:** 作为运行 pi-web 的运营者，我希望系统能从已安装的包中自动发现并解析 webext，这样用户使用某个已装源时其 webext 能被识别，而无需中心目录或重新构建宿主。

#### Acceptance Criteria
1. When 一个会话使用某个已安装源，the webext 加载系统 shall 读取该源对应的 webext 清单（manifest）并据此确定其能力与加载方式。
2. If 已安装源不含 webext 清单，the webext 加载系统 shall 回退到宿主默认 UI 且不报错。
3. The webext 加载系统 shall 按源绑定解析 webext（源 → webext），不维护全局组件注册表，也不维护中心扩展目录。
4. If webext 清单无法解析或字段非法，the webext 加载系统 shall 拒绝加载该 webext、回退默认 UI 并记录可诊断原因。
5. While 宿主以 cold-resume 方式打开历史会话，the webext 加载系统 shall 依据该会话绑定的源重新解析并恢复其 webext。

### Requirement 2: Tier5 纯声明 webext 加载

**Objective:** 作为用户，我希望纯声明式（零代码）webext 安装后即时生效，这样主题、布局、空态等可见效果无需任何代码执行即可应用。

#### Acceptance Criteria
1. When 解析到的 webext 清单不含代码入口（纯声明），the webext 加载系统 shall 直接应用其声明式配置（如主题、布局、空态、文档标题），不加载任何代码 bundle。
2. While 加载纯声明 webext，the webext 加载系统 shall 不要求完整性摘要、不要求签名、不依赖动态代码执行能力。
3. When 纯声明 webext 已应用，the 宿主 shall 在当前会话呈现其声明式可见效果。
4. If 纯声明配置含未知或越界字段，the webext 加载系统 shall 忽略非法字段并应用其余合法配置，不整体失败。

### Requirement 3: Tier1-4 代码 webext 运行时加载

**Objective:** 作为用户，我希望带代码的 webext（插槽/渲染器/贡献点/制品）安装后能动态加载到正在运行的应用，这样无需重新部署宿主即可获得其 UI 能力。

#### Acceptance Criteria
1. When 解析到的 webext 清单含代码入口且通过安全门，the webext 加载系统 shall 在当前会话动态加载其代码并将其能力合并进宿主。
2. The webext 加载系统 shall 在加载代码 webext 前，保证其引用的宿主共享依赖（如 React 与 web-kit）解析到宿主的同一单例实例，不重复实例化。
3. When 代码 webext 已加载，the webext 加载系统 shall 以扩展标识命名空间化其贡献，避免与宿主或其他 webext 冲突。
4. If 代码 webext 的加载在浏览器运行环境（含内容安全策略）下无法执行代码，the webext 加载系统 shall 拒绝加载、回退默认 UI 并记录可诊断原因，而非使页面崩溃。
5. The webext 加载系统 shall 以会话级隔离应用代码 webext，使一个会话的 webext 不影响其他会话。

### Requirement 4: 完整性校验（浏览器侧）

**Objective:** 作为运营者，我希望浏览器加载的 webext 代码字节与发布者构建产物完全一致，这样传输或托管环节的篡改/替换会被拒绝。

#### Acceptance Criteria
1. When 浏览器获取代码 webext 的代码字节，the 宿主安全门 shall 校验字节与清单中已背书的完整性摘要一致后方可执行。
2. If 代码字节与已背书完整性摘要不一致，the 宿主安全门 shall 拒绝加载并记录原因。
3. The 完整性校验 shall 不依赖任何机密信息，可在浏览器侧安全执行。
4. If 代码 webext 缺少完整性摘要，the 宿主安全门 shall 拒绝加载该 webext。

### Requirement 5: 发布者签名校验（服务端侧）

**Objective:** 作为运营者，我希望只有可信发布者签名的 webext 代码能被加载，且验签机密绝不暴露给浏览器，这样浏览器同源代码执行的来源是可信的且签名不可被伪造。

#### Acceptance Criteria
1. When 加载代码 webext，the 系统 shall 校验其清单签名来自受信发布者后方可加载。
2. The 系统 shall 在服务端执行签名校验，使验签所需机密不下发到浏览器。
3. If 清单未签名或签名不属于受信发布者，the 系统 shall 拒绝加载并记录原因。
4. The 签名背书 shall 覆盖完整性摘要，使「可信发布者背书」与「确切代码字节」绑定为同一信任链。
5. While 处于生产模式，the 系统 shall 不得跳过代码 webext 的签名校验。

### Requirement 6: 白名单治理（运营者控制）

**Objective:** 作为运营者，我希望可信发布者白名单由部署方在服务端掌控，终端用户与扩展本身均无权变更，这样信任根不会被社工或自我背书绕过。

#### Acceptance Criteria
1. The 系统 shall 在服务端持有可信发布者白名单，作为加载代码 webext 的信任根。
2. If 终端用户或被加载的扩展尝试变更白名单，the 系统 shall 拒绝该变更。
3. Where 部署为多用户/托管形态，the 系统 shall 仅允许经授权的管理员变更白名单，并对每次变更记录审计。
4. When 白名单变更，the 系统 shall 在不向浏览器泄露任何验签机密的前提下使新信任生效。
5. The 系统 shall 默认信任 pi-web 第一方扩展的发布者，并要求第三方发布者由运营者显式加入后方可受信。

### Requirement 7: 中心化可信发布者列表（默认信任库）

**Objective:** 作为运营者，我希望可从一个中心地址获取并更新「可信发布者列表」作为默认信任基线，且该列表本身经过防伪验证，这样开箱即可信任一批经审定的发布者并支持更新与吊销，同时不被该地址或中间人劫持。

#### Acceptance Criteria
1. Where 启用中心化可信发布者列表，the 系统 shall 从配置的地址获取该列表作为默认信任基线。
2. When 获取到中心列表，the 系统 shall 使用随产品出厂、不可远程更改的根公钥验证该列表的签名后方可采信；If 验证失败，the 系统 shall 拒绝采信该列表。
3. The 中心列表 shall 仅登记受信发布者标识与公钥，不登记扩展条目，使其不构成扩展目录或 marketplace。
4. The 系统 shall 允许运营者在中心列表之上分层控制：固定到指定版本/快照、追加内部发布者、吊销条目、或整体停用中心列表；当运营者本地决策与中心列表冲突时，the 系统 shall 以运营者本地决策为准。
5. If 中心列表无法获取，the 系统 shall 回退到缓存或随产品出厂的快照，且 shall 不退化为信任所有来源（不得 fail-open）。
6. The 系统 shall 随产品提供可离线使用的出厂快照，使首次启动或断网时仍可工作。
7. Where 中心列表声明了有效期或吊销信息，the 系统 shall 据此使过期或被吊销的发布者不再受信。

### Requirement 8: 安装后生效反馈

**Objective:** 作为用户，我希望安装含 webext 的包后能立即看到其 UI 生效或得到明确反馈，这样不会出现「装了但界面没变」的困惑。

#### Acceptance Criteria
1. When 安装的包含 webext 产物，the 系统 shall 在安装完成后触发该 webext 的加载生效流程。
2. When 安装的包同时含 pi 资源与 webext，the 系统 shall 使 pi 资源的会话重载与 webext 的加载两路都发生。
3. If webext 加载失败，the 系统 shall 向用户呈现明确的失败反馈与原因，而非静默无变化。
4. While webext 正在加载，the 系统 shall 向用户呈现进行中状态，避免被误认为无响应。

### Requirement 9: 失败回退与可观测

**Objective:** 作为运营者，我希望任何 webext 校验或加载失败都安全回退且可诊断，这样单个坏 webext 不会破坏宿主，且失败原因可追查。

#### Acceptance Criteria
1. If 安全门校验（完整性/签名/版本兼容）未通过，the 系统 shall 拒绝加载该 webext 并回退到宿主默认 UI。
2. When 任一 webext 加载或校验失败，the 系统 shall 记录含失败原因与扩展标识的可诊断信息。
3. If 某个 webext 加载失败，the 系统 shall 不影响宿主其余功能与其他 webext 的正常加载。
4. When webext 因被拒或失败而未加载，the 系统 shall 使宿主保持可用且呈现确定性的默认体验。

### Requirement 10: 开发与生产模式门控

**Objective:** 作为扩展作者，我希望本地开发时可在显式开关下跳过签名以便迭代自写 webext，同时保证生产环境永不放松签名，这样开发便捷与生产安全互不牺牲。

#### Acceptance Criteria
1. Where 处于本地开发模式且运营者显式开启免签开关，the 系统 shall 允许加载未签名的代码 webext 以便本地迭代。
2. While 处于生产模式，the 系统 shall 强制要求代码 webext 的签名校验，且免签开关 shall 无效。
3. When 以免签模式加载 webext，the 系统 shall 给出明确的不安全提示，避免误用于生产。
4. The 系统 shall 默认要求签名（即默认不处于免签模式）。
