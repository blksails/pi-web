# Requirements Document

## Project Description (Input)

给 `Installer` 端口接上 registry 通道，使 `/agent install <registry-id>` 与 `/plugin install <registry-id>` 能真正
安装 registry 上的包，并把 CLI 侧那条并行的 registry 分支一并收敛过来。

- **谁有问题**：pi-web（尤其桌面版）的用户。桌面版随包固化了云端地址，登录后 registry 源已经能在 source
  选择器里列出并选中运行，但在聊天框里 `/agent install acme/hello-cloud` 会失败。
- **现状**（实机探针证实）：host 命令走 `Installer.install()`，其 `resolveSource()` 把 registry 形态的标识
  直接判为 `REGISTRY_NOT_IMPLEMENTED`（`server/cli/install/source-resolver.ts:204`），卡片报
  "registry sources are not yet supported"。而同一份 registry 安装能力其实**已经存在两处**：
  - `server/cli/install/registry-install.ts` 的 `installFromRegistry()`——resolve → 代理下载 → 解包 →
    sha384 完整性复核 → 失败回滚 / 成功原子落盘 + 写安装回执；
  - `lib/app/online-source/registry-install-port.ts`——把桌面能力授予接到上面那份实现上的**编排层**
    （取授予 → 构造 adapter → 委托 → 归一失败分类 + 凭据卫生），`onlineSourceResolver` 已在用它。

  也就是说：选择器路径能装，命令路径不能装，差的只是把 `Installer` 接到已有端口上。
- **应当变成**：`/agent install <registry-id>` 与 source 选择器走**同一条**安装实现，装完的源同样被扫描
  枚举、同样写安装回执（因而可被 `pi-web update` 的 registry 通道跟踪）。

**已知约束**（勘察所得，非待议项）：
1. `@pi-clouds/registry-client` **不是 npm 依赖**，是经三处别名指向兄弟仓源码；它**不得进入
   `packages/server/src`**，且在应用层也只能**惰性**加载——静态引入会让 `pnpm dev:server`（jiti，无别名）
   启动即崩。
2. 授予来源因宿主而异：host 命令场景来自云端 capabilities（`sources` 授予），CLI 场景来自 env 配置。
   这一差异已由 `registry-install-port` 与 `buildRegistryFromEnv` 各自封装。
3. 安装回执 `.pi-web-registry.json` 是 `pi-web update` registry 通道判定"装的是什么、跟踪哪个 channel"
   的唯一依据，新通道必须沿用，不得另起格式。
4. **registry 支持 plugin**：发布清单必须显式写 `kind`（取值为 `PluginKind`）。注意一个已知陷阱——
   pi-web 侧 `pi-web.json#kind` 缺省 `plugin`，registry 侧 `SourceManifest.kind` 缺省 `agent`，**两侧相反**，
   任何判定都不得依赖缺省值。`registry-http-provider` 过滤 `kind:"plugin"` 是**列举面**的正确行为
   （plugin 不进会话 agent 选择器），不构成"registry 上没有 plugin"。
5. **现有 registry 安装实现对 kind 无感知**：`installFromRegistry` 不读 `kind`，只按调用方给的 `targetDir`
   落盘；当前唯一调用方假定装的是 agent 源。
6. plugin 的安装最终由 `pi install <source> --no-approve` 子进程接管（`PluginInstaller`），故 registry 装
   plugin 是「下载解包」+「交给 pi 接管该目录」的两段组合。

## Introduction

本特性给 `Installer` 端口补一条 registry 通道，使命令面的安装与选择器路径能力对齐。真实的下载、复核、
落盘、写回执一律复用既有实现，本 spec 只做**通道接入与治理对齐**：类别锁定、白名单语义、凭据脱敏、
生效分道与既有 direct 通道保持一致。

## Boundary Context

- **In scope**：`Installer` 的 registry 通道定义与按 kind 的分派；装配层把已有 registry 安装端口注入进去；
  registry 标识在 `/agent install` 与 `/plugin install` 下的成功与失败路径；CLI `pi-web install` 的既有
  registry 分支收敛到同一通道；用法文本与结果卡片的相应措辞；未配置 registry 时的诚实降级；
  相关单测与 e2e。
- **Out of scope**：
  - `installFromRegistry()` 的下载/解包/复核/回滚/落盘/回执实现——**一行不改**；
  - `registry-install-port` 的授予获取与失败归一——只消费，不改其接口；
  - registry 的发布侧（`pi-web publish`）与 registry 服务端；
  - `pi-web update` 的 registry 通道；
  - `PluginInstaller` 与 `pi install` 子进程的既有语义——registry 通道只把解包目录交给它，不改其行为；
  - source 选择器路径（`onlineSourceResolver`）的行为——它已经可用，本 spec 不改其语义；
  - registry 列举面对 `kind:"plugin"` 的过滤——那是 agent 选择器的正确行为，与安装通道正交。
- **Adjacent expectations**：
  - 装完的源落到扫描根，由既有 scan-provider 枚举，因而 `/agent list` 与选择器都能看到；
  - 现有 e2e 用例「registry 标识经 `/agent install` → REGISTRY_NOT_IMPLEMENTED」记录的是**当前边界**，
    本 spec 实现后必须改写为成功路径。

## Requirements

### Requirement 1: `/agent install <registry-id>` 经 registry 通道安装

**Objective:** As a pi-web 用户, I want 在聊天框里用 registry 标识安装 agent 源, so that 命令路径与选择器
路径能力一致，不必为了装一个线上源去点选择器。

#### Acceptance Criteria

1. When 用户提交 `/agent install <registry-id>` 且 registry 通道可用, the host 命令层 shall 经 registry 通道
   完成安装，而不是返回 `REGISTRY_NOT_IMPLEMENTED`。
2. The registry 通道 shall 复用既有的 registry 安装实现（resolve → 代理下载 → 解包 → 完整性复核 →
   失败回滚 / 成功原子落盘 → 写安装回执），不重造第二份下载或复核逻辑。
3. When registry 安装成功, the host 命令层 shall 产出与 agent 通道一致的成功结果：面板刷新效果、
   "在 source 选择器中切换即可使用"的指引，且不重载当前会话。
4. When registry 安装成功, the 安装落点 shall 位于既有扫描根之内，使新源立即被源枚举看到。
5. Where 目标源已按同一 channel 安装过, the registry 通道 shall 沿用既有实现的既定行为，不额外引入
   本 spec 自己的去重或跳过语义。

### Requirement 2: 形态与 kind 的判定一致

**Objective:** As a pi-web 维护者, I want registry 通道按**清单里的真实 kind** 分派, so that 不出现
"命令名说是 agent、实际装进 plugin 目录"这类错位。

#### Acceptance Criteria

1. The `Installer` shall 沿用既有的来源形态分类判定 registry 形态，不新增第二套判据。
2. The registry 通道 shall 以解析所得清单中的 `kind` 为该包类别的**权威判据**，不依赖 pi-web 侧或
   registry 侧的任一缺省值。
3. If 清单 `kind` 与命令锁定的类别不符, then the host 命令层 shall 拒绝安装，并在提示中指出应改用哪条
   命令（如 `/agent install` 收到 `kind: "plugin"` 的包 → 指向 `/plugin install`）。
4. If 清单 `kind` 为 `component`, then the host 命令层 shall 拒绝并给出组件安装器指引，与直连来源的
   component 拒绝路径一致。
5. If 一个标识既可解释为 registry 标识又可解释为直连来源, then the `Installer` shall 按既有分类规则裁断，
   本 spec 不改变该规则的任何取值。

### Requirement 3: 双 kind 的落点

**Objective:** As a pi-web 用户, I want registry 上的 agent 与 plugin 都能经命令安装且各自落到正确位置,
so that 装完就能用，而不是躺在一个错误的目录里。

#### Acceptance Criteria

1. When 清单 `kind` 为 `agent`, the registry 通道 shall 把包落到既有的 agent 源扫描根之内，使其立即被
   源枚举看到。
2. When 清单 `kind` 为 `plugin`, the registry 通道 shall 在完成下载与完整性复核后，把解包结果交由既有的
   plugin 安装路径接管，使其进入 pi 的包台账并可被 `/plugin list` 列出。
3. When plugin 经 registry 通道安装成功, the host 命令层 shall 按 plugin 通道的既定生效方式重载当前会话，
   与直连 plugin 安装一致。
4. The registry 通道 shall 对两种 kind 都写入安装回执，使 `pi-web update` 的 registry 通道能一致地跟踪。

### Requirement 4: CLI 收敛到同一通道

**Objective:** As a pi-web 维护者, I want `pi-web install` 与 host 命令走同一条 registry 实现, so that 不
维护两条会各自漂移的并行路径。

#### Acceptance Criteria

1. The CLI 的 `install` 子命令 shall 经 `Installer` 的 registry 通道完成 registry 安装，不再保留独立的
   registry 分支编排。
2. When CLI 经 registry 安装成功, the CLI shall 输出与此前等效的完成信息（源标识、版本、落点、复核文件数）。
3. The CLI 的既有直连安装路径（本地/npm/git）shall 行为不变。
4. Where CLI 与 host 命令的授予来源不同, the 各自装配层 shall 分别注入对应的授予获取方式，通道实现本身
   不感知宿主差异。

### Requirement 5: 未配置与失败时的诚实降级

**Objective:** As a pi-web 运维者, I want registry 不可用时得到可操作的说明, so that 用户不会把
"没登录"误当成"这个源不存在"。

#### Acceptance Criteria

1. If registry 通道未注入（如未登录、未配置云端）, then the host 命令层 shall 返回一条明确指出
   registry 不可用及其原因方向的失败结果，而不是沿用旧的 `REGISTRY_NOT_IMPLEMENTED` 措辞。
2. If 安装过程中解析、下载、解包或完整性复核失败, then the host 命令层 shall 如实转达该失败分类，
   并且不留下半安装状态。
3. The host 命令层 shall 不在任何输出面（结果卡片、审计事件、错误消息、日志）泄露授予令牌或
   下载地址中夹带的凭据。
4. While registry 通道不可用, when 用户经 source 选择器使用线上源, the 既有选择器路径 shall 行为不变。

### Requirement 6: 治理与既有 direct 通道对齐

**Objective:** As a pi-web 运维者, I want registry 通道不成为绕过治理的旁路, so that 命令面的安装入口
只有一套安全语义。

#### Acceptance Criteria

1. While 管理员校验未通过, when 用户提交 registry 标识的安装, the host 命令层 shall 拒绝执行并记录
   被拒审计事件，与直连来源的拒绝路径一致。
2. The registry 通道 shall 保持 registry 服务端已完成的验签为唯一签名信任来源，安装侧只做字节完整性
   复核，不重复验签、也不降低复核强度。
3. The registry 通道 shall 不因来源白名单面向直连来源（npm scope / git host / local）的规则而被误拒，
   也不因此获得绕过管理员门控的豁免。

### Requirement 7: 验证

**Objective:** As a pi-web 维护者, I want 这条通道有与选择器路径等强度的证据, so that "命令能装线上源"
不是只靠替身证明。

#### Acceptance Criteria

1. The pi-web 测试套件 shall 覆盖 registry 通道的分派（registry 形态走 registry 通道、直连形态仍走原通道）、
   按清单 kind 的落点选择、kind 与命令不符时的拒绝，以及未注入时的降级。
2. The pi-web e2e 套件 shall 以真实 HTTP 夹具覆盖 `/agent install <registry-id>` 的成功路径，并断言装完的
   源随后可被源枚举看到。
3. The pi-web e2e 套件 shall 把现有那条记录 `REGISTRY_NOT_IMPLEMENTED` 边界的用例改写为成功路径，
   不留下与新行为矛盾的断言。
4. The pi-web 测试套件 shall 覆盖 CLI 经新通道安装 registry 包的路径，证明收敛后 CLI 行为等效。
